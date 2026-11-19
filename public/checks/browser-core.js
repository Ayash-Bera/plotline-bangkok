export function visibilityProblem(state) {
  if (!state || state.parent !== "visible" || state.child !== "visible") return "Document became hidden";
  if (state.display === "none" || state.cssVisibility !== "visible" || !state.frameRect.width || !state.frameRect.height) return "App frame is hidden or has no area";
  if (!Number.isFinite(state.frameIntersection) || state.frameIntersection < 0.98) return "App frame is clipped by the host viewport";
  return null;
}

export function nextRangeValue(input, key) {
  const current = Number(input.value), min = Number(input.min || 0), max = Number(input.max || 100), step = Number(input.step || 1);
  const direction = ["ArrowRight", "ArrowUp"].includes(key) ? 1 : ["ArrowLeft", "ArrowDown"].includes(key) ? -1 : 0;
  if (!direction && key !== "Home" && key !== "End") return null;
  const next = key === "Home" ? min : key === "End" ? max : current + direction * step;
  return Number(Math.max(min, Math.min(max, next)).toFixed(9));
}

export function sameScenario(a, b) {
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => typeof a[key] === "number" ? typeof b[key] === "number" && Math.abs(a[key] - b[key]) < 1e-8 : a[key] === b[key]);
}

export function cadenceSummary(timestamps) {
  const intervals = timestamps.slice(1).map((value, index) => value - timestamps[index]);
  const monotonic = intervals.every(value => Number.isFinite(value) && value > 0);
  const sorted = [...intervals].sort((a, b) => a - b), n = sorted.length;
  return {
    intervals: n, monotonic, elapsedMs: n ? timestamps.at(-1) - timestamps[0] : 0,
    medianMs: n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null,
    p95Ms: n ? sorted[Math.ceil(n * 0.95) - 1] : null, maxMs: n ? sorted.at(-1) : null,
    over50ms: intervals.filter(value => value > 50).length, percentile: "nearest rank",
  };
}
