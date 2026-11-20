import { afterEach, describe, expect, it, vi } from "vitest";
import { focusMapForEditing } from "./map-focus";

afterEach(() => vi.unstubAllGlobals());

describe("drawing surface navigation", () => {
  it.each([false, true])("brings the map into view with reduced motion %s and focuses its keyboard surface", reducedMotion => {
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: reducedMotion })) });
    const canvas = { focus: vi.fn() };
    const region = { scrollIntoView: vi.fn(), querySelector: vi.fn(() => canvas), focus: vi.fn() };
    focusMapForEditing(region as unknown as HTMLElement);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(region.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: reducedMotion ? "instant" : "smooth" });
    expect(canvas.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(region.focus).not.toHaveBeenCalled();
  });

  it("uses the focusable region if the canvas has been replaced", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const region = { scrollIntoView: vi.fn(), querySelector: () => null, focus: vi.fn() };
    focusMapForEditing(region as unknown as HTMLElement);
    expect(region.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("ignores an unmounted region", () => {
    expect(() => focusMapForEditing(null)).not.toThrow();
  });
});
