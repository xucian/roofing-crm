import type { SearchCenter } from '@roofing-crm/pipeline-client';
import type { GeoPoint } from '@roofing-crm/shared';

/**
 * The search-center rule, as in the pipeline agent: a search's `lat`/`lon` must be a point that
 * `resolve_search_center` returned in this turn, the map's pin the page sent, or numbers the user
 * typed. Anything else is refused before the call, so the model cannot search around a coordinate
 * it recalled or invented.
 */
export interface CenterPoint extends SearchCenter {
  /** False when the call that returned it had no exact match (only prefix or alias matches). */
  confirmed: boolean;
}

/** Rounding to four decimals (about 11 m) still counts as the returned point. */
export const CENTER_TOLERANCE_DEG = 1e-4;

/** A typed coordinate: an optional sign (U+2212 too), decimals, and an optional N, S, E or W. */
const NUMBER = /([-+\u2212]?)(\d{1,3}\.\d+)\s*°?\s*([NSEW]\b)?/gi;

/** The numbers a user typed: signed by their minus or their S/W, and both signs when unmarked. */
export function typedNumbers(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const value = Number(match[2]);
    const hemisphere = (match[3] ?? '').toUpperCase();
    if (match[1] === '-' || match[1] === '\u2212' || hemisphere === 'S' || hemisphere === 'W') {
      out.push(-value);
    } else if (match[1] === '+' || hemisphere === 'N' || hemisphere === 'E') {
      out.push(value);
    } else {
      out.push(value, -value);
    }
  }
  return out;
}

/** The map's pin as a center: what `center_used` reports when a search ran around it. */
export const MAP_PIN = { name: "Map's pin", kind: 'map_pin' } as const;

export type GuardResult =
  { ok: true; center: CenterPoint | null; pin: boolean } | { ok: false; detail: string };

export class CoordinateGuard {
  private readonly centers: CenterPoint[] = [];
  private readonly typed: number[];

  /** `userTexts`: every user message of the request; `pin`: the map's pin, when the page sent it. */
  constructor(
    userTexts: string[],
    private readonly pin: GeoPoint | null,
  ) {
    this.typed = userTexts.flatMap(typedNumbers);
  }

  /** Records what one resolve_search_center call returned; without an exact match, unconfirmed. */
  addCenters(items: SearchCenter[]): void {
    const confirmed = items.some((center) => center.match_type === 'exact');
    for (const center of items) {
      if (Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
        this.centers.push({ ...center, confirmed });
      }
    }
  }

  check(lat: number | undefined, lon: number | undefined): GuardResult {
    if (lat === undefined && lon === undefined) return { ok: true, center: null, pin: false };
    if (lat === undefined || lon === undefined) {
      return { ok: false, detail: 'lat and lon must be given together' };
    }
    const near = (point: GeoPoint) =>
      Math.abs(point.lat - lat) <= CENTER_TOLERANCE_DEG &&
      Math.abs(point.lon - lon) <= CENTER_TOLERANCE_DEG;
    const matches = this.centers.filter(near);
    const center = matches.find((candidate) => candidate.confirmed);
    if (center) return { ok: true, center, pin: false };
    if (matches.length > 0) {
      return {
        ok: false,
        detail:
          'unconfirmed_search_center: resolve_search_center returned only prefix or alias matches for this place; ask the user which place they meant before searching (outcome needs_clarification)',
      };
    }
    if (this.pin && near(this.pin)) return { ok: true, center: null, pin: true };
    const typedLat = this.typed.some((n) => Math.abs(n - lat) <= CENTER_TOLERANCE_DEG);
    const typedLon = this.typed.some((n) => Math.abs(n - lon) <= CENTER_TOLERANCE_DEG);
    if (typedLat && typedLon) return { ok: true, center: null, pin: false };
    return {
      ok: false,
      detail:
        "coordinates_not_allowed: lat/lon must be a point resolve_search_center returned in this turn, the map's pin, or numbers the user typed; call resolve_search_center first",
    };
  }
}
