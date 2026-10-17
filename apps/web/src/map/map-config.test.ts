import { BASEMAP_FONT_STACKS, BASEMAP_PATHS, greatCircleMiles } from '@roofing-crm/shared';
import { describe, expect, it } from 'vitest';
import { buildBasemapStyle } from './basemap-style';
import {
  LABEL_FONT,
  RESULTS_CLUSTER_COUNT_LAYER,
  resultsLayers,
  resultsSource,
  searchAreaBounds,
  searchAreaData,
} from './layers';

const ORIGIN = 'https://d1234abcd.cloudfront.net';

/** Every font-stack name a style expression can request. */
function fontStacks(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every((item) => typeof item === 'string' && item.startsWith('Noto Sans'))
    ) {
      for (const item of value as string[]) found.add(item);
    } else {
      for (const item of value) fontStacks(item, found);
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) fontStacks(item, found);
  }
  return found;
}

describe('buildBasemapStyle', () => {
  const style = buildBasemapStyle(ORIGIN);

  it('reads the archive, glyphs and sprites from the CRM origin only', () => {
    expect(style.glyphs).toBe(`${ORIGIN}${BASEMAP_PATHS.glyphs}`);
    expect(style.sprite).toBe(`${ORIGIN}${BASEMAP_PATHS.sprite}`);
    expect(style.sources.protomaps).toMatchObject({
      type: 'vector',
      url: `pmtiles://${ORIGIN}/basemap/travis.pmtiles`,
    });
    const urls = JSON.stringify(style).match(/https?:\/\/[^"\s<]+/g) ?? [];
    const fetched = urls.filter(
      (url) =>
        !url.startsWith('https://protomaps.com') && !url.startsWith('https://openstreetmap.org'),
    );
    expect(fetched.every((url) => url.startsWith(ORIGIN))).toBe(true);
  });

  it('requests only font stacks that the basemap script self-hosts', () => {
    const requested = fontStacks([style.layers, resultsLayers]);
    expect(requested.size).toBeGreaterThan(0);
    expect(
      [...requested].filter((stack) => !(BASEMAP_FONT_STACKS as readonly string[]).includes(stack)),
    ).toEqual([]);
    expect(LABEL_FONT.every((stack) => requested.has(stack))).toBe(true);
  });
});

describe('search area and results layers', () => {
  it('draws the circle at the radius and frames it', () => {
    const center = { lat: 30.2672, lon: -97.7431 };
    const ring = searchAreaData(center, 5).geometry.coordinates[0] ?? [];
    expect(ring.length).toBeGreaterThan(8);
    for (const [lon = 0, lat = 0] of ring) {
      expect(greatCircleMiles(center, { lat, lon })).toBeCloseTo(5, 5);
    }
    const [[west, south], [east, north]] = searchAreaBounds(center, 5);
    expect(west).toBeLessThan(center.lon);
    expect(east).toBeGreaterThan(center.lon);
    expect(north - south).toBeCloseTo(10 / 69.09, 2);
  });

  it('clusters the matches and labels clusters with a self-hosted font', () => {
    expect(resultsSource()).toMatchObject({ type: 'geojson', cluster: true });
    const count = resultsLayers.find((layer) => layer.id === RESULTS_CLUSTER_COUNT_LAYER);
    expect(count?.layout).toMatchObject({ 'text-font': ['Noto Sans Medium'] });
  });
});
