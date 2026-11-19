import { describe, expect, it } from "vitest";
import type { RuleCheck } from "./domain";
import { formatCheckMetrics } from "./check-metrics";

const check = (values: Partial<RuleCheck> = {}): RuleCheck => ({
  id: "arbitrary-rule",
  label: "Measured rule",
  status: "pass",
  details: "Rule details",
  sourceId: "scope",
  ...values,
});

describe("check measurement formatting", () => {
  it("shows an explicit maximum and its engine-provided remaining ratio", () => {
    expect(formatCheckMetrics(check({ value: 0.6175459264217804, limit: 2.5, margin: 1.8824540735782196, bound: "max", display: "ratio" }))).toEqual({
      measurement: "0.62 ratio", requirement: "Maximum 2.5 ratio", margin: "1.88 ratio below maximum",
    });
  });

  it("shows a percentage minimum and a percentage-point margin", () => {
    expect(formatCheckMetrics(check({ value: 0.6193127623628847, limit: 0.125, margin: 0.4943127623628847, bound: "min", display: "percent" }))).toEqual({
      measurement: "61.93%", requirement: "Minimum 12.5%", margin: "49.43 percentage points above minimum",
    });
  });

  it("preserves zero measurements, limits and margins", () => {
    expect(formatCheckMetrics(check({ value: 0, limit: 0, margin: 0, bound: "min", unit: "m²" }))).toEqual({
      measurement: "0 m²", requirement: "Minimum 0 m²", margin: "0 m² (at minimum)",
    });
  });

  it("formats height and area margins with their own units", () => {
    expect(formatCheckMetrics(check({ value: 3.2, limit: 22.7, margin: 19.5, bound: "max", unit: "m" })).margin).toBe("19.5 m below maximum");
    expect(formatCheckMetrics(check({ value: 619.312725, limit: 485.793799, margin: 133.518926, bound: "min", unit: "m²" })).margin).toBe("133.52 m² above minimum");
  });

  it("uses the supplied direction instead of inferring it from the identifier", () => {
    expect(formatCheckMetrics(check({ id: "far", value: 1, limit: 2, margin: -1, bound: "min" }))).toEqual({
      measurement: "1", requirement: "Minimum 2", margin: "1 below minimum",
    });
  });

  it("does not invent missing direction or a missing margin", () => {
    expect(formatCheckMetrics(check({ value: 8, limit: 10, unit: "m" }))).toEqual({
      measurement: "8 m", requirement: "Reference 10 m", margin: null,
    });
    expect(formatCheckMetrics(check({ value: 8, limit: 10, margin: 2, unit: "m" })).margin).toBe("2 m (signed margin)");
  });

  it("shows a tiny positive magnitude without rounding it to zero", () => {
    expect(formatCheckMetrics(check({ value: 0.001, limit: 0, margin: 0.001, bound: "min", unit: "m²" }))).toEqual({
      measurement: "<0.01 m²", requirement: "Minimum 0 m²", margin: "<0.01 m² above minimum",
    });
    expect(formatCheckMetrics(check({ value: 1.001, limit: 1, margin: -0.001, bound: "max", unit: "m" })).margin).toBe("<0.01 m above maximum");
    expect(formatCheckMetrics(check({ value: 0.00001, margin: 0.00001, bound: "min", display: "percent" })).margin).toBe("<0.01 percentage points above minimum");
  });

  it("keeps negative tiny measurements and exact zero distinct", () => {
    expect(formatCheckMetrics(check({ value: -0.001, unit: "m" })).measurement).toBe(">-0.01 m");
    expect(formatCheckMetrics(check({ value: -0, unit: "m" })).measurement).toBe("0 m");
  });

  it("does not create numerical evidence for textual or missing measurements", () => {
    expect(formatCheckMetrics(check({ value: "Unverified", limit: "Survey required" }))).toEqual({ measurement: null, requirement: null, margin: null });
    expect(formatCheckMetrics(check())).toEqual({ measurement: null, requirement: null, margin: null });
    expect(formatCheckMetrics(check({ value: Infinity, limit: 5, margin: NaN }))).toEqual({ measurement: null, requirement: null, margin: null });
  });

  it("leaves an unknown planting check unknown even with a positive numerical margin", () => {
    const planting = Object.freeze(check({ status: "unknown", value: 600, limit: 500, margin: 100, unit: "m²", bound: "min" }));
    expect(formatCheckMetrics(planting).margin).toBe("100 m² above minimum");
    expect(planting.status).toBe("unknown");
  });
});
