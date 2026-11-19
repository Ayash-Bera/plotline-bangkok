import { describe, expect, it } from "vitest";
import { assetPath, normalizeBasePath } from "./base-path";

describe("deployment paths", () => {
  it("supports deployment at the domain root", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(assetPath("/data/zone.geojson", "")).toBe("/data/zone.geojson");
  });

  it("keeps nested deployment assets under their configured prefix", () => {
    const prefix = normalizeBasePath("/bangkok-feasibility/out/");
    expect(prefix).toBe("/bangkok-feasibility/out");
    expect(assetPath("/data/zone.geojson", prefix)).toBe("/bangkok-feasibility/out/data/zone.geojson");
    expect(assetPath("/data/buildings.geojson", prefix)).toBe("/bangkok-feasibility/out/data/buildings.geojson");
  });

  it("rejects prefixes that are URLs, ambiguous paths or query strings", () => {
    for (const prefix of ["https://example.com", "//example.com", "relative", "/../out", "/plot//child", "/plot?token=x", "/plot#x", "/plot/../../x"]) {
      expect(() => normalizeBasePath(prefix), prefix).toThrow();
    }
  });

  it("rejects asset paths that could escape the application", () => {
    for (const path of ["https://example.com/data", "//example.com/data", "data/zone.geojson", "/../data", "/data/../../zone.geojson"]) {
      expect(() => assetPath(path, "/plot"), path).toThrow();
    }
  });
});
