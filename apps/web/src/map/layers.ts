import type { PropertySummary } from '@roofing-crm/pipeline-client';
import { circleRing, type GeoPoint } from '@roofing-crm/shared';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
} from 'maplibre-gl';

export const SEARCH_AREA_SOURCE = 'search-area';
export const RESULTS_SOURCE = 'results';
export const RESULTS_CLUSTER_LAYER = 'results-clusters';
export const RESULTS_CLUSTER_COUNT_LAYER = 'results-cluster-count';
export const RESULTS_POINT_LAYER = 'results-points';
export const SELECTED_SOURCE = 'selected';
export const SELECTED_LAYER = 'selected-point';

export const MAP_COLORS = {
  accent: '#0f766e',
  aged: '#c2410c',
  agedCluster: '#9a3412',
  permit: '#7c3aed',
  permitCluster: '#5b21b6',
  longOpen: '#be123c',
  longOpenCluster: '#9f1239',
  halo: '#ffffff',
} as const;

/** One of the basemap's self-hosted font stacks (scripts/basemap.ts), so no glyph request leaves the origin. */
export const LABEL_FONT = ['Noto Sans Medium'];

/**
 * The strongest lead signal of a match, which colors its marker: a long-open roofing permit, then
 * an open or stalled one, then an aged roof (README AC 5: emphasis on long-open permits).
 */
export type ResultSignal = 'long_open' | 'permit' | 'aged';

export function resultSignal(item: Pick<PropertySummary, 'match_reasons'>): ResultSignal {
  const reasons = item.match_reasons ?? [];
  if (reasons.includes('long_open_roofing_permit')) return 'long_open';
  if (reasons.includes('open_roofing_permit') || reasons.includes('stalled_roofing_permit')) {
    return 'permit';
  }
  return 'aged';
}

interface ResultProperties {
  id: string;
  signal: ResultSignal;
}

/** A matching property on the map: its position, its signal and the id that links it to its row. */
export type ResultFeature = Feature<Point, ResultProperties>;
export type ResultCollection = FeatureCollection<Point, ResultProperties>;

export const NO_RESULTS: ResultCollection = { type: 'FeatureCollection', features: [] };

/** Markers for the rows that have coordinates; the id links each marker to its list row. */
export function resultFeatures(items: readonly PropertySummary[]): ResultCollection {
  const features: ResultFeature[] = [];
  for (const item of items) {
    if (item.lat === null || item.lon === null) continue;
    features.push({
      type: 'Feature',
      properties: { id: item.property_id, signal: resultSignal(item) },
      geometry: { type: 'Point', coordinates: [item.lon, item.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

const SIGNAL: ExpressionSpecification = ['get', 'signal'];

const signalColor: DataDrivenPropertyValueSpecification<string> = [
  'match',
  SIGNAL,
  'long_open',
  MAP_COLORS.longOpen,
  'permit',
  MAP_COLORS.permit,
  MAP_COLORS.aged,
];

/** A cluster takes the color of the strongest signal inside it. */
const clusterColor: DataDrivenPropertyValueSpecification<string> = [
  'case',
  ['>', ['get', 'longOpen'], 0],
  MAP_COLORS.longOpenCluster,
  ['>', ['get', 'permit'], 0],
  MAP_COLORS.permitCluster,
  MAP_COLORS.agedCluster,
];

const countOf = (signal: ResultSignal): ExpressionSpecification => [
  '+',
  ['case', ['==', SIGNAL, signal], 1, 0],
];

/** The selected row's marker, drawn above the clusters so it shows even inside one. */
export function selectedFeature(
  results: ResultCollection,
  selectedId: string | null,
): ResultCollection {
  const feature = results.features.find((candidate) => candidate.properties.id === selectedId);
  return { type: 'FeatureCollection', features: feature ? [feature] : [] };
}

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
  return {
    type: 'geojson',
    data,
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 15,
    clusterProperties: { longOpen: countOf('long_open'), permit: countOf('permit') },
  };
}

export const resultsLayers: LayerSpecification[] = [
  {
    id: RESULTS_CLUSTER_LAYER,
    type: 'circle',
    source: RESULTS_SOURCE,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': clusterColor,
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
    // Long-open permits are drawn above the rest where markers overlap.
    layout: { 'circle-sort-key': ['match', SIGNAL, 'long_open', 2, 'permit', 1, 0] },
    paint: {
      'circle-color': signalColor,
      'circle-radius': 6,
      'circle-stroke-color': MAP_COLORS.halo,
      'circle-stroke-width': 1.5,
    },
  },
];

export const selectedLayer: LayerSpecification = {
  id: SELECTED_LAYER,
  type: 'circle',
  source: SELECTED_SOURCE,
  paint: {
    'circle-color': signalColor,
    'circle-radius': 9,
    'circle-stroke-color': MAP_COLORS.accent,
    'circle-stroke-width': 3,
  },
};
