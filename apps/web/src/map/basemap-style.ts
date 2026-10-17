import { layers, namedFlavor } from '@protomaps/basemaps';
import { BASEMAP_PATHS } from '@roofing-crm/shared';
import type { StyleSpecification } from 'maplibre-gl';

export const BASEMAP_SOURCE = 'protomaps';

export const BASEMAP_ATTRIBUTION =
  '<a href="https://protomaps.com" target="_blank" rel="noopener noreferrer">Protomaps</a> © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/**
 * The basemap style for a page served from `origin`: the Protomaps "light" flavor over the
 * self-hosted Travis extract, glyphs and sprites (MapLibre needs absolute glyph and sprite URLs).
 */
export function buildBasemapStyle(origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}${BASEMAP_PATHS.glyphs}`,
    sprite: `${origin}${BASEMAP_PATHS.sprite}`,
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${origin}${BASEMAP_PATHS.archive}`,
        attribution: BASEMAP_ATTRIBUTION,
      },
    },
    layers: layers(BASEMAP_SOURCE, namedFlavor('light'), { lang: 'en' }),
  };
}
