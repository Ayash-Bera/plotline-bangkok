import type { FeatureCollection } from "geojson";
import type { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { AnalysisResult, Concept, GeometryStage, PlotFeature, Road } from "./domain";

export interface MapScenarioState {
  plot: PlotFeature | null;
  road: Road;
  result: AnalysisResult | null;
  concept: Concept | null;
  showEnvelope: boolean;
  inspectedStage: GeometryStage | null;
  plan: boolean;
  drawing: boolean;
  busy: boolean;
}

type MapData = FeatureCollection | PlotFeature;
interface DataSource { setData(data: MapData): unknown }
interface MapTarget {
  getSource(id: string): unknown;
  getLayer(id: string): unknown;
  setLayoutProperty(id: string, name: "visibility", value: "visible" | "none"): unknown;
}

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

export function createMapStateSync() {
  let active = false;
  const data = new Map<string, { key: unknown; source: DataSource }>();
  const visibility = new Map<string, "visible" | "none">();

  const sync = (map: MapTarget, state: MapScenarioState) => {
    if (!active) return;
    const setData = (id: string, key: unknown, makeData: () => MapData) => {
      const source = map.getSource(id) as DataSource | undefined;
      const previous = data.get(id);
      if (!source || typeof source.setData !== "function" || previous && previous.key === key && previous.source === source) return;
      source.setData(makeData());
      data.set(id, { key, source });
    };
    const setVisible = (id: string, show: boolean) => {
      const next = show ? "visible" : "none";
      if (!map.getLayer(id) || visibility.get(id) === next) return;
      map.setLayoutProperty(id, "visibility", next);
      visibility.set(id, next);
    };

    setData("plot", state.plot, () => state.plot || empty);
    setData("selected-road", state.road.coordinates, () => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: state.road.coordinates } }] }));
    setData("inspection", state.inspectedStage?.geometry, () => state.inspectedStage?.geometry ? { type: "FeatureCollection", features: [state.inspectedStage.geometry] } : empty);
    setData("envelope", state.result?.envelope, () => state.result?.envelope || empty);
    setData("setbacks", state.result?.setbacks, () => state.result?.setbacks || empty);
    setData("concept", state.concept?.geometry, () => state.concept?.geometry || empty);

    const showAnalysis = !!state.result && state.result.status !== "invalid" && (state.result.status !== "unsupported" || state.result.unsupportedCause === "search") && !state.busy && !state.drawing;
    const inspecting = !!state.inspectedStage && showAnalysis && state.plan;
    setVisible("plot-fill", !!state.plot && !state.drawing);
    setVisible("plot-line", !!state.plot && !state.drawing);
    setVisible("inspection-fill", inspecting);
    setVisible("inspection-line", inspecting);
    setVisible("envelope-extrusion", showAnalysis && state.showEnvelope && !inspecting);
    setVisible("concept-extrusion", showAnalysis && !!state.concept && !inspecting);
    setVisible("setbacks-fill", showAnalysis && !inspecting);
  };

  return {
    sync,
    suspend() {
      active = false;
      data.clear();
      visibility.clear();
    },
    resume(map: MapTarget, state: MapScenarioState) {
      active = true;
      data.clear();
      visibility.clear();
      sync(map, state);
    },
  };
}

export function createMapLifecycle(callbacks: { onSuspend(): void; onStyleReady(): void }) {
  let phase: "starting" | "ready" | "lost" | "restoring" | "failed" | "disposed" = "starting";
  return {
    canMutate: () => phase === "ready",
    contextLost() {
      if (phase === "failed" || phase === "disposed" || phase === "lost") return;
      phase = "lost";
      callbacks.onSuspend();
    },
    contextRestored() {
      if (phase === "lost") phase = "restoring";
    },
    styleLoaded() {
      if (phase !== "starting" && phase !== "restoring") return;
      phase = "ready";
      callbacks.onStyleReady();
    },
    fail() {
      if (phase === "failed" || phase === "disposed") return;
      phase = "failed";
      callbacks.onSuspend();
    },
    dispose() {
      if (phase === "disposed") return;
      phase = "disposed";
      callbacks.onSuspend();
    },
  };
}

export function createContextSafeAdapter(Base: new (...args: ConstructorParameters<typeof TerraDrawMapLibreGLAdapter>) => TerraDrawMapLibreGLAdapter<unknown>) {
  return class ContextSafeAdapter extends Base {
    private suspended = false;

    suspend() {
      this.suspended = true;
      this._listeners.forEach(listener => listener.unregister());
      this._listeners = [];
      // The adapter's queued render checks this before accessing restored sources.
      this._currentModeCallbacks = undefined;
      this._heldKeys.clear();
    }

    restoreInteractions() {
      this.setDraggability(true);
      this.setCursor("unset");
    }

    override clear() {
      if (!this.suspended) super.clear();
    }

    override render(...args: Parameters<TerraDrawMapLibreGLAdapter<unknown>["render"]>) {
      if (!this.suspended) super.render(...args);
    }

    override unregister() {
      if (!this.suspended) super.unregister();
    }
  };
}

export function removeDrawingLayers(map: Pick<MapTarget, "getLayer" | "getSource"> & { removeLayer(id: string): unknown; removeSource(id: string): unknown }) {
  for (const id of ["td-point", "td-point-marker", "td-linestring", "td-polygon", "td-polygon-outline"]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of ["td-point", "td-linestring", "td-polygon"]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}
