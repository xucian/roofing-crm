import { MAP_BOUNDS, type GeoPoint } from '@roofing-crm/shared';
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  type LngLatBoundsLike,
} from 'maplibre-gl';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CenterSource } from '../search/search-state';
import { buildBasemapStyle } from './basemap-style';
import {
  MAP_COLORS,
  RESULTS_CLUSTER_LAYER,
  RESULTS_POINT_LAYER,
  RESULTS_SOURCE,
  SEARCH_AREA_SOURCE,
  resultsLayers,
  resultsSource,
  searchAreaBounds,
  searchAreaData,
  searchAreaLayers,
  type ResultCollection,
} from './layers';
import { setupMapLibre } from './maplibre-setup';

export interface MapViewProps {
  center: GeoPoint;
  centerSource: CenterSource;
  radiusMiles: number;
  results: ResultCollection;
  /** A click on empty map or a dragged pin: the new search center. */
  onPick: (point: GeoPoint) => void;
  /** The map or its basemap failed; the message is shown over the map. */
  onProblem: (message: string) => void;
}

const MAX_BOUNDS: LngLatBoundsLike = [
  [MAP_BOUNDS.west, MAP_BOUNDS.south],
  [MAP_BOUNDS.east, MAP_BOUNDS.north],
];
const FIT_OPTIONS = { padding: 40, maxZoom: 15, duration: 600 } as const;
/** Camera moves wait for the radius slider to settle. */
const CAMERA_SETTLE_MS = 350;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function MapView({
  center,
  centerSource,
  radiusMiles,
  results,
  onPick,
  onProblem,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<Marker | null>(null);
  const lastFramed = useRef<{ lat: number; lon: number; radiusMiles: number } | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [initial] = useState(() => ({ center, radiusMiles }));
  const pick = useEffectEvent(onPick);
  const problem = useEffectEvent(onProblem);

  // Create the map once; React state flows in through the effects below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    setupMapLibre();

    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container,
        style: buildBasemapStyle(window.location.origin),
        bounds: searchAreaBounds(initial.center, initial.radiusMiles),
        fitBoundsOptions: { padding: FIT_OPTIONS.padding },
        maxBounds: MAX_BOUNDS,
        minZoom: 8,
        maxZoom: 18,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch (error) {
      problem(`This browser cannot show the map (${errorText(error)}).`);
      return undefined;
    }
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    instance.addControl(new ScaleControl({ unit: 'imperial' }), 'bottom-right');
    instance.touchZoomRotate.disableRotation();
    instance.getCanvas().style.cursor = 'crosshair';
    // The Protomaps style names a few POI icons its sprite sheet lacks (for example "townhall"): those
    // places keep their label and get a transparent icon instead of a console warning.
    instance.setMissingStyleImageResolver((id) => {
      if (!instance.hasImage(id)) {
        instance.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      }
    });

    let reported = false;
    instance.on('error', (event) => {
      if (reported) return;
      reported = true;
      problem(`The basemap could not be loaded (${errorText(event.error)}).`);
    });

    instance.on('load', () => {
      instance.addSource(SEARCH_AREA_SOURCE, {
        type: 'geojson',
        data: searchAreaData(initial.center, initial.radiusMiles),
      });
      for (const layer of searchAreaLayers) instance.addLayer(layer);
      instance.addSource(RESULTS_SOURCE, resultsSource());
      for (const layer of resultsLayers) instance.addLayer(layer);
      setMap(instance);
    });

    instance.on('click', (event) => {
      const hits = instance.getLayer(RESULTS_CLUSTER_LAYER)
        ? instance.queryRenderedFeatures(event.point, {
            layers: [RESULTS_CLUSTER_LAYER, RESULTS_POINT_LAYER],
          })
        : [];
      const cluster = hits.find((feature) => feature.layer.id === RESULTS_CLUSTER_LAYER);
      const clusterId: unknown = cluster?.properties.cluster_id;
      if (cluster && typeof clusterId === 'number') {
        const source = instance.getSource<GeoJSONSource>(RESULTS_SOURCE);
        void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
          instance.easeTo({ center: event.lngLat, zoom });
        });
        return;
      }
      // A click on a match marker never moves the search center.
      if (hits.length > 0) return;
      pick({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    for (const layer of [RESULTS_CLUSTER_LAYER, RESULTS_POINT_LAYER]) {
      instance.on('mouseenter', layer, () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', layer, () => {
        instance.getCanvas().style.cursor = 'crosshair';
      });
    }

    const marker = new Marker({ draggable: true, color: MAP_COLORS.accent })
      .setLngLat([initial.center.lon, initial.center.lat])
      .addTo(instance);
    const markerElement = marker.getElement();
    markerElement.setAttribute('aria-label', 'Search center (drag to move)');
    markerElement.title = 'Search center: drag to move';
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLngLat();
      pick({ lat, lon: lng });
    });
    markerRef.current = marker;

    return () => {
      markerRef.current = null;
      lastFramed.current = null;
      setMap(null);
      instance.remove();
    };
  }, [initial]);

  // Keep the pin and the circle on the current search.
  useEffect(() => {
    if (!map) return;
    markerRef.current?.setLngLat([center.lon, center.lat]);
    map
      .getSource<GeoJSONSource>(SEARCH_AREA_SOURCE)
      ?.setData(searchAreaData(center, radiusMiles))
      .catch((error: unknown) => {
        problem(`The search area could not be drawn (${errorText(error)}).`);
      });
  }, [map, center, radiusMiles]);

  // Frame the circle when the radius changes or the center comes from GPS, a reset or a link; a
  // dropped pin keeps the camera where the user is looking.
  useEffect(() => {
    if (!map) return undefined;
    const timer = window.setTimeout(() => {
      const previous = lastFramed.current ?? {
        lat: initial.center.lat,
        lon: initial.center.lon,
        radiusMiles: initial.radiusMiles,
      };
      lastFramed.current = { lat: center.lat, lon: center.lon, radiusMiles };
      const radiusChanged = previous.radiusMiles !== radiusMiles;
      const centerMoved = previous.lat !== center.lat || previous.lon !== center.lon;
      if (radiusChanged || (centerMoved && centerSource !== 'pin')) {
        map.fitBounds(searchAreaBounds(center, radiusMiles), FIT_OPTIONS);
      }
    }, CAMERA_SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [map, center, centerSource, radiusMiles, initial]);

  // Matches as clustered markers.
  useEffect(() => {
    map
      ?.getSource<GeoJSONSource>(RESULTS_SOURCE)
      ?.setData(results)
      .catch((error: unknown) => {
        problem(`The matches could not be drawn on the map (${errorText(error)}).`);
      });
  }, [map, results]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      role="region"
      aria-label="Map of Travis County. Click to drop the search pin."
    />
  );
}
