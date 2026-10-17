/**
 * The self-hosted basemap (metagross item 11): a Protomaps PMTiles extract of MAP_BOUNDS with the
 * glyphs and sprites of the "light" flavor, all served from the CRM's own origin under /basemap/.
 * scripts/basemap.ts builds this tree locally; the CDK stack uploads it; the web style reads it.
 */
export const BASEMAP_PREFIX = 'basemap';

export const BASEMAP_PATHS = {
  archive: `/${BASEMAP_PREFIX}/travis.pmtiles`,
  glyphs: `/${BASEMAP_PREFIX}/fonts/{fontstack}/{range}.pbf`,
  sprite: `/${BASEMAP_PREFIX}/sprites/v4/light`,
} as const;

/**
 * Every font stack the "light" style can request, including the Devanagari stack its multilingual
 * label expression names. A missing stack would send MapLibre to a 404, never to another host.
 */
export const BASEMAP_FONT_STACKS = [
  'Noto Sans Regular',
  'Noto Sans Medium',
  'Noto Sans Italic',
  'Noto Sans Devanagari Regular v1',
] as const;
