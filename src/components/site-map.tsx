"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Map as LibreMap, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { TerraDraw } from "terra-draw";
import type { FeatureCollection, Polygon } from "geojson";
import type { AnalysisResult, Concept, GeometryStage, PlotFeature, Road, SiteData } from "@/lib/domain";
import { finishPlotDrawing } from "@/lib/plot-drawing";
import { createContextSafeAdapter, createMapLifecycle, createMapStateSync, removeDrawingLayers } from "@/lib/map-state";
import { Icon } from "./icon";

export interface SiteMapHandle { command: (action: "draw" | "edit" | "cancel" | "reset" | "fit") => void }
interface Props {
  site: SiteData;
  plot: PlotFeature | null;
  road: Road;
  result: AnalysisResult | null;
  concept: Concept | null;
  showEnvelope: boolean;
  inspectedStage: GeometryStage | null;
  plan: boolean;
  drawing: boolean;
  busy: boolean;
  onPlotChange: (plot: PlotFeature | null) => void;
  onRoadChange: (id: string) => void;
  onDrawingComplete: () => void;
  onReadyChange: (ready: boolean) => void;
}
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
const localStyle: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e9ece6" } }] };

export const SiteMap = forwardRef<SiteMapHandle, Props>(function SiteMap(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const latest = useRef(props);
  const syncDraw = useRef(false);
  const currentDrawId = useRef<string | number | null>(null);
  const drawingActive = useRef(false);
  const operational = useRef(false);
  const [stateSync] = useState(createMapStateSync);
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  latest.current = props;

  const syncPlot = (plot: PlotFeature | null) => {
    const draw = drawRef.current;
    if (!draw || !operational.current) return;
    syncDraw.current = true;
    draw.clear();
    currentDrawId.current = null;
    if (plot) {
      const id = draw.getFeatureId();
      const validation = draw.addFeatures([{ ...plot, id, properties: { mode: "polygon" } }]);
      if (validation[0]?.valid) currentDrawId.current = id;
    }
    syncDraw.current = false;
  };

  useImperativeHandle(ref, () => ({ command(action) {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw || !operational.current) return;
    if (action === "fit") {
      const plot = latest.current.plot || latest.current.site.defaultPlot;
      const coords = plot.geometry.coordinates[0];
      const xs = coords.map(p => p[0]), ys = coords.map(p => p[1]);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 100, maxZoom: 18, duration: 650 });
      return;
    }
    drawingActive.current = action === "draw";
    if (action === "draw") {
      syncPlot(null);
      draw.setMode("polygon");
      return;
    }
    syncPlot(action === "reset" ? latest.current.site.defaultPlot : latest.current.plot);
    draw.setMode("select");
    if (action === "edit" && currentDrawId.current !== null) draw.selectFeature(currentDrawId.current);
  }}));

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    let instance: LibreMap | undefined;
    let adapter: { suspend(): void; restoreInteractions(): void } | undefined;
    let lifecycle: ReturnType<typeof createMapLifecycle> | undefined;
    let failed = false;
    const suspend = () => {
      operational.current = false;
      drawingActive.current = false;
      stateSync.suspend();
      adapter?.suspend();
      drawRef.current?.stop();
      drawRef.current = null;
      currentDrawId.current = null;
      if (timeout) clearTimeout(timeout);
      setReady(false);
      latest.current.onReadyChange(false);
    };
    const fail = (message: string) => {
      failed = true;
      if (lifecycle) lifecycle.fail();
      else suspend();
      setMapError(message);
    };
    const boot = async () => {
      try {
        const [maplibre, terra, { TerraDrawMapLibreGLAdapter }] = await Promise.all([import("maplibre-gl"), import("terra-draw"), import("terra-draw-maplibre-gl-adapter")]);
        if (cancelled || !container.current) return;
        const site = latest.current.site;
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        const map = new maplibre.Map({ container: container.current, style: "https://tiles.openfreemap.org/styles/liberty", center: [site.center[0], site.center[1]], zoom: 17.3, pitch: 55, bearing: -22, maxPitch: 65, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true } });
        instance = map;
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "bottom-right");
        map.addControl(new maplibre.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");
        observer = new ResizeObserver(() => { if (lifecycle?.canMutate()) map.resize(); });
        observer.observe(container.current);
        let configured = false;
        const configure = () => {
          if (cancelled || failed) return;
          if (timeout) clearTimeout(timeout);
          if (!configured) for (const layer of map.getStyle().layers) if (layer.type === "fill-extrusion") map.setLayoutProperty(layer.id, "visibility", "none");
          const addSource = (id: string, data: FeatureCollection | PlotFeature) => {
            if (!map.getSource(id)) map.addSource(id, { type: "geojson", data, attribution: id === "local-buildings" ? "Local context © OpenStreetMap contributors" : undefined });
          };
          const addLayer = (layer: LayerSpecification) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
          addSource("zone", { type: "FeatureCollection", features: [site.zone] });
          addSource("local-roads", site.roads);
          addSource("local-buildings", site.buildings);
          addSource("plot", latest.current.plot || empty);
          addSource("selected-road", empty);
          addSource("envelope", empty);
          addSource("concept", empty);
          addSource("setbacks", empty);
          addSource("inspection", empty);
          addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": "#a5bca1", "fill-opacity": 0.07 } });
          addLayer({ id: "local-roads-casing", type: "line", source: "local-roads", paint: { "line-color": "#d0d5ce", "line-width": 11, "line-opacity": 0.75 } });
          addLayer({ id: "local-roads-line", type: "line", source: "local-roads", paint: { "line-color": "#fffef9", "line-width": 7 } });
          addLayer({ id: "local-buildings-extrusion", type: "fill-extrusion", source: "local-buildings", paint: { "fill-extrusion-color": "#c2c8bd", "fill-extrusion-height": ["to-number", ["get", "render_height"], 8], "fill-extrusion-opacity": 0.8, "fill-extrusion-vertical-gradient": true } });
          const remoteSource = Object.entries(map.getStyle().sources).find(([, source]) => source.type === "vector" && ("url" in source && String(source.url).includes("openfreemap") || "tiles" in source && String(source.tiles).includes("openfreemap")));
          if (remoteSource) {
            const [west, south, east, north] = site.metadata.coverage;
            const coverage: Polygon = { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
            addLayer({ id: "regional-buildings-approximate", type: "fill-extrusion", source: remoteSource[0], "source-layer": "building", minzoom: 15, filter: ["!", ["within", coverage]], paint: { "fill-extrusion-color": "#cbd0c7", "fill-extrusion-height": ["to-number", ["get", "render_height"], 8], "fill-extrusion-opacity": 0.65 } });
          }
          addLayer({ id: "selected-road-line", type: "line", source: "selected-road", paint: { "line-color": "#c69752", "line-width": 5, "line-opacity": 0.9 } });
          addLayer({ id: "plot-fill", type: "fill", source: "plot", paint: { "fill-color": "#c6d5aa", "fill-opacity": 0.48 } });
          addLayer({ id: "plot-line", type: "line", source: "plot", paint: { "line-color": "#285c49", "line-width": 2, "line-dasharray": [3, 2] } });
          addLayer({ id: "setbacks-fill", type: "fill", source: "setbacks", paint: { "fill-color": "#bda979", "fill-opacity": 0.13 } });
          addLayer({ id: "concept-extrusion", type: "fill-extrusion", source: "concept", paint: { "fill-extrusion-color": ["case", ["==", ["%", ["get", "level"], 2], 0], "#3e6b55", "#5c8167"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["-", ["+", ["get", "base"], ["get", "height"]], 0.1], "fill-extrusion-opacity": 1, "fill-extrusion-vertical-gradient": true } });
          addLayer({ id: "envelope-extrusion", type: "fill-extrusion", source: "envelope", paint: { "fill-extrusion-color": "#aabf9c", "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["+", ["get", "base"], ["get", "height"]], "fill-extrusion-opacity": 0.2 } });
          addLayer({ id: "inspection-fill", type: "fill", source: "inspection", paint: { "fill-color": "#597c9a", "fill-opacity": 0.42 } });
          addLayer({ id: "inspection-line", type: "line", source: "inspection", paint: { "line-color": "#315a7a", "line-width": 2.5 } });
          removeDrawingLayers(map);
          adapter?.restoreInteractions();
          const ContextSafeAdapter = createContextSafeAdapter(TerraDrawMapLibreGLAdapter);
          const nextAdapter = new ContextSafeAdapter({ map, coordinatePrecision: 9 });
          adapter = nextAdapter;
          const draw = new terra.TerraDraw({ adapter: nextAdapter, modes: [new terra.TerraDrawPolygonMode({ styles: { fillColor: "#4c765e", fillOpacity: 0.12, outlineColor: "#285c49", outlineWidth: 2 }, keyEvents: { cancel: "Escape", finish: "Enter" } }), new terra.TerraDrawSelectMode({ flags: { polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true, midpoints: true } } } }, keyEvents: { deselect: "Escape", delete: "Delete", rotate: null, scale: null } })] });
          drawRef.current = draw;
          draw.on("ready", () => {
            if (cancelled || failed || !lifecycle?.canMutate()) return;
            operational.current = true;
            syncPlot(latest.current.plot);
            draw.setMode("select");
            stateSync.resume(map, latest.current);
            map.resize();
            map.easeTo({ pitch: latest.current.plan ? 0 : 55, bearing: latest.current.plan ? 0 : -22, duration: 0 });
            setRecovering(false);
            setReady(true);
            latest.current.onReadyChange(true);
          });
          draw.on("finish", (id, context) => {
            if (cancelled || failed || !operational.current) return;
            finishPlotDrawing(draw, id, context, {
              onPlotChange: plot => { currentDrawId.current = id; latest.current.onPlotChange(plot); },
              onDrawingComplete: () => { drawingActive.current = false; latest.current.onDrawingComplete(); },
            });
          });
          draw.on("change", (_ids, type) => {
            if (cancelled || failed || !operational.current || syncDraw.current || drawingActive.current) return;
            const feature = draw.getSnapshot().find(item => item.geometry.type === "Polygon" && item.properties.mode === "polygon");
            if (feature?.geometry.type === "Polygon") latest.current.onPlotChange({ type: "Feature", properties: {}, geometry: feature.geometry });
            else if (type === "delete") latest.current.onPlotChange(null);
          });
          configured = true;
          draw.start();
        };
        lifecycle = createMapLifecycle({ onSuspend: suspend, onStyleReady: configure });
        map.on("style.load", () => {
          if (cancelled || failed) return;
          try { lifecycle?.styleLoaded(); }
          catch (error) { fail(error instanceof Error ? error.message : "The map could not restore its style."); }
        });
        map.on("webglcontextlost", () => {
          if (cancelled || failed) return;
          setRecovering(true);
          lifecycle?.contextLost();
        });
        map.on("webglcontextrestored", () => { if (!cancelled && !failed) lifecycle?.contextRestored(); });
        map.on("click", "local-roads-line", event => {
          if (cancelled || failed || !operational.current || drawingActive.current) return;
          const properties = event.features?.[0]?.properties;
          const road = site.roadsCatalog.find(item => item.id === String(properties?.id || properties?.source_id) || item.name === properties?.name);
          if (road) latest.current.onRoadChange(road.id);
        });
        map.on("error", event => {
          if (cancelled || failed) return;
          const message = event.error?.message || "";
          if (/context lost/i.test(message)) {
            setRecovering(true);
            lifecycle?.contextLost();
          } else if (/worker failed|webgl/i.test(message)) {
            fail("Map processing is unavailable. Reload to retry. Scenario calculations remain available.");
          } else if (configured) setFallback(true);
        });
        timeout = setTimeout(() => {
          if (!configured && !cancelled && !failed) {
            setFallback(true);
            map.setStyle(localStyle);
          }
        }, 8000);
      } catch (error) { if (!cancelled) fail(error instanceof Error ? error.message : "The map could not start."); }
    };
    void boot();
    return () => {
      cancelled = true;
      if (lifecycle) lifecycle.dispose();
      else suspend();
      observer?.disconnect();
      try { instance?.remove(); }
      catch (error) { console.error("The map could not release its rendering resources.", error); }
      mapRef.current = null;
    };
  }, [stateSync]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !operational.current) return;
    stateSync.sync(map, props);
  }, [ready, stateSync, props]);

  useEffect(() => { if (ready && operational.current) mapRef.current?.easeTo({ pitch: props.plan ? 0 : 55, bearing: props.plan ? 0 : -22, duration: 600 }); }, [ready, props.plan]);

  return <div className="map-stage">
    <div ref={container} className="map-canvas" aria-label="Interactive Bangkok site map" />
    {!ready && !mapError && <div className="map-loading"><span className="spinner"/>{recovering ? "Restoring geographic context" : "Loading geographic context"}</div>}
    {mapError && <div className="map-failure"><Icon name="info"/><h3>Map unavailable</h3><p>{mapError}</p><p>The scenario controls and rule calculations remain available. Reload to retry the map.</p></div>}
    {props.drawing && <div className="drawing-hint">Click to place corners. Click the first corner or press Enter to close. Use Cancel to restore your plot.</div>}
    {fallback && ready && <div className="map-network-note">Some background tiles are unavailable. Local site data remains visible.</div>}
    <div className="map-bottom-card"><div className="map-status"><span className={props.busy ? "status-dot pending" : "status-dot"}/>{props.drawing ? "Drawing a new boundary" : props.busy ? "Calculating latest scenario" : props.inspectedStage ? "Inspecting rule geometry in Plan" : props.result ? "Scenario calculated" : "Define a plot to begin"}</div><div className="map-legend">{props.inspectedStage ? <><span><i className="legend-swatch inspection"/>Selected stage</span><span><i className="legend-swatch plot"/>Original plot</span></> : <><span><i className="legend-swatch proposed"/>Proposed</span><span><i className="legend-swatch envelope"/>Envelope</span></>}<span><i className="legend-swatch context"/>OSM context*</span></div><small>*Local building heights: illustrative 9 m, not surveyed.<br/>Regional heights use mapped tags or estimates.</small></div>
  </div>;
});
