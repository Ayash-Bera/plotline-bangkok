import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import BoundaryOp from 'jsts/org/locationtech/jts/operation/BoundaryOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import { readFileSync } from 'node:fs';
import type { AnalysisRequest } from './domain';
import { analyze } from './engine';
import { orderFamilies } from './engine/family-order';

const utm = '+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs';
const ll = ([x,y]: number[]) => proj4(utm, 'WGS84', [x + 665000, y + 1520000]);
const ring = (p: number[][]) => [...p, p[0]].map(ll);
const request = (p = [[0,0],[80,0],[80,60],[0,60]], type: 'condo'|'office' = 'condo'): AnalysisRequest => ({
  revision: 3, plot: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(p)] } },
  zone: { type: 'Feature', properties: { id: 'y3', LUP_ZONE: 'ย.๓' }, geometry: { type: 'Polygon', coordinates: [ring([[-100,-100],[200,-100],[200,200],[-100,200]])] } },
  road: { id: 'r', name: 'Road', coordinates: [ll([-100,-5]),ll([200,-5])], width: 10, widthEvidence: 'scenario', publicRoad: true },
  buildingType: type, storeyHeight: 3.2, heightLimit: 22.7, permeableFraction: 0.5,
});

describe('concept family ordering', () => {
  it.each([
    { label: 'already ordered', pair: [[300,2],[100,6]], expected: ['first','second'] },
    { label: 'fully reversed', pair: [[100,6],[300,2]], expected: ['second','first'] },
    { label: 'smaller and lower', pair: [[100,2],[300,6]], expected: ['first'] },
    { label: 'larger and taller', pair: [[300,6],[100,2]], expected: ['first'] },
    { label: 'equal storeys', pair: [[100,3],[300,3]], expected: ['second','first'] },
    { label: 'equal area', pair: [[250,6],[250,2]], expected: ['second','first'] },
    { label: 'equal area and storeys', pair: [[250,4],[250,4]], expected: ['first'] },
    { label: 'numerical area noise at equal storeys', pair: [[250,4],[250.000001,4]], expected: ['first'] },
  ])('keeps truthful ordering for $label candidates without changing the input', ({ pair, expected }) => {
    const candidates = pair.map(([size, levels], index) => ({ size, levels, tag: index === 0 ? 'first' : 'second' }));
    const before = structuredClone(candidates);
    expect(orderFamilies(candidates).map(candidate => candidate.tag)).toEqual(expected);
    expect(candidates).toEqual(before);
  });

  it('assigns truthful identities to the reviewed irregular parcel in the supplied zone', () => {
    const load = (name: string) => JSON.parse(readFileSync(`public/data/${name}`, 'utf8'));
    const r = request();
    r.zone = load('zone.json');
    r.road = { ...load('roads-catalog.json')[0], width: 9.5, widthEvidence: 'scenario' };
    r.storeyHeight = 2.9;
    r.heightLimit = 12.1;
    r.plot.geometry.coordinates = [[
      [100.71620641458011,13.833799995281346], [100.71646497420348,13.834440283990135],
      [100.71658575269971,13.833801725682319], [100.71713925607054,13.834170084299771],
      [100.71653886439935,13.831955808446217], [100.71622005815757,13.83240790111506],
      [100.71581448894004,13.832043741165561], [100.71620641458011,13.833799995281346],
    ]];
    const result = analyze(r);
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts).toHaveLength(2);
    const [broad, slender] = result.concepts;
    expect(broad.id).toBe('broad');
    expect(slender.id).toBe('slender');
    expect(broad.footprintArea).toBeGreaterThanOrEqual(slender.footprintArea);
    expect(broad.floors.length).toBeLessThanOrEqual(slender.floors.length);
    expect(broad.floors).toHaveLength(3);
    expect(slender.floors).toHaveLength(4);
    for (const concept of result.concepts) {
      expect(concept.name.toLowerCase()).toBe(concept.id);
      expect(concept.geometry.features.every(feature => feature.properties.conceptId === concept.id)).toBe(true);
      expect(concept.gfa).toBeCloseTo(concept.floors.reduce((sum, floor) => sum + floor.countedArea, 0), 8);
      expect(concept.budgetLimits!.every(budget => budget.used <= budget.limit + 1e-5)).toBe(true);
    }
  });

  it('does not invent two family metrics from single-storey alternatives at the exact use-area cap', () => {
    const r = request();
    r.heightLimit = r.storeyHeight;
    const result = analyze(r);
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts).toHaveLength(1);
    const [broad] = result.concepts;
    expect(broad.floors).toHaveLength(1);
    expect(broad.gfa).toBeCloseTo(1000, 3);
    expect(result.message).toMatch(/Only one concept.*distinct pair/);
    expect(result.concepts.every(concept => concept.geometry.features.every(feature => feature.properties.conceptId === concept.id))).toBe(true);
  });

  it('explains one-family availability when every supported level uses the same small plate', () => {
    const result = analyze(request([[0,0],[10,0],[10,10],[0,10]]));
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].id).toBe('broad');
    expect(result.concepts[0].description).toMatch(/distinct ordered comparison was not found/);
    expect(result.message).toMatch(/bounded search did not find a distinct pair/);
  });
});

describe('display envelope sampling', () => {
  it('uses a fixed ceiling-complete envelope independently of proposed storey heights', () => {
    const r = request();
    r.road.width = 4;
    r.storeyHeight = 4;
    const fourMetreFloors = analyze(r);
    r.storeyHeight = 2.8;
    const shorterFloors = analyze(r);
    expect(fourMetreFloors.envelopeSampling).toEqual({ step: 0.5, maxVerticalUnderfill: 0.5, ceiling: 22.7 });
    expect(fourMetreFloors.envelope).toEqual(shorterFloors.envelope);
    expect(fourMetreFloors.envelope.features).toHaveLength(46);
    const last = fourMetreFloors.envelope.features.at(-1)!;
    expect(last.properties.base + last.properties.height).toBe(22.7);
    expect(last.properties.height).toBeCloseTo(0.2, 10);
    expect(last.geometry).toEqual(fourMetreFloors.geometryStages!.find(stage => stage.id === 'height')!.geometry!.geometry);
    expect(fourMetreFloors.concepts.every(concept => concept.floors.every(floor => floor.height === 4))).toBe(true);
    expect(shorterFloors.concepts.every(concept => concept.floors.every(floor => floor.height === 2.8))).toBe(true);
    expect(fourMetreFloors.assumptions.some(assumption => /0\.5 m/.test(assumption) && /vertical/i.test(assumption))).toBe(true);
  });

  it.each([[22.5,45,0.5], [22.7,46,0.2], [0.3,1,0.3]])('ends the %s m envelope at the ceiling without an empty or overshooting band', (ceiling, count, finalThickness) => {
    const r = request();
    r.heightLimit = ceiling;
    const result = analyze(r);
    expect(result.envelope.features).toHaveLength(count);
    const last = result.envelope.features.at(-1)!;
    expect(last.properties.base + last.properties.height).toBe(ceiling);
    expect(last.properties.height).toBeCloseTo(finalThickness, 10);
    for (const feature of result.envelope.features) {
      expect(feature.properties.height).toBeGreaterThan(0);
      expect(feature.properties.height).toBeLessThanOrEqual(0.5);
      expect(feature.properties.base + feature.properties.height).toBeLessThanOrEqual(ceiling);
    }
  });

  it('contains every displayed band below the road plane and underfills its slope by less than one step', () => {
    const r = request();
    r.road.width = 4;
    r.storeyHeight = 4;
    const result = analyze(r);
    const reader = new GeoJSONReader(new GeometryFactory());
    const project = (coordinates: unknown): unknown => Array.isArray(coordinates) && typeof coordinates[0] === 'number' ? proj4('WGS84', utm, coordinates as number[]) : (coordinates as unknown[]).map(project);
    for (const band of result.envelope.features) {
      const rings = band.geometry.type === 'Polygon' ? [band.geometry.coordinates] : band.geometry.coordinates;
      const top = band.properties.base + band.properties.height;
      for (const polygon of rings) for (const point of polygon[0]) {
        const xy = proj4('WGS84', utm, point as number[]);
        expect(top).toBeLessThanOrEqual(2 * (xy[1] - 1520000 + 5 + r.road.width / 2) + 1e-6);
      }
    }
    for (const y of [3.249, 3.26, 3.499, 4.34]) {
      const point = reader.read({ type: 'Point', coordinates: [665040, 1520000 + y] });
      const exactTop = Math.min(r.heightLimit, 2 * (y + 5 + r.road.width / 2));
      const renderedTop = Math.max(0, ...result.envelope.features.filter(band => {
        const shape = reader.read({ type: band.geometry.type, coordinates: project(band.geometry.coordinates) });
        return DistanceOp.distance(point, shape) < 1e-8;
      }).map(band => band.properties.base + band.properties.height));
      expect(renderedTop).toBeLessThanOrEqual(exactTop + 1e-6);
      expect(exactTop - renderedTop).toBeLessThan(0.5);
    }
  });
});

describe('check reporting', () => {
  it('reports directional numeric margins and display formats', () => {
    const result = analyze(request());
    const zone = result.checks.find(c => c.id === 'zone')!;
    expect(zone.bound).toBe('max');
    expect(zone.margin).toBeCloseTo(Number(zone.limit) - Number(zone.value), 8);
    const c = result.concepts[0];
    for (const [id, bound] of [['far', 'max'], ['use-cap', 'max'], ['height', 'max'], ['osr', 'min'], ['open', 'min'], ['permeable', 'min']] as const) {
      const check = c.checks.find(item => item.id === id)!;
      expect(check.bound).toBe(bound);
      const value = Number(check.value), limit = Number(check.limit);
      expect(check.margin).toBeCloseTo(bound === 'max' ? limit - value : value - limit, 8);
    }
    expect(c.checks.find(check => check.id === 'far')?.display).toBe('ratio');
    expect(c.checks.find(check => check.id === 'osr')?.display).toBe('percent');
    expect(c.checks.find(check => check.id === 'permeable')?.status).toBe('unknown');
    const failed = request(); failed.permeableFraction = 0.4;
    const planting = analyze(failed).checks.find(check => check.id === 'permeable')!;
    expect(planting.bound).toBe('min');
    expect(planting.margin).toBeCloseTo(-0.1, 8);
  });
  it('distinguishes zone, road and bounded search exclusions', () => {
    const designation = request(); designation.zone.properties = {};
    expect(analyze(designation).unsupportedCause).toBe('zone');
    const outside = request(); outside.zone.geometry = { type: 'Polygon', coordinates: [ring([[-10,-10],[40,-10],[40,100],[-10,100]])] };
    const outsideResult = analyze(outside);
    expect(outsideResult.unsupportedCause).toBe('zone');
    expect(outsideResult.checks.find(c => c.id === 'zone')!.margin!).toBeLessThan(0);
    const road = request(); road.road.publicRoad = false;
    expect(analyze(road).unsupportedCause).toBe('road');
    const degenerate = request(); degenerate.road.coordinates = [ll([0,-5]), ll([0,-5])];
    expect(analyze(degenerate).unsupportedCause).toBe('road');
    const miss = analyze(request([[0,0],[6.1,0],[6.1,20],[0,20]]));
    expect(miss.status).toBe('unsupported');
    expect(miss.unsupportedCause).toBe('search');
    expect(miss.message).toMatch(/9.*m²/);
    expect(miss.geometryStages?.map(stage => stage.id)).toEqual(['plot','boundary','road','height']);
    expect(analyze(request()).unsupportedCause).toBeUndefined();
  });
});

describe('site analysis', () => {
  it('measures a rectangle and accounts for floors and open space', () => {
    const result = analyze(request());
    expect(result.plotArea).toBeCloseTo(4800, 0);
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts).toHaveLength(2);
    for (const concept of result.concepts) {
      expect(concept.gfa).toBeCloseTo(concept.floors.reduce((a, f) => a + f.countedArea, 0), 4);
      expect(concept.gfa).toBeLessThanOrEqual(result.plotArea * 2.5 + 0.01);
      expect(concept.openArea).toBeGreaterThanOrEqual(concept.gfa * 0.125 - 0.01);
      expect(concept.permeableArea).toBeGreaterThanOrEqual(concept.openArea * 0.5 - 0.01);
      expect(concept.height).toBeLessThanOrEqual(22.7);
    }
  });
  it('measures a concave polygon rather than its bounding rectangle', () => {
    const result = analyze(request([[0,0],[80,0],[80,20],[30,20],[30,60],[0,60]]));
    expect(result.plotArea).toBeCloseTo(2800, 0);
    expect(result.buildableArea).toBeLessThan(result.plotArea);
  });
  it('rejects a self-intersecting site', () => {
    expect(analyze(request([[0,0],[60,60],[0,60],[60,0]])).status).toBe('invalid');
  });
  it('reports an empty offset as infeasible', () => {
    expect(analyze(request([[0,0],[5,0],[5,40],[0,40]])).status).toBe('infeasible');
  });
  it('requires full zone containment', () => {
    const r = request();
    r.zone.geometry = { type: 'Polygon', coordinates: [ring([[-10,-10],[40,-10],[40,100],[-10,100]])] };
    expect(analyze(r).status).toBe('unsupported');
  });
  it('reflects office and road width floor-area thresholds', () => {
    const r = request(undefined, 'office');
    r.road.width = 8;
    const narrow = analyze(r);
    expect(narrow.concepts.every(c => c.gfa <= 300.01)).toBe(true);
    r.road.width = 16;
    const wide = analyze(r);
    expect(wide.concepts.every(c => c.gfa <= 500.01)).toBe(true);
    expect(Math.max(...wide.concepts.map(c => c.gfa))).toBeGreaterThan(300);
  });
  it('retains disconnected setback islands across a narrow neck', () => {
    const r = request([[0,0],[30,0],[30,13],[42,13],[42,0],[72,0],[72,30],[42,30],[42,17],[30,17],[30,30],[0,30]]);
    const result = analyze(r);
    expect(result.status, result.message).toBe('ready');
    expect(result.setbacks.features[0].geometry.type).toBe('MultiPolygon');
  });
  it('preserves a courtyard hole in the actual envelope', () => {
    const r = request();
    r.plot.geometry.coordinates.push(ring([[30,20],[30,40],[50,40],[50,20]]));
    const result = analyze(r);
    expect(result.plotArea).toBeCloseTo(4400, 0);
    const geom = result.setbacks.features[0].geometry;
    expect(geom.type).toBe('Polygon');
    if (geom.type === 'Polygon') expect(geom.coordinates.length).toBe(2);
  });
  it('respects the permeable fraction and the entered height cap', () => {
    const r = request();
    r.permeableFraction = 0.4;
    expect(analyze(r).status).toBe('infeasible');
    r.permeableFraction = 0.5;
    r.heightLimit = 6.5;
    const result = analyze(r);
    expect(result.concepts.length).toBeGreaterThan(0);
    expect(result.concepts.every(c => c.height <= 6.5)).toBe(true);
  });
  it('returns two conditional families for the supplied site', () => {
    const load = (name: string) => JSON.parse(readFileSync(`public/data/${name}`, 'utf8'));
    const r = request();
    r.plot = load('study-plot.json');
    r.zone = load('zone.json');
    r.road = load('roads-catalog.json')[0];
    const result = analyze(r);
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts.map(c => c.id)).toEqual(['broad', 'slender']);
    expect(result.zoneId).toBe('bma-y3-29');
    expect(result.checks.some(c => c.id === 'frontage' && c.status === 'unknown')).toBe(true);
    expect(result.concepts[0].floors.length).toBeLessThan(result.concepts[1].floors.length);
  });

  it('uses the correct condominium road-width branch', () => {
    const r = request();
    r.road.width = 10;
    const narrow = analyze(r);
    expect(narrow.concepts.every(c => c.gfa <= 1000.001)).toBe(true);
    r.road.width = 30;
    const wide = analyze(r);
    expect(Math.max(...wide.concepts.map(c => c.gfa))).toBeGreaterThan(1000);
    expect(wide.floorAreaCap).toBeCloseTo(12000, 0);
  });
  it('keeps every floor beyond the top-height road plane', () => {
    const r = request();
    r.road.width = 4;
    r.heightLimit = 40;
    const result = analyze(r);
    for (const concept of result.concepts) for (const floor of concept.floors) {
      const rings = floor.footprint.geometry.type === 'Polygon' ? [floor.footprint.geometry.coordinates] : floor.footprint.geometry.coordinates;
      for (const polygon of rings) for (const point of polygon[0]) {
        const xy = proj4('WGS84', utm, point as number[]);
        const distance = xy[1] - 1520000 + 5 + r.road.width / 2;
        expect(2 * distance + 0.01).toBeGreaterThanOrEqual(floor.base + floor.height);
      }
    }
  });

  it('finds a plate on a ten metre wide parcel', () => {
    const result = analyze(request([[0,0],[10,0],[10,100],[0,100]]));
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts.length).toBeGreaterThan(0);
    expect(result.concepts[0].footprintArea).toBeGreaterThanOrEqual(9);
  });
  it('finds a small plate in an irregular parcel with a broad end', () => {
    const result = analyze(request([[0,0],[10,0],[10,55],[22,55],[22,70],[0,70]]));
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts[0].footprintArea).toBeGreaterThanOrEqual(9);
  });
  it('rejects unsupported and missing zone designations', () => {
    const r = request();
    r.zone.properties = { LUP_ZONE: 'พ.๓' };
    expect(analyze(r).status).toBe('unsupported');
    r.zone.properties = {};
    expect(analyze(r).status).toBe('unsupported');
  });
  it('rejects malformed runtime input instead of assuming a valid category', () => {
    const r = request();
    (r as unknown as { buildingType: string }).buildingType = 'warehouse';
    expect(analyze(r).status).toBe('invalid');
    r.buildingType = 'condo';
    (r.road as unknown as { widthEvidence: string }).widthEvidence = 'guessed';
    expect(analyze(r).status).toBe('invalid');
    r.road.widthEvidence = 'scenario';
    r.road.coordinates[0] = [Infinity, 13];
    expect(analyze(r).status).toBe('invalid');
    r.road.coordinates[0] = [181, 13];
    expect(analyze(r).status).toBe('invalid');
  });

  it('reports ground buildable area after the front road constraint', () => {
    const r = request();
    r.road.width = 20;
    const result = analyze(r);
    expect(result.buildableArea).toBeCloseTo(73.96 * 49.96, 0);
  });
  it('returns an invalid result for a null request', () => {
    const result = analyze(null as unknown as AnalysisRequest);
    expect(result.status).toBe('invalid');
    expect(result.revision).toBe(0);
  });

  it('reports exact stage areas and candidate budgets', () => {
    const r = request();
    r.road.width = 20;
    r.heightLimit = 55;
    const result = analyze(r);
    const stages = result.geometryStages!;
    expect(stages.map(s => s.id)).toEqual(['plot', 'boundary', 'road', 'height']);
    expect(stages[0].area).toBeCloseTo(4800, 3);
    expect(stages[1].area).toBeCloseTo(73.96 * 53.96, 2);
    expect(stages[2].area).toBeCloseTo(73.96 * 49.96, 2);
    expect(stages[3].area).toBeCloseTo(73.96 * 44.48, 2);
    expect(stages[3].elevation).toBe(55);
    for (const c of result.concepts) {
      expect(c.budgetLimits?.map(b => b.id)).toEqual(['far', 'use', 'open-space']);
      expect(c.budgetLimits![0].limit).toBeCloseTo(result.plotArea * 2.5, 4);
      expect(c.budgetLimits![1].limit).toBe(1000);
      expect(c.budgetLimits![2].limit).toBeCloseTo(c.openArea / 0.125, 4);
      expect(c.budgetLimits!.every(b => b.used === c.gfa)).toBe(true);
    }
  });
  it('finds a usable plate in a diagonal narrow parcel', () => {
    const result = analyze(request([[0,0],[12,0],[82,70],[70,70]]));
    expect(result.status, result.message).toBe('ready');
    expect(result.concepts[0].footprintArea).toBeGreaterThan(40);
  });

  it('keeps emitted plates within raw concave, narrow-neck and courtyard plots', () => {
    const fixtures = [
      request([[0,0],[80,0],[80,20],[30,20],[30,60],[0,60]]),
      request([[0,0],[30,0],[30,13],[42,13],[42,0],[72,0],[72,30],[42,30],[42,17],[30,17],[30,30],[0,30]]),
      request(),
      request([[0,0],[12,0],[82,70],[70,70]]),
    ];
    fixtures[2].plot.geometry.coordinates.push(ring([[30,20],[30,40],[50,40],[50,20]]));
    const reader = new GeoJSONReader(new GeometryFactory());
    const projectShape = (shape: { type: string; coordinates: unknown }) => {
      const project = (v: unknown): unknown => Array.isArray(v) && typeof v[0] === 'number' ? proj4('WGS84', utm, v as number[]) : (v as unknown[]).map(project);
      return reader.read({ type: shape.type, coordinates: project(shape.coordinates) });
    };
    for (const r of fixtures) {
      const result = analyze(r);
      expect(result.status, result.message).toBe('ready');
      const plot = projectShape(r.plot.geometry), boundary = BoundaryOp.getBoundary(plot);
      for (const c of result.concepts) {
        for (const floor of c.floors) {
          const plate = projectShape(floor.footprint.geometry);
          expect(OverlayOp.difference(plate, plot).getArea()).toBeLessThan(0.0001);
          expect(DistanceOp.distance(plate, boundary)).toBeGreaterThanOrEqual(2.9999);
          expect(plate.getArea()).toBeCloseTo(floor.area, 3);
        }
        expect(c.gfa).toBeCloseTo(c.floors.reduce((sum, f) => sum + f.countedArea, 0), 5);
        expect(c.budgetLimits!.every(b => b.used <= b.limit + 0.001)).toBe(true);
      }
      const areas = result.geometryStages!.map(s => s.area);
      expect(areas.every((a, i) => i === 0 || a <= areas[i-1] + 0.0001)).toBe(true);
    }
  });

  it('measures a complex parcel calculation', () => {
    const points = Array.from({ length: 80 }, (_, i) => {
      const angle = 2 * Math.PI * i / 80;
      const radius = i % 2 ? 65 : 80;
      return [100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)];
    });
    const r = request(points);
    r.heightLimit = 60;
    const result = analyze(r);
    expect(result.status).toBe('ready');
  }, 30000);

  it('identifies the plan source and treats qualifying planting as unverified', () => {
    const result = analyze(request());
    for (const c of result.concepts) {
      expect(c.checks.find(check => check.id === 'use-cap')?.sourceId).toBe('bma-plan');
      expect(c.budgetLimits?.find(b => b.id === 'use')?.sourceId).toBe('bma-plan');
      const planting = c.checks.find(check => check.id === 'permeable');
      expect(planting?.status).toBe('unknown');
      expect(planting?.details).toMatch(/plant/i);
    }
  });

  it('chooses distinct supported footprints for the two families', () => {
    const result = analyze(request());
    expect(result.concepts).toHaveLength(2);
    expect(JSON.stringify(result.concepts[0].floors[0].footprint.geometry)).not.toBe(JSON.stringify(result.concepts[1].floors[0].footprint.geometry));
    for (const concept of result.concepts) {
      expect(concept.floors.every(floor => JSON.stringify(floor.footprint.geometry) === JSON.stringify(concept.floors[0].footprint.geometry))).toBe(true);
    }
  });

  it('keeps road sections invariant when the same alignment starts far away', () => {
    const near = request();
    const far = request();
    far.road.coordinates = [ll([-10000,-5]), ll([200,-5])];
    const baseline = analyze(near), shifted = analyze(far);
    expect(shifted.status, shifted.message).toBe(baseline.status);
    expect(shifted.buildableArea).toBeCloseTo(baseline.buildableArea, 3);
    expect(shifted.geometryStages!.map(s => s.area)).toEqual(baseline.geometryStages!.map(s => expect.closeTo(s.area, 3)));
  });
  it('leaves prior floor-area allocation and clear height unresolved', () => {
    const result = analyze(request());
    for (const id of ['parcel-history', 'clear-height']) {
      expect(result.checks.find(c => c.id === id)?.status).toBe('unknown');
      expect(result.concepts.every(c => c.checks.find(check => check.id === id)?.status === 'unknown')).toBe(true);
    }
  });

});
