import type { Feature, FeatureCollection, Polygon, MultiPolygon, LineString, Position } from "geojson";

export type BuildingType = "condo" | "office";
export type AreaShape = Polygon | MultiPolygon;
export type AreaFeature = Feature<AreaShape>;
export type PlotFeature = Feature<Polygon>;
export type CheckStatus = "pass" | "fail" | "unknown" | "unsupported";

export interface Road {
  id: string;
  name: string;
  coordinates: Position[];
  width: number;
  widthEvidence: "scenario" | "verified";
  publicRoad: boolean;
}

export interface RuleCheck {
  id: string;
  label: string;
  status: CheckStatus;
  value?: number | string;
  limit?: number | string;
  unit?: string;
  bound?: "max" | "min";
  display?: "ratio" | "percent";
  details: string;
  sourceId: string;
  margin?: number;
}

export interface BandProperties {
  base: number;
  // Thickness above base; the absolute top is base + height.
  height: number;
  level: number;
  kind: "envelope" | "floor" | "setback";
  conceptId?: string;
  [key: string]: unknown;
}

export type Bands = FeatureCollection<AreaShape, BandProperties>;

export interface Floor {
  level: number;
  base: number;
  // Thickness above base; the absolute top is base + height.
  height: number;
  area: number;
  countedArea: number;
  footprint: AreaFeature;
}

export interface GeometryStage {
  id: "plot" | "boundary" | "road" | "height";
  label: string;
  sourceId: string;
  area: number;
  elevation: number;
  geometry: AreaFeature | null;
  details: string;
}

export interface BudgetLimit {
  id: "far" | "use" | "open-space";
  label: string;
  sourceId: string;
  limit: number;
  used: number;
  details: string;
}

export interface Concept {
  id: "broad" | "slender";
  name: string;
  description: string;
  floors: Floor[];
  gfa: number;
  footprintArea: number;
  height: number;
  openArea: number;
  permeableArea: number;
  far: number;
  osr: number;
  checks: RuleCheck[];
  geometry: Bands;
  feasible: boolean;
  bindingConstraints: string[];
  budgetLimits?: BudgetLimit[];
}

export interface AnalysisRequest {
  revision: number;
  plot: PlotFeature;
  road: Road;
  buildingType: BuildingType;
  storeyHeight: number;
  heightLimit: number;
  permeableFraction: number;
  zone: AreaFeature;
}

export interface AnalysisResult {
  revision: number;
  status: "ready" | "invalid" | "infeasible" | "unsupported";
  message?: string;
  unsupportedCause?: "zone" | "road" | "search";
  plotArea: number;
  buildableArea: number;
  floorAreaCap: number;
  legalFar: number;
  legalOsr: number;
  setbacks: Bands;
  envelope: Bands;
  concepts: Concept[];
  checks: RuleCheck[];
  assumptions: string[];
  calculationMs: number;
  zoneId: string;
  geometryStages?: GeometryStage[];
  envelopeSampling?: {
    step: number;
    maxVerticalUnderfill: number;
    ceiling: number;
  };
}

export type WorkerReply =
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; revision: number; error: string };

export interface RuleSource {
  id: string;
  title: string;
  url: string;
  clause: string;
  explanation: string;
}

export interface SiteData {
  zone: AreaFeature;
  buildings: FeatureCollection<AreaShape>;
  roads: FeatureCollection<LineString>;
  defaultPlot: PlotFeature;
  roadsCatalog: Road[];
  center: Position;
  metadata: {
    snapshot: string;
    source: string;
    notes: string[];
    coverage: [number, number, number, number];
  };
}
