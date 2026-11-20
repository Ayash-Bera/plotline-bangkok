import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlotFeature } from './domain';
import { assetPath } from './base-path';
import { loadSite } from './site';

const names = ['zone.json', 'buildings.json', 'roads.json', 'study-plot.json', 'roads-catalog.json', 'metadata.json'] as const;
const fixtures = Object.fromEntries(names.map(name => [name, JSON.parse(readFileSync(`public/data/${name}`, 'utf8')) as unknown]));

function mockAssets(replacements: Partial<Record<typeof names[number], unknown>> = {}) {
  const fetchAsset = vi.fn(async (input: string) => {
    const name = names.find(name => input === assetPath(`/data/${name}`));
    if (!name) throw new Error(`Unexpected asset ${input}`);
    const value = Object.hasOwn(replacements, name) ? replacements[name] : fixtures[name];
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchAsset);
  return fetchAsset;
}

afterEach(() => vi.unstubAllGlobals());

describe('bundled site loading', () => {
  it('loads all JSON assets with revalidation and keeps their geographic content', async () => {
    const fetchAsset = mockAssets();
    const site = await loadSite();
    expect(fetchAsset.mock.calls.map(([path]) => path)).toEqual(names.map(name => assetPath(`/data/${name}`)));
    for (const call of fetchAsset.mock.calls) expect(call).toEqual([call[0], { cache: 'no-cache' }]);
    expect(site.zone).toEqual(fixtures['zone.json']);
    expect(site.buildings).toEqual(fixtures['buildings.json']);
    expect(site.roads).toEqual(fixtures['roads.json']);
    expect(site.defaultPlot).toEqual(fixtures['study-plot.json']);
    expect(site.roadsCatalog).toEqual(fixtures['roads-catalog.json']);
    expect(site.metadata).toEqual(fixtures['metadata.json']);
    const points = site.defaultPlot.geometry.coordinates[0].slice(0, -1);
    expect(site.center).toEqual([0, 1].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length));
  });

  it.each(names)('rejects invalid content in %s', async name => {
    mockAssets({ [name]: null });
    await expect(loadSite()).rejects.toThrow(`Site asset /data/${name} failed validation`);
  });

  it('rejects an open plot ring before calculating its center', async () => {
    const plot = structuredClone(fixtures['study-plot.json']) as PlotFeature;
    plot.geometry.coordinates[0].pop();
    mockAssets({ 'study-plot.json': plot });
    await expect(loadSite()).rejects.toThrow('Site asset /data/study-plot.json failed validation');
  });

  it('identifies HTTP failures at the requested asset path', async () => {
    const fetchAsset = mockAssets();
    fetchAsset.mockImplementationOnce(async () => new Response('', { status: 404 }));
    await expect(loadSite()).rejects.toThrow(`Site asset ${assetPath('/data/zone.json')} returned HTTP 404`);
  });

  it('identifies unreadable JSON at the requested asset path', async () => {
    const fetchAsset = mockAssets();
    fetchAsset.mockImplementationOnce(async () => new Response('{'));
    await expect(loadSite()).rejects.toThrow(`Site asset ${assetPath('/data/zone.json')} is not valid JSON`);
  });

  it('identifies network failures with a reload instruction', async () => {
    const fetchAsset = mockAssets();
    fetchAsset.mockRejectedValueOnce(new TypeError('Connection closed'));
    await expect(loadSite()).rejects.toThrow(`Could not load site asset ${assetPath('/data/zone.json')}. Check the connection and reload the page.`);
  });
});
