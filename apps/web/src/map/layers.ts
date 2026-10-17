import { circleRing, type GeoPoint } from '@roofing-crm/shared';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';

export const SEARCH_AREA_SOURCE = 'search-area';
export const RESULTS_SOURCE = 'results';
export const RESULTS_CLUSTER_LAYER = 'results-clusters';
export const RESULTS_CLUSTER_COUNT_LAYER = 'results-cluster-count';
export const RESULTS_POINT_LAYER = 'results-points';

export const MAP_COLORS = {
  accent: '#0f766e',
  aged: '#c2410c',
  agedCluster: '#9a3412',
  halo: '#ffffff',
} as const;

/** One of the basemap's self-hosted font stacks (scripts/basemap.ts), so no glyph request leaves the origin. */
export const LABEL_FONT = ['Noto Sans Medium'];

/** A matching property on the map: its position and the id that links the marker to its list row. */
export type ResultFeature = Feature<Point, { id: string }>;
export type ResultCollection = FeatureCollection<Point, { id: string }>;

export const NO_RESULTS: ResultCollection = { type: 'FeatureCollection', features: [] };

export function searchAreaData(center: GeoPoint, radiusMiles: number): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [circleRing(center, radiusMiles)] },
  };
}

/** [[west, south], [east, north]] of the search circle, for framing the camera. */
export function searchAreaBounds(
  center: GeoPoint,
  radiusMiles: number,
): [[number, number], [number, number]] {
  const ring = circleRing(center, radiusMiles, 64);
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

export const searchAreaLayers: LayerSpecification[] = [
  {
    id: 'search-area-fill',
    type: 'fill',
    source: SEARCH_AREA_SOURCE,
    paint: { 'fill-color': MAP_COLORS.accent, 'fill-opacity': 0.07 },
  },
  {
    id: 'search-area-line',
    type: 'line',
    source: SEARCH_AREA_SOURCE,
    paint: { 'line-color': MAP_COLORS.accent, 'line-width': 2, 'line-opacity': 0.85 },
  },
];

/** Matches are clustered so the first 500 stay readable at county zoom (docs/decisions.md §4 "Scale"). */
export function resultsSource(data: ResultCollection = NO_RESULTS): GeoJSONSourceSpecification {
  return { type: 'geojson', data, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 };
}

export const resultsLayers: LayerSpecification[] = [
  {
    id: RESULTS_CLUSTER_LAYER,
    type: 'circle',
    source: RESULTS_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': MAP_COLORS.agedCluster,
      'circle-opacity': 0.88,
      'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23],
      'circle-stroke-color': MAP_COLORS.halo,
      'circle-stroke-width': 2,
    },
  },
  {
    id: RESULTS_CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: RESULTS_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': LABEL_FONT,
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': MAP_COLORS.halo },
  },
  {
    id: RESULTS_POINT_LAYER,
    type: 'circle',
    source: RESULTS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': MAP_COLORS.aged,
      'circle-radius': 6,
      'circle-stroke-color': MAP_COLORS.halo,
      'circle-stroke-width': 1.5,
    },
  },
];
