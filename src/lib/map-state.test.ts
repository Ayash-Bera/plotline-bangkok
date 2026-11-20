import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { FeatureCollection } from "geojson";
import type { AnalysisResult, Bands, Concept, PlotFeature, Road } from "./domain";
import { createContextSafeAdapter, createMapLifecycle, createMapStateSync, removeDrawingLayers, type MapScenarioState } from "./map-state";

const plot: PlotFeature = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] } };
const road: Road = { id: "road", name: "Road", coordinates: [[0, 0], [0.001, 0]], width: 10, widthEvidence: "scenario", publicRoad: true };
const bands = (): Bands => ({ type: "FeatureCollection", features: [{ ...plot, properties: { base: 0, height: 3, level: 1, kind: "floor" } }] });
const concept = (): Concept => ({ id: "broad", name: "Broad", description: "", floors: [], gfa: 100, footprintArea: 100, height: 3, openArea: 100, permeableArea: 50, far: 0.5, osr: 1, checks: [], geometry: bands(), feasible: true, bindingConstraints: [] });
const result = (): AnalysisResult => ({ revision: 1, status: "ready", plotArea: 200, buildableArea: 100, floorAreaCap: 100, legalFar: 1, legalOsr: 1, setbacks: bands(), envelope: bands(), concepts: [], checks: [], assumptions: [], calculationMs: 1, zoneId: "zone" });
const scenario = (): MapScenarioState => ({ plot, road, result: result(), concept: concept(), showEnvelope: true, inspectedStage: { id: "plot", label: "Plot", sourceId: "plot", area: 200, elevation: 0, geometry: plot, details: "" }, plan: false, drawing: false, busy: false });

class Canvas extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  style = { cursor: "", removeProperty: vi.fn() };
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) {
      const set = this.listeners.get(type) || new Set();
      set.add(listener);
      this.listeners.set(type, set);
    }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
}

type Source = { data: unknown; setData(data: unknown): void };
type Layer = { id: string; source?: string };
const interaction = () => {
  let enabled = true;
  return { isEnabled: () => enabled, enable: vi.fn(() => { enabled = true; }), disable: vi.fn(() => { enabled = false; }) };
};
class MapTarget {
  valid = true;
  canvas = new Canvas();
  sources = new Map<string, Source>();
  layers = new Map<string, Layer>();
  uploads: { id: string; data: unknown }[] = [];
  visibility: { id: string; value: string }[] = [];
  readonly version = "6.19.0";
  dragRotate = interaction();
  dragPan = interaction();
  doubleClickZoom = { enable: vi.fn(), disable: vi.fn() };

  private assertStyle() { if (!this.valid) throw new Error("Map style is unavailable."); }
  getContainer() { return this.canvas; }
  getCanvas() { return this.canvas; }
  project({ lng, lat }: { lng: number; lat: number }) { return { x: lng * 1_000_000, y: lat * 1_000_000 }; }
  unproject({ x, y }: { x: number; y: number }) { return { lng: x / 1_000_000, lat: y / 1_000_000 }; }
  addSource(id: string, spec: { data: unknown }) {
    this.assertStyle();
    if (this.sources.has(id)) throw new Error(`Duplicate source ${id}.`);
    const source: Source = { data: spec.data, setData: data => { this.assertStyle(); source.data = data; this.uploads.push({ id, data }); } };
    this.sources.set(id, source);
  }
  addLayer(layer: Layer) {
    this.assertStyle();
    if (this.layers.has(layer.id)) throw new Error(`Duplicate layer ${layer.id}.`);
    this.layers.set(layer.id, layer);
  }
  getSource(id: string) { this.assertStyle(); return this.sources.get(id); }
  getLayer(id: string) { this.assertStyle(); return this.layers.get(id); }
  removeLayer(id: string) { this.assertStyle(); this.layers.delete(id); }
  removeSource(id: string) {
    this.assertStyle();
    if ([...this.layers.values()].some(layer => layer.source === id)) throw new Error(`Source ${id} is still in use.`);
    this.sources.delete(id);
  }
  setLayoutProperty(id: string, _name: string, value: string) { this.assertStyle(); this.visibility.push({ id, value }); }
  restoreSnapshot() {
    const snapshot = [...this.sources].map(([id, source]) => ({ id, data: source.data }));
    this.valid = true;
    this.sources.clear();
    for (const source of snapshot) this.addSource(source.id, source);
  }
}

function mapWithSources() {
  const map = new MapTarget();
  for (const id of ["plot", "selected-road", "inspection", "envelope", "setbacks", "concept"]) map.addSource(id, { data: null });
  for (const id of ["plot-fill", "plot-line", "inspection-fill", "inspection-line", "envelope-extrusion", "concept-extrusion", "setbacks-fill"]) map.addLayer({ id, source: "plot" });
  return map;
}

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
});
afterEach(() => vi.unstubAllGlobals());

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(0));
}

describe("map state synchronization", () => {
  it("changes visibility without uploading unchanged geometry", () => {
    const map = mapWithSources();
    const state = scenario();
    const sync = createMapStateSync();
    sync.resume(map, state);
    expect(map.uploads.map(upload => upload.id)).toEqual(["plot", "selected-road", "inspection", "envelope", "setbacks", "concept"]);
    map.uploads = [];
    map.visibility = [];
    sync.sync(map, { ...state, plan: true });
    expect(map.uploads).toEqual([]);
    expect(map.visibility).toEqual(expect.arrayContaining([{ id: "inspection-fill", value: "visible" }, { id: "envelope-extrusion", value: "none" }]));
    sync.sync(map, { ...state, showEnvelope: false });
    sync.sync(map, { ...state, road: { ...state.road, width: 12 }, drawing: true, busy: true });
    expect(map.uploads).toEqual([]);
  });

  it("uploads only changed geometry and detects a replaced source", () => {
    const map = mapWithSources();
    const state = scenario();
    const sync = createMapStateSync();
    sync.resume(map, state);
    map.uploads = [];
    const next = { ...state, concept: concept() };
    sync.sync(map, next);
    expect(map.uploads).toEqual([{ id: "concept", data: next.concept.geometry }]);
    map.uploads = [];
    map.sources.delete("plot");
    map.addSource("plot", { data: null });
    sync.sync(map, next);
    expect(map.uploads).toEqual([{ id: "plot", data: plot }]);
  });

  it("suspends every source and layout access until restoration supplies a new style", () => {
    const map = mapWithSources();
    let latest = scenario();
    const sync = createMapStateSync();
    const ready = vi.fn(() => sync.resume(map, latest));
    const suspend = vi.fn(() => sync.suspend());
    const lifecycle = createMapLifecycle({ onSuspend: suspend, onStyleReady: ready });
    lifecycle.styleLoaded();
    expect(lifecycle.canMutate()).toBe(true);
    map.valid = false;
    lifecycle.contextLost();
    lifecycle.contextLost();
    expect(suspend).toHaveBeenCalledTimes(1);
    latest = { ...latest, plot: structuredClone(plot), concept: concept(), plan: true };
    expect(() => sync.sync(map, latest)).not.toThrow();
    lifecycle.styleLoaded();
    expect(ready).toHaveBeenCalledTimes(1);
    lifecycle.contextRestored();
    expect(lifecycle.canMutate()).toBe(false);
    expect(() => sync.sync(map, latest)).not.toThrow();
    map.restoreSnapshot();
    map.uploads = [];
    lifecycle.styleLoaded();
    expect(lifecycle.canMutate()).toBe(true);
    expect(map.uploads).toHaveLength(6);
    expect(map.uploads.find(upload => upload.id === "plot")?.data).toBe(latest.plot);
    expect(map.uploads.find(upload => upload.id === "concept")?.data).toBe(latest.concept?.geometry);
    lifecycle.styleLoaded();
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it.each(["fail", "dispose"] as const)("never resumes after %s, including late restoration events", action => {
    const onSuspend = vi.fn();
    const onStyleReady = vi.fn();
    const lifecycle = createMapLifecycle({ onSuspend, onStyleReady });
    lifecycle.styleLoaded();
    lifecycle.contextLost();
    lifecycle[action]();
    lifecycle.contextRestored();
    lifecycle.contextLost();
    lifecycle.styleLoaded();
    expect(lifecycle.canMutate()).toBe(false);
    expect(onStyleReady).toHaveBeenCalledTimes(1);
    expect(onSuspend).toHaveBeenCalledTimes(2);
  });
});

describe("drawing adapter context recovery", () => {
  it("detaches real adapter listeners and neutralizes its queued render without a style", () => {
    const map = mapWithSources();
    const Adapter = createContextSafeAdapter(TerraDrawMapLibreGLAdapter);
    const adapter = new Adapter({ map });
    const draw = new TerraDraw({ adapter, modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode()] });
    draw.start();
    draw.setMode("select");
    draw.addFeatures([{ ...plot, id: draw.getFeatureId(), properties: { mode: "polygon" } }]);
    expect(map.canvas.listenerCount()).toBeGreaterThan(0);
    expect(frames.size).toBeGreaterThan(0);
    map.valid = false;
    expect(() => { adapter.suspend(); draw.stop(); adapter.clear(); adapter.unregister(); flushFrames(); }).not.toThrow();
    expect(map.canvas.listenerCount()).toBe(0);
    expect(frames.size).toBe(0);
    expect(() => draw.stop()).not.toThrow();
  });

  it("exposes the original adapter's null-style teardown as a positive control", () => {
    const map = mapWithSources();
    const draw = new TerraDraw({ adapter: new TerraDrawMapLibreGLAdapter({ map }), modes: [new TerraDrawPolygonMode()] });
    draw.start();
    map.valid = false;
    expect(() => draw.stop()).toThrow("Map style is unavailable.");
  });

  it("replaces restored drawing layers and edits the latest plot after repeated recoveries", () => {
    const map = mapWithSources();
    const Adapter = createContextSafeAdapter(TerraDrawMapLibreGLAdapter);
    let adapter: InstanceType<typeof Adapter> | undefined;
    let draw: TerraDraw | undefined;
    let latest = scenario();
    const sync = createMapStateSync();
    const lifecycle = createMapLifecycle({
      onSuspend() { sync.suspend(); adapter?.suspend(); draw?.stop(); },
      onStyleReady() {
        removeDrawingLayers(map);
        adapter?.restoreInteractions();
        adapter = new Adapter({ map });
        draw = new TerraDraw({ adapter, modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode({ flags: { polygon: { feature: { coordinates: { draggable: true, midpoints: true } } } } })] });
        draw.start();
        draw.setMode("select");
        const id = draw.getFeatureId();
        draw.addFeatures([{ ...latest.plot!, id, properties: { mode: "polygon" } }]);
        draw.selectFeature(id);
        sync.resume(map, latest);
      },
    });
    lifecycle.styleLoaded();
    const initialListeners = map.canvas.listenerCount();
    for (let attempt = 0; attempt < 2; attempt++) {
      adapter!.setDraggability(false);
      expect(map.dragPan.isEnabled()).toBe(false);
      map.valid = false;
      expect(() => lifecycle.contextLost()).not.toThrow();
      expect(map.canvas.listenerCount()).toBe(0);
      expect(() => flushFrames()).not.toThrow();
      latest = { ...latest, plot: { ...plot, geometry: { type: "Polygon", coordinates: [[[0, 0], [0.001, 0], [0.0008 - attempt * 0.0001, 0.0009], [0, 0.001], [0, 0]]] } } };
      lifecycle.contextRestored();
      map.restoreSnapshot();
      expect(() => lifecycle.styleLoaded()).not.toThrow();
      expect(map.canvas.listenerCount()).toBe(initialListeners);
      expect(map.dragPan.isEnabled()).toBe(true);
      expect(map.dragRotate.isEnabled()).toBe(true);
      expect([...map.sources.keys()].filter(id => id.startsWith("td-"))).toHaveLength(3);
      expect([...map.layers.keys()].filter(id => id.startsWith("td-"))).toHaveLength(5);
      expect(map.sources.get("plot")?.data).toBe(latest.plot);
      const selected = draw!.getSnapshot().find(feature => feature.geometry.type === "Polygon");
      expect(selected?.geometry).toEqual(latest.plot?.geometry);
      expect(selected?.properties.selected).toBe(true);
      expect(draw!.getSnapshot().filter(feature => feature.properties.selectionPoint || feature.properties.midPoint)).toHaveLength(8);
      expect(() => flushFrames()).not.toThrow();
    }
    lifecycle.dispose();
    expect(map.canvas.listenerCount()).toBe(0);
  });

  it("removes partial drawing snapshots in dependency order without affecting app layers", () => {
    const map = mapWithSources();
    const data: FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource("td-polygon", { data });
    map.addLayer({ id: "td-polygon-outline", source: "td-polygon" });
    removeDrawingLayers(map);
    removeDrawingLayers(map);
    expect(map.sources.has("td-polygon")).toBe(false);
    expect(map.sources.has("plot")).toBe(true);
    expect(map.layers.has("plot-line")).toBe(true);
  });
});
