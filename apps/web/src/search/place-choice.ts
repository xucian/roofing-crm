import type { SearchCenter } from '@roofing-crm/pipeline-client';
import { formatCount } from '@roofing-crm/shared';

export type PlaceChoice =
  | { kind: 'go'; center: SearchCenter }
  | { kind: 'ask'; centers: SearchCenter[] }
  | { kind: 'none' };

/**
 * One exact match moves the map; otherwise the user picks which place was meant, since a prefix or
 * an alias is a guess (docs/decisions.md 2026-10-17). No match is said as such: nothing is geocoded.
 */
export function choosePlace(centers: readonly SearchCenter[]): PlaceChoice {
  if (centers.length === 0) return { kind: 'none' };
  const exact = centers.filter((center) => center.match_type === 'exact');
  const [only] = exact;
  if (exact.length === 1 && only) return { kind: 'go', center: only };
  return { kind: 'ask', centers: [...centers] };
}

const MATCH_TYPE_LABELS: Readonly<Record<SearchCenter['match_type'], string>> = {
  exact: 'exact match',
  prefix: 'starts with your text',
  alias: 'known alias',
};

/** "AUSTIN · city · exact match · 312,004 parcels". */
export function describePlace(center: SearchCenter): string {
  const kind = center.kind === 'zip' ? 'ZIP' : 'city';
  const parcels = `${formatCount(center.parcel_count)} ${center.parcel_count === 1 ? 'parcel' : 'parcels'}`;
  return `${center.name} · ${kind} · ${MATCH_TYPE_LABELS[center.match_type]} · ${parcels}`;
}
