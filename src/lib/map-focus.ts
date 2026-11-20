export function focusMapForEditing(region: HTMLElement | null) {
  if (!region) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  region.scrollIntoView({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
  const canvas = region.querySelector<HTMLCanvasElement>(".maplibregl-canvas");
  (canvas || region).focus({ preventScroll: true });
}
