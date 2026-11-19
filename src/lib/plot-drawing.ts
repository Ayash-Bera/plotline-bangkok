import type { TerraDraw, TerraDrawEventListeners } from "terra-draw";
import type { PlotFeature } from "./domain";

interface PlotFinishCallbacks {
  onPlotChange: (plot: PlotFeature) => void;
  onDrawingComplete: () => void;
}

export function finishPlotDrawing(
  draw: Pick<TerraDraw, "getSnapshotFeature" | "setMode">,
  id: Parameters<TerraDrawEventListeners["finish"]>[0],
  context: Parameters<TerraDrawEventListeners["finish"]>[1],
  { onPlotChange, onDrawingComplete }: PlotFinishCallbacks,
) {
  const feature = draw.getSnapshotFeature(id);
  if (feature?.geometry.type !== "Polygon") return;
  onPlotChange({ type: "Feature", properties: {}, geometry: feature.geometry });
  if (context.mode === "polygon") {
    draw.setMode("select");
    onDrawingComplete();
  }
}
