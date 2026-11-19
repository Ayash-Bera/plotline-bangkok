import { describe, expect, it, vi } from "vitest";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type TerraDrawMouseEvent } from "terra-draw";
import type { PlotFeature } from "./domain";
import { finishPlotDrawing } from "./plot-drawing";

type DrawAdapter = ConstructorParameters<typeof TerraDraw>[0]["adapter"];
type DrawCallbacks = Parameters<DrawAdapter["register"]>[0];

class MapAdapter implements DrawAdapter {
  callbacks: DrawCallbacks | null = null;

  register(callbacks: DrawCallbacks) { this.callbacks = callbacks; callbacks.onReady?.(); }
  unregister() { this.callbacks?.onClear(); this.callbacks = null; }
  getCoordinatePrecision() { return 9; }
  project(lng: number, lat: number) { return { x: lng * 1_000_000, y: lat * 1_000_000 }; }
  unproject(x: number, y: number) { return { lng: x / 1_000_000, lat: y / 1_000_000 }; }
  setCursor() {}
  getLngLatFromEvent() { return null; }
  getMapEventElement(): HTMLElement { throw new Error("This adapter exercises mode callbacks without a DOM."); }
  setDoubleClickToZoom() {}
  render() {}
  clear() { this.callbacks?.onClear(); }
}

const initialPlot: PlotFeature = {
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] },
};

const event = ([lng, lat]: number[]): TerraDrawMouseEvent => ({
  lng, lat, containerX: lng * 1_000_000, containerY: lat * 1_000_000,
  button: "left", heldKeys: [], isContextMenu: false,
});

function harness() {
  const adapter = new MapAdapter();
  const draw = new TerraDraw({
    adapter,
    modes: [
      new TerraDrawPolygonMode({ keyEvents: { cancel: "Escape", finish: "Enter" } }),
      new TerraDrawSelectMode({
        flags: { polygon: { feature: { draggable: true, coordinates: { draggable: true, deletable: true, midpoints: true } } } },
        keyEvents: { deselect: "Escape", delete: "Delete", rotate: null, scale: null },
      }),
    ],
  });
  draw.start();
  draw.setMode("select");
  const id = draw.getFeatureId();
  draw.addFeatures([{ ...initialPlot, id, properties: { mode: "polygon" } }]);
  draw.selectFeature(id);
  const published: PlotFeature[] = [];
  const complete = vi.fn();
  draw.on("finish", (featureId, context) => finishPlotDrawing(draw, featureId, context, {
    onPlotChange: plot => published.push(structuredClone(plot)),
    onDrawingComplete: complete,
  }));

  const coordinates = () => {
    const feature = draw.getSnapshot().find(item => item.id === id);
    if (feature?.geometry.type !== "Polygon") throw new Error("Expected the edited polygon.");
    return feature.geometry.coordinates;
  };
  const handles = () => draw.getSnapshot().filter(item => item.properties.selectionPoint || item.properties.midPoint);
  const selected = () => draw.getSnapshot().find(item => item.id === id)?.properties.selected;
  const drag = (from: number[], to: number[]) => {
    const callbacks = adapter.callbacks!;
    callbacks.onMouseMove(event(from));
    callbacks.onDragStart(event(from), () => {});
    callbacks.onDrag(event(to), () => {});
    callbacks.onDragEnd(event(to), () => {});
  };
  return { draw, adapter, id, published, complete, coordinates, handles, selected, drag };
}

describe("plot drawing completion", () => {
  it("keeps handles and publishes the actual geometry across repeated vertex drags", () => {
    const h = harness();
    expect(h.handles()).toHaveLength(8);
    h.drag([0.001, 0.001], [0.0009, 0.0009]);
    expect(h.coordinates()[0][2]).toEqual([0.0009, 0.0009]);
    expect(h.published.at(-1)?.geometry.coordinates).toEqual(h.coordinates());
    expect(h.selected()).toBe(true);
    expect(h.handles()).toHaveLength(8);

    h.drag([0, 0.001], [0.0001, 0.0009]);
    expect(h.coordinates()[0][3]).toEqual([0.0001, 0.0009]);
    expect(h.published).toHaveLength(2);
    expect(h.published[1].geometry.coordinates).toEqual(h.coordinates());
    expect(h.selected()).toBe(true);
    expect(h.handles()).toHaveLength(8);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it("keeps handles and publishes the actual geometry across repeated whole-plot drags", () => {
    const h = harness();
    h.drag([0.0005, 0.0005], [0.0006, 0.0006]);
    expect(h.coordinates()[0][0][0]).toBeCloseTo(0.0001, 8);
    expect(h.coordinates()[0][0][1]).toBeCloseTo(0.0001, 8);
    expect(h.published.at(-1)?.geometry.coordinates).toEqual(h.coordinates());
    expect(h.selected()).toBe(true);
    expect(h.handles()).toHaveLength(8);

    h.drag([0.0006, 0.0006], [0.0007, 0.0007]);
    expect(h.coordinates()[0][0][0]).toBeCloseTo(0.0002, 8);
    expect(h.coordinates()[0][0][1]).toBeCloseTo(0.0002, 8);
    expect(h.published).toHaveLength(2);
    expect(h.published[1].geometry.coordinates).toEqual(h.coordinates());
    expect(h.selected()).toBe(true);
    expect(h.handles()).toHaveLength(8);
    expect(h.complete).not.toHaveBeenCalled();
  });

  it.each(["Enter", "first corner"])("completes a new polygon with %s and reports completion only once", finish => {
    const h = harness();
    h.draw.clear();
    h.draw.setMode("polygon");
    const callbacks = h.adapter.callbacks!;
    const corners = initialPlot.geometry.coordinates[0].slice(0, -1);
    for (const corner of corners) {
      callbacks.onMouseMove(event(corner));
      callbacks.onClick(event(corner));
    }
    if (finish === "Enter") {
      const enter = { key: "Enter", heldKeys: [], preventDefault: vi.fn() };
      callbacks.onKeyDown(enter);
      callbacks.onKeyUp(enter);
    } else {
      callbacks.onMouseMove(event(corners[0]));
      callbacks.onClick(event(corners[0]));
    }

    expect(h.draw.getMode()).toBe("select");
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.published).toEqual([initialPlot]);
    const feature = h.draw.getSnapshot().find(item => item.geometry.type === "Polygon");
    if (!feature || feature.geometry.type !== "Polygon" || feature.id === undefined) throw new Error("Expected the completed polygon with an id.");
    expect(feature.geometry).toEqual(initialPlot.geometry);

    h.draw.selectFeature(feature.id);
    h.drag([0.001, 0.001], [0.0009, 0.0009]);
    expect(h.draw.getSnapshotFeature(feature.id)?.properties.selected).toBe(true);
    expect(h.handles()).toHaveLength(8);
    expect(h.published).toHaveLength(2);
    expect(h.published[1].geometry).toEqual(h.draw.getSnapshotFeature(feature.id)?.geometry);
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it("does not publish a cancelled draft or complete it, and can edit the restored plot", () => {
    const h = harness();
    h.draw.clear();
    h.draw.setMode("polygon");
    const callbacks = h.adapter.callbacks!;
    for (const corner of initialPlot.geometry.coordinates[0].slice(0, 2)) {
      callbacks.onMouseMove(event(corner));
      callbacks.onClick(event(corner));
    }
    const escape = { key: "Escape", heldKeys: [], preventDefault: vi.fn() };
    callbacks.onKeyDown(escape);
    callbacks.onKeyUp(escape);
    expect(h.published).toHaveLength(0);
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.draw.getSnapshot().filter(item => item.geometry.type === "Polygon")).toHaveLength(0);

    h.draw.clear();
    h.draw.addFeatures([{ ...initialPlot, id: h.id, properties: { mode: "polygon" } }]);
    h.draw.setMode("select");
    h.draw.selectFeature(h.id);
    h.drag([0.001, 0.001], [0.0009, 0.0009]);
    expect(h.coordinates()[0][2]).toEqual([0.0009, 0.0009]);
    expect(h.published).toHaveLength(1);
    expect(h.published[0].geometry.coordinates).toEqual(h.coordinates());
    expect(h.selected()).toBe(true);
    expect(h.handles()).toHaveLength(8);
    expect(h.complete).not.toHaveBeenCalled();
  });
});
