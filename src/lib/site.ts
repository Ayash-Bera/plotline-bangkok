import type { FeatureCollection, LineString, Position } from 'geojson';
import type { AreaFeature, AreaShape, PlotFeature, Road, SiteData } from './domain';
import { assetPath } from './base-path';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const position = (value: unknown): value is Position => Array.isArray(value) && value.length >= 2 && value.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const line = (value: unknown): value is Position[] => Array.isArray(value) && value.length >= 2 && value.every(position);
const ring = (value: unknown): boolean => line(value) && value.length >= 4 && value[0][0] === value[value.length - 1][0] && value[0][1] === value[value.length - 1][1];
const polygon = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(ring);
const feature = (value: unknown): value is RecordValue & { geometry: RecordValue; properties: RecordValue } => object(value) && value.type === 'Feature' && object(value.geometry) && object(value.properties);
const area = (value: unknown): value is AreaFeature => feature(value) && (value.geometry.type === 'Polygon' ? polygon(value.geometry.coordinates) : value.geometry.type === 'MultiPolygon' && Array.isArray(value.geometry.coordinates) && value.geometry.coordinates.length > 0 && value.geometry.coordinates.every(polygon));
const collection = (value: unknown): value is RecordValue & { features: unknown[] } => object(value) && value.type === 'FeatureCollection' && Array.isArray(value.features);
const road = (value: unknown): value is Road => object(value) && typeof value.id === 'string' && typeof value.name === 'string' && line(value.coordinates) && typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 && (value.widthEvidence === 'scenario' || value.widthEvidence === 'verified') && typeof value.publicRoad === 'boolean';

async function asset(name: string): Promise<unknown> {
  const path = assetPath(`/data/${name}`);
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-cache' });
  } catch {
    throw new Error(`Could not load site asset ${path}. Check the connection and reload the page.`);
  }
  if (!response.ok) throw new Error(`Site asset ${path} returned HTTP ${response.status}. Restore the bundled data file and reload.`);
  try {
    return await response.json();
  } catch {
    throw new Error(`Site asset ${path} is not valid JSON. Restore the bundled data file and reload.`);
  }
}

function invalid(name: string): never {
  throw new Error(`Site asset /data/${name} failed validation. Restore the bundled data file before running a study.`);
}

export async function loadSite(): Promise<SiteData> {
  const [zone, buildings, roads, defaultPlot, roadsCatalog, metadata] = await Promise.all([
    asset('zone.geojson'), asset('buildings.geojson'), asset('roads.geojson'),
    asset('study-plot.geojson'), asset('roads-catalog.json'), asset('metadata.json'),
  ]);
  if (!area(zone) || zone.geometry.type !== 'Polygon' || Number(zone.properties?.LUP_FAR) !== 2.5 || Number(zone.properties?.LUP_OSR) !== 12.5) invalid('zone.geojson');
  if (!collection(buildings) || !buildings.features.length || !buildings.features.every(value => area(value) && typeof value.properties?.render_height === 'number' && Number.isFinite(value.properties.render_height) && value.properties.render_height > 0 && ['tagged', 'levels-estimate', 'illustrative-default'].includes(String(value.properties.height_source)))) invalid('buildings.geojson');
  if (!collection(roads) || !roads.features.length || !roads.features.every(value => feature(value) && value.geometry.type === 'LineString' && line(value.geometry.coordinates))) invalid('roads.geojson');
  if (!area(defaultPlot) || defaultPlot.geometry.type !== 'Polygon' || defaultPlot.properties?.hypothetical !== true) invalid('study-plot.geojson');
  if (!Array.isArray(roadsCatalog) || !roadsCatalog.length || !roadsCatalog.every(road)) invalid('roads-catalog.json');
  if (!object(metadata) || typeof metadata.snapshot !== 'string' || !Number.isFinite(Date.parse(metadata.snapshot)) || typeof metadata.source !== 'string' || !Array.isArray(metadata.notes) || !metadata.notes.every(note => typeof note === 'string') || !Array.isArray(metadata.coverage) || metadata.coverage.length !== 4 || !metadata.coverage.every(n => typeof n === 'number' && Number.isFinite(n)) || metadata.coverage[0] >= metadata.coverage[2] || metadata.coverage[1] >= metadata.coverage[3]) invalid('metadata.json');
  const positions = defaultPlot.geometry.coordinates[0].slice(0, -1);
  const center: Position = [positions.reduce((sum, p) => sum + p[0], 0) / positions.length, positions.reduce((sum, p) => sum + p[1], 0) / positions.length];
  return {
    zone,
    buildings: buildings as unknown as FeatureCollection<AreaShape>,
    roads: roads as unknown as FeatureCollection<LineString>,
    defaultPlot: defaultPlot as PlotFeature,
    roadsCatalog,
    center,
    metadata: metadata as unknown as SiteData['metadata'],
  };
}
