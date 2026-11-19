import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Centroid from 'jsts/org/locationtech/jts/algorithm/Centroid.js';
import BoundaryOp from 'jsts/org/locationtech/jts/operation/BoundaryOp.js';
import proj4 from 'proj4';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import type { AnalysisRequest, AnalysisResult, AreaFeature, AreaShape, Bands, Concept, Floor, RuleCheck } from '../domain';
import { orderFamilies } from './family-order';

const utm = '+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs';
const reader = new GeoJSONReader(new GeometryFactory());
const writer = new GeoJSONWriter();
type XY = [number, number];
type Geometry = ReturnType<typeof reader.read>;
const area = (g: Geometry) => g.getArea();
const intersect = (a: Geometry, b: Geometry) => OverlayOp.intersection(a, b);
const difference = (a: Geometry, b: Geometry) => OverlayOp.difference(a, b);
const check = (id: string, label: string, status: RuleCheck['status'], details: string, sourceId: string, value?: number | string, limit?: number | string, unit?: string, bound?: RuleCheck['bound'], display?: RuleCheck['display']): RuleCheck => {
  const margin = bound && typeof value === 'number' && Number.isFinite(value) && typeof limit === 'number' && Number.isFinite(limit)
    ? bound === 'max' ? limit - value : value - limit
    : undefined;
  return { id, label, status, details, sourceId, value, limit, unit, bound, display, margin };
};
const emptyBands = (): Bands => ({ type: 'FeatureCollection', features: [] });

export function analyze(request: AnalysisRequest): AnalysisResult {
  const started = performance.now();
  const result: AnalysisResult = { revision: Number.isFinite(request?.revision) ? request.revision : 0, status: 'invalid', plotArea: 0, buildableArea: 0, floorAreaCap: 0, legalFar: 2.5, legalOsr: 0.125, setbacks: emptyBands(), envelope: emptyBands(), concepts: [], checks: [], assumptions: [], calculationMs: 0, zoneId: String(request?.zone?.id ?? request?.zone?.properties?.LUP_SUBZON ?? request?.zone?.properties?.id ?? '') };
  const finish = (status: AnalysisResult['status'], message?: string) => { result.status = status; result.message = message; result.calculationMs = performance.now() - started; return result; };
  const exclude = (cause: NonNullable<AnalysisResult['unsupportedCause']>, message: string) => { result.unsupportedCause = cause; return finish('unsupported', message); };
  try {
    if (!request || !request.plot || !request.zone || !request.road || !['condo', 'office'].includes(request.buildingType) || !['scenario', 'verified'].includes(request.road.widthEvidence) || typeof request.road.publicRoad !== 'boolean' || !Number.isFinite(request.revision) || !Number.isFinite(request.road.width) || request.road.width <= 0 || request.road.width > 1000 || !Number.isFinite(request.storeyHeight) || request.storeyHeight < 0.1 || request.storeyHeight > 1000 || !Number.isFinite(request.heightLimit) || request.heightLimit <= 0 || request.heightLimit > 1000 || !Number.isFinite(request.permeableFraction) || request.permeableFraction < 0 || request.permeableFraction > 1) return finish('invalid', 'Check the site and numeric inputs.');
    const validCoordinates = (input: unknown): boolean => {
      if (!Array.isArray(input) || input.length === 0) return false;
      if (typeof input[0] === 'number') return input.length >= 2 && typeof input[1] === 'number' && Number.isFinite(input[0]) && Number.isFinite(input[1]) && input[0] >= -180 && input[0] <= 180 && input[1] >= -90 && input[1] <= 90 && input.every(Number.isFinite);
      return input.every(validCoordinates);
    };
    if (request.plot.geometry?.type !== 'Polygon' || !['Polygon', 'MultiPolygon'].includes(request.zone.geometry?.type) || !validCoordinates(request.plot.geometry.coordinates) || !validCoordinates(request.zone.geometry.coordinates) || !validCoordinates(request.road.coordinates)) return finish('invalid', 'Coordinates must be finite geographic positions.');
    const designation = request.zone.properties?.LUP_ZONE;
    if (designation !== 'ย.๓' && designation !== 'ย.3') {
      result.checks.push(check('zone-designation', 'Zone designation', 'unsupported', 'Only the ย.3 designation is evaluated; verify the selected zone.', 'bma-plan', String(designation ?? 'missing')));
      return exclude('zone', 'The selected zone is not identified as ย.3.');
    }
    const first = request.plot.geometry.coordinates[0]?.[0];
    if (!first || first.length < 2) return finish('invalid', 'The plot needs a closed polygon.');
    const origin = proj4('WGS84', utm, first as number[]);
    const project = (p: number[]): XY => { const q = proj4('WGS84', utm, p); return [q[0] - origin[0], q[1] - origin[1]]; };
    const unproject = (p: number[]): XY => { const q = proj4(utm, 'WGS84', [p[0] + origin[0], p[1] + origin[1]]); return [q[0], q[1]]; };
    const transform = (coordinates: unknown[], fn: (p: number[]) => XY): unknown[] => typeof coordinates[0] === 'number' ? fn(coordinates as number[]) : coordinates.map(c => transform(c as unknown[], fn));
    const toGeom = (g: AreaShape) => reader.read({ type: g.type, coordinates: transform(g.coordinates, project) } as AreaShape);
    const toFeature = (g: Geometry): AreaFeature => { const raw = writer.write(g) as AreaShape; return { type: 'Feature', properties: {}, geometry: { type: raw.type, coordinates: transform(raw.coordinates, unproject) } } as AreaFeature; };
    const polygon = (points: XY[]) => reader.read({ type: 'Polygon', coordinates: [[...points, points[0]]] });
    const plot = toGeom(request.plot.geometry);
    const zone = toGeom(request.zone.geometry);
    if (!new IsValidOp(plot).isValid() || plot.isEmpty() || area(plot) < 1 || !new IsValidOp(zone).isValid()) return finish('invalid', 'The plot or zone polygon is invalid.');
    result.plotArea = area(plot);
    result.geometryStages = [{ id: 'plot', label: 'Plot', sourceId: 'input', area: area(plot), elevation: 0, geometry: toFeature(plot), details: 'Projected area of the supplied plot, including any courtyard holes.' }];
    result.floorAreaCap = result.plotArea * 2.5;
    const outside = area(difference(plot, zone));
    result.checks.push(check('zone', 'Full zone containment', outside < 1e-7 ? 'pass' : 'unsupported', outside < 1e-7 ? 'The full plot is inside the selected zone.' : 'The plot extends outside the selected zone; split-zone rules are not evaluated.', 'bma-plan', outside, 0, 'm²', 'max'));
    if (outside >= 1e-7) return exclude('zone', 'The entire plot must be within the supported zone.');
    const roadPoints = request.road.coordinates.map(p => project(p as number[]));
    if (roadPoints.length < 2 || !request.road.publicRoad) return exclude('road', 'Select a public road with a usable alignment.');
    const center = Centroid.getCentroid(plot);
    let best = Infinity; let a: XY = roadPoints[0], b: XY = roadPoints[1];
    for (let i = 0; i < roadPoints.length - 1; i++) {
      const p = roadPoints[i], q = roadPoints[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], len2 = dx * dx + dy * dy;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, ((center.x - p[0]) * dx + (center.y - p[1]) * dy) / len2));
      const d = Math.hypot(center.x - p[0] - t * dx, center.y - p[1] - t * dy);
      if (d < best) { best = d; a = p; b = q; }
    }
    if (!Number.isFinite(best)) return exclude('road', 'The selected road has no usable segment.');
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: XY = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    let n: XY = [-u[1], u[0]];
    if ((center.x - a[0]) * n[0] + (center.y - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const roadStart = a;
    const along = (center.x - a[0]) * u[0] + (center.y - a[1]) * u[1];
    a = [a[0] + along * u[0], a[1] + along * u[1]];
    const xy = (s: number, t: number): XY => [a[0] + u[0] * s + n[0] * t, a[1] + u[1] * s + n[1] * t];
    const extent = plot.getEnvelopeInternal();
    const span = Math.max(extent.getWidth(), extent.getHeight(), best, 100) * 20 + 1000;
    const halfPlane = (t: number) => polygon([xy(-span,t), xy(span,t), xy(span,span), xy(-span,span)]);
    const roadBoundary = request.road.width / 2;
    const nearest = DistanceOp.distance(plot, reader.read({ type: 'LineString', coordinates: [roadStart,b] }));
    const frontageGap = Math.abs(nearest - roadBoundary);
    result.checks.push(check('frontage', 'Road frontage', 'unknown', `Road proximity is ${frontageGap.toFixed(1)} m from the assumed near road edge. Confirm actual frontage and the building-facing side qualification in a survey.`, 'bma-control'));
    result.checks.push(check('road-width', 'Road width evidence', request.road.widthEvidence === 'verified' ? 'pass' : 'unknown', request.road.widthEvidence === 'scenario' ? 'The entered road width is a scenario assumption, not a survey.' : 'The entered road width is marked verified; confirm its location and public status.', 'input', request.road.width, undefined, 'm'));
    result.checks.push(check('overlays', 'Parking, fire and special overlays', 'unknown', 'Parking, fire access, large-building category and special overlay controls require separate verification.', 'scope'));
    result.checks.push(check('parcel-history', 'Parcel history and FAR allocation', 'unknown', 'Prior subdivision, transfer and existing floor-area allocations may affect the available FAR and OSR budget; the parcel history is not established.', 'bma-plan'));
    result.checks.push(check('clear-height', 'Interior clear height and roof allowance', 'unknown', 'Floor-to-floor height does not establish interior clear height. Roof and rooftop equipment are not included in the top-of-floor height.', 'mr55'));
    result.assumptions.push('Road geometry uses a local straight segment and a centered right-of-way. Confirm the actual road boundaries and frontage.', 'A conservative 3 m offset applies to the entire plot boundary, including sides and rear.', 'The low-rise height and floor-to-floor height are study inputs, not zoning height limits.', 'Roadside qualification, parking, fire access and special overlays are not verified.');
    if (request.road.widthEvidence === 'scenario') result.assumptions.push('Road width is a scenario assumption and has not been surveyed.');
    const setback = BufferOp.bufferOp(plot, -3.02, 16);
    result.geometryStages.push({ id: 'boundary', label: 'Boundary offset', sourceId: 'bma-control', area: area(setback), elevation: 0, geometry: setback.isEmpty() ? null : toFeature(setback), details: 'A conservative 3.02 m design offset from every plot boundary, not a permit determination.' });
    if (setback.isEmpty() || area(setback) < 0.01) return finish('infeasible', 'The conservative boundary setback leaves no buildable area.');
    result.setbacks.features.push({ ...toFeature(setback), properties: { base: 0, height: 0.05, level: 0, kind: 'setback' } });
    const maxLevels = Math.min(30, Math.floor((request.heightLimit + 1e-9) / request.storeyHeight));
    const front = request.road.width < 10 ? 6 : request.road.width <= 20 ? roadBoundary + 0.1 * request.road.width : roadBoundary + 2;
    const groundThreshold = Math.max(front, -roadBoundary) + 0.02;
    const ground = intersect(setback, halfPlane(groundThreshold));
    result.buildableArea = area(ground);
    result.geometryStages.push({ id: 'road', label: 'Road restriction', sourceId: 'bma-control', area: area(ground), elevation: 0, geometry: ground.isEmpty() ? null : toFeature(ground), details: 'Ground section after the front restriction, using the assumed straight road segment and centered width.' });
    const sections = new Map<number, Geometry>([[groundThreshold, ground]]);
    const section = (threshold: number) => {
      let geometry = sections.get(threshold);
      if (!geometry) { geometry = intersect(setback, halfPlane(threshold)); sections.set(threshold, geometry); }
      return geometry;
    };
    const displaySection = (top: number) => section(Math.max(groundThreshold, top / 2 - roadBoundary));
    const heightSection = displaySection(request.heightLimit);
    result.geometryStages.push({ id: 'height', label: 'Height section', sourceId: 'mr55', area: area(heightSection), elevation: request.heightLimit, geometry: heightSection.isEmpty() ? null : toFeature(heightSection), details: 'Section at the requested study height cap, clipped by the assumed road plane. Other controls remain unresolved.' });
    if (ground.isEmpty() || result.buildableArea < 0.01) return finish('infeasible', 'The road setback leaves no ground buildable area.');
    const envelopeStep = 0.5;
    result.envelopeSampling = { step: envelopeStep, maxVerticalUnderfill: envelopeStep, ceiling: request.heightLimit };
    result.assumptions.push(`The study envelope uses ${envelopeStep} m top-section bands, including a final partial band at the study ceiling. This inner approximation omits less than ${envelopeStep} m vertically from the modeled volume, independently of proposed floor heights.`);
    for (let level = 1; level <= Math.ceil(request.heightLimit / envelopeStep); level++) {
      const base = (level - 1) * envelopeStep;
      const top = Math.min(level * envelopeStep, request.heightLimit);
      const plate = displaySection(top);
      if (!plate.isEmpty() && area(plate) > 0) result.envelope.features.push({ ...toFeature(plate), properties: { base, height: top - base, level, kind: 'envelope' } });
    }
    const plates: Geometry[] = [];
    for (let level = 1; level <= maxLevels; level++) {
      const top = level * request.storeyHeight;
      const threshold = Math.max(front, top / 2 - roadBoundary);
      plates.push(section(threshold + 0.02));
    }
    if (!plates.length || plates[0].isEmpty()) return finish('infeasible', 'The road setback and height inputs leave no buildable area.');
    const limit = request.buildingType === 'office' ? (request.road.width >= 16 ? 500 : 300) : (request.road.width >= 30 ? 10000 : 1000);
    const useCap = Math.min(result.floorAreaCap, limit);
    const minOpen = request.buildingType === 'office' ? 0.1 : 0.3;
    if (request.permeableFraction < 0.5) {
      result.checks.push(check('permeable', 'Permeable planting reservation', 'fail', 'The assumed qualifying permeable planting share is below half of the required open area.', 'bma-plan', request.permeableFraction, 0.5, undefined, 'min', 'percent'));
      return finish('infeasible', 'The assumed permeable share is below the required half of open area.');
    }
    const openCap = result.plotArea * (1 - minOpen);
    const minimumCandidateArea = 9;
    type Candidate = { geom: Geometry; size: number; levels: number; gfa: number; open: number };
    const boundary = BoundaryOp.getBoundary(plot);
    const selected: Geometry[] = [];
    const distinct = (g: Geometry) => selected.every(other => area(difference(g, other)) + area(difference(other, g)) > 0.01);
    const fitCache = new Map<string, Geometry[]>();
    const clippedArea = (ring: number[][], threshold: number, reverse: boolean) => {
      const coordinate = (p: number[]) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
      const inside = (t: number) => reverse ? t <= threshold : t >= threshold;
      const points: number[][] = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const p = ring[i], q = ring[i + 1], pt = coordinate(p), qt = coordinate(q);
        if (inside(pt)) points.push(p);
        if (inside(pt) !== inside(qt)) {
          const f = (threshold - pt) / (qt - pt);
          points.push([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]);
        }
      }
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], q = points[(i + 1) % points.length];
        sum += p[0] * q[1] - q[0] * p[1];
      }
      return Math.abs(sum) / 2;
    };
    const fit = (levels: number, budget: number, reverse: boolean): Geometry[] => {
      const key = `${levels}:${reverse}`;
      const cached = fitCache.get(key);
      if (cached) return cached;
      const allowed = plates[levels - 1];
      const output: Geometry[] = [];
      for (let i = 0; i < allowed.getNumGeometries(); i++) {
        const piece = allowed.getGeometryN(i);
        if (area(piece) <= budget + 1e-7) { output.push(piece); continue; }
        const shape = writer.write(piece) as AreaShape;
        if (shape.type !== 'Polygon') continue;
        const coords = shape.coordinates;
        const values = coords[0].map(p => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]);
        let low = Math.min(...values), high = Math.max(...values);
        for (let step = 0; step < 24; step++) {
          const middle = (low + high) / 2;
          const remaining = clippedArea(coords[0], middle, reverse) - coords.slice(1).reduce((sum, ring) => sum + clippedArea(ring, middle, reverse), 0);
          if ((remaining > budget) === reverse) high = middle; else low = middle;
        }
        const threshold = reverse ? low : high;
        const cut = reverse ? polygon([xy(-span,-span),xy(span,-span),xy(span,threshold),xy(-span,threshold)]) : halfPlane(threshold);
        const clipped = intersect(piece, cut);
        for (let j = 0; j < clipped.getNumGeometries(); j++) output.push(clipped.getGeometryN(j));
      }
      fitCache.set(key, output);
      return output;
    };
    const find = (family: 'broad' | 'slender'): Candidate | undefined => {
      let bestCandidate: Candidate | undefined;
      let bestScore = -Infinity;
      const levelsList = Array.from({ length: maxLevels }, (_, i) => family === 'broad' ? i + 1 : maxLevels - i);
      for (const levels of levelsList) {
        const allowed = plates[levels - 1];
        if (!allowed || allowed.isEmpty()) continue;
        const budget = Math.min(useCap / levels, openCap, result.plotArea / (1 + 0.125 * levels), area(allowed));
        if (budget < minimumCandidateArea) continue;
        const score = (size: number) => family === 'broad' ? size * levels + size * 0.2 - levels * 2 : size * levels + levels * 20 - size * 0.03;
        if (score(budget) <= bestScore) continue;
        for (const reverse of [false, true]) {
          for (const geom of fit(levels, budget, reverse)) {
            const size = area(geom);
            if (size < minimumCandidateArea || size > budget + 1e-5 || score(size) <= bestScore) continue;
            if (!distinct(geom)) continue;
            bestScore = score(size);
            bestCandidate = { geom, size, levels, gfa: size * levels, open: result.plotArea - size };
          }
          if (bestScore >= score(budget) - 0.01) break;
        }
      }
      if (bestCandidate && (area(difference(bestCandidate.geom, plot)) > 1e-6 || DistanceOp.distance(bestCandidate.geom, boundary) < 3 - 1e-7)) return undefined;
      return bestCandidate;
    };
    const found: Candidate[] = [];
    for (const objective of ['broad', 'slender'] as const) {
      const candidate = find(objective);
      if (candidate) { selected.push(candidate.geom); found.push(candidate); }
    }
    const candidates = orderFamilies(found);
    for (const [index, candidate] of candidates.entries()) {
      const family = index === 0 ? 'broad' : 'slender';
      const footprint = toFeature(candidate.geom);
      const floors: Floor[] = Array.from({ length: candidate.levels }, (_, i) => ({ level: i+1, base: i*request.storeyHeight, height: request.storeyHeight, area: candidate.size, countedArea: candidate.size, footprint }));
      const height = candidate.levels * request.storeyHeight;
      const permeable = candidate.open * request.permeableFraction;
      const checks: RuleCheck[] = [
        check('far', 'Floor area ratio', 'pass', 'All floor plates count in full.', 'bma-plan', candidate.gfa / result.plotArea, 2.5, undefined, 'max', 'ratio'),
        check('osr', 'Open space ratio', 'pass', 'Open area is measured against total counted floor area.', 'bma-plan', candidate.open / candidate.gfa, 0.125, undefined, 'min', 'percent'),
        check('open', 'Site open area', 'pass', 'The covered area includes every floor footprint.', 'bma-control', candidate.open, minOpen * result.plotArea, 'm²', 'min'),
        check('permeable', 'Permeable planting reservation', 'unknown', 'The scenario reserves a share for permeable ground and tree planting; the actual layout and qualification remain unverified.', 'bma-plan', permeable, candidate.open * 0.5, 'm²', 'min'),
        check('use-cap', 'Use and road width', 'pass', 'The concept stays within the evaluated floor area branch. Rail exceptions and larger branches are excluded.', 'bma-plan', candidate.gfa, limit, 'm²', 'max'),
        check('height', 'Study height cap', 'pass', 'The entered low-rise study cap applies at the top of the highest floor.', 'scope', height, request.heightLimit, 'm', 'max'),
        check('road-plane', 'Road height plane', 'pass', 'Each full plate is contained in the top-of-floor road plane using the local road assumption.', 'mr55'),
        ...result.checks,
      ];
      const geometry: Bands = { type: 'FeatureCollection', features: floors.map(f => ({ ...f.footprint, properties: { base: f.base, height: f.height, level: f.level, kind: 'floor', conceptId: family } })) };
      const budgetLimits = [
        { id: 'far' as const, label: 'Floor area ratio', sourceId: 'bma-plan', limit: result.floorAreaCap, used: candidate.gfa, details: 'Plot area multiplied by the evaluated FAR of 2.5.' },
        { id: 'use' as const, label: 'Use and road width', sourceId: 'bma-plan', limit, used: candidate.gfa, details: `${request.buildingType} branch for the entered ${request.road.width} m road width; excluded exceptions need separate review.` },
        { id: 'open-space' as const, label: 'Open space ratio', sourceId: 'bma-plan', limit: candidate.open / 0.125, used: candidate.gfa, details: 'Candidate open area divided by the required 0.125 open-space ratio.' },
      ];
      const tightest = Math.min(...budgetLimits.map(b => b.limit));
      const bindingConstraints = budgetLimits.filter(b => b.limit <= tightest * 1.01 && candidate.gfa >= b.limit * 0.98).map(b => b.label);
      let description = 'One connected concept; a distinct ordered comparison was not found.';
      if (candidates.length === 2) {
        const equalArea = candidates[0].size === candidates[1].size;
        const equalLevels = candidates[0].levels === candidates[1].levels;
        if (equalLevels) description = family === 'broad' ? 'A broader footprint at the same level count as the alternative.' : 'A narrower footprint at the same level count as the alternative.';
        else if (equalArea) description = family === 'broad' ? 'Fewer levels at the same footprint area as the alternative.' : 'More levels at the same footprint area as the alternative.';
        else description = family === 'broad' ? 'A broader plate with fewer levels.' : 'A narrower plate with more levels.';
      }
      const concept: Concept = { id: family, name: family === 'broad' ? 'Broad' : 'Slender', description, floors, gfa: candidate.gfa, footprintArea: candidate.size, height, openArea: candidate.open, permeableArea: permeable, far: candidate.gfa/result.plotArea, osr: candidate.open/candidate.gfa, checks, geometry, feasible: true, bindingConstraints, budgetLimits };
      result.concepts.push(concept);
    }
    if (!result.concepts.length) return exclude('search', `No connected concept of at least ${minimumCandidateArea} m² was found by the bounded search. Smaller or other footprints may fit.`);
    return finish('ready', result.concepts.length === 1 ? 'Only one concept is shown: the bounded search did not find a distinct pair with broader coverage and no more levels. Other controls remain conditional.' : 'Concepts are conditional on unresolved frontage and other controls.');
  } catch (error) {
    return finish('invalid', `Unable to analyze the supplied geometry: ${error instanceof Error ? error.message : String(error)}`);
  }
}
