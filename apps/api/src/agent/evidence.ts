import type {
  Contractor,
  Meta,
  PermitSummary,
  PropertySummary,
  SearchCenter,
} from '@roofing-crm/pipeline-client';
import type {
  ChatCenter,
  ChatEvidence,
  ChatEvidenceKind,
  ChatLimitation,
  Lead,
} from '@roofing-crm/shared';
import { MAP_PIN, type CenterPoint } from './guard';

/** The citation-token kinds the answer may use, and the evidence each one is checked against. */
export const CITABLE: Readonly<Record<string, ChatEvidenceKind>> = {
  property: 'property',
  permit: 'permit',
  contractor: 'contractor',
  run: 'run',
};

const blank = (kind: ChatEvidenceKind, toolCallId: string): ChatEvidence => ({
  kind,
  tool_call_id: toolCallId,
  property_id: null,
  permit_id: null,
  contractor_attribution_key: null,
  record_cid: null,
  source_url: null,
  label: null,
});

/** The first value that is not null, undefined or blank. */
export function firstText(...values: (string | null | undefined)[]): string | null {
  return (
    values.find((value) => value !== null && value !== undefined && value.trim() !== '') ?? null
  );
}

/** "802 BARTON BLVD, AUSTIN 78704" from a pipeline or snapshot address. */
export function addressLabel(
  address: { line1?: string | null; city?: string | null; zip?: string | null } | null | undefined,
): string | null {
  if (!address) return null;
  const place = [address.city, address.zip].filter((part) => part).join(' ');
  return [address.line1, place].filter((part) => part).join(', ') || null;
}

/**
 * Builds `evidence[]` from this turn's tool results, never from the model's text (as the pipeline
 * agent does): every record a tool returned, once, under the first call that returned it. It also
 * keeps what the server's checks need: the ids per kind, every CID a tool returned, and what kinds of
 * records appeared (for the limitations and assumptions).
 */
export class EvidenceCollector {
  readonly items: ChatEvidence[] = [];
  readonly cids = new Set<string>();
  readonly seen = {
    properties: 0,
    permits: 0,
    permitsNeedsReview: 0,
    contractors: 0,
    leads: 0,
    durationsAsOf: null as string | null,
  };
  private readonly ids = new Map<ChatEvidenceKind, Set<string>>();
  /** Properties named by a permit or a lead: citable, since a tool returned them in this turn. */
  private readonly namedProperties = new Set<string>();
  private readonly namedPermits = new Set<string>();
  /** Ids a lookup found missing: the answer may name them (a clear miss), never cite them. */
  private readonly missing = new Set<string>();

  constructor(private readonly runId: string) {}

  has(kind: ChatEvidenceKind, id: string): boolean {
    if (this.ids.get(kind)?.has(id)) return true;
    // The turn read /v1/meta first, so the current run is known without get_run_summary.
    if (kind === 'run') return id === this.runId;
    if (kind === 'property') return this.namedProperties.has(id);
    if (kind === 'permit') return this.namedPermits.has(id);
    return false;
  }

  /** Whether the answer may name the id: returned by a tool, or looked up and not found. */
  mentionable(kind: ChatEvidenceKind, id: string): boolean {
    return this.has(kind, id) || this.missing.has(`${kind}|${id}`);
  }

  addMissing(kind: ChatEvidenceKind, id: string): void {
    this.missing.add(`${kind}|${id}`);
  }

  private push(item: ChatEvidence, id: string): void {
    let set = this.ids.get(item.kind);
    if (!set) this.ids.set(item.kind, (set = new Set()));
    if (set.has(id)) return;
    set.add(id);
    this.items.push(item);
  }

  private cid(...values: unknown[]): void {
    for (const value of values) if (typeof value === 'string' && value) this.cids.add(value);
  }

  private property(property: PropertySummary, callId: string): void {
    this.seen.properties += 1;
    this.cid(property.record_cid, property.property_cid, property.data_group_cid);
    this.push(
      {
        ...blank('property', callId),
        property_id: property.property_id,
        record_cid: property.record_cid,
        source_url: property.source.url,
        label: addressLabel(property.address),
      },
      property.property_id,
    );
  }

  private permit(permit: PermitSummary, callId: string, label: string | null = null): void {
    this.seen.permits += 1;
    if (permit.status_group === 'needs_review' || permit.roof_work_class === 'needs_review') {
      this.seen.permitsNeedsReview += 1;
    }
    if (permit.open_duration_as_of) this.seen.durationsAsOf = permit.open_duration_as_of;
    this.cid(permit.record_cid, permit.property_cid, permit.data_group_cid);
    if (permit.property_id) this.namedProperties.add(permit.property_id);
    this.push(
      {
        ...blank('permit', callId),
        permit_id: permit.permit_id,
        property_id: permit.property_id,
        record_cid: permit.record_cid,
        source_url: permit.source.url,
        label,
      },
      permit.permit_id,
    );
    const contractor = permit.contractor;
    if (!contractor?.contractor_attribution_key) return;
    // An attribution has no record of its own: it is backed by the permit it was printed on.
    this.seen.contractors += 1;
    this.push(
      {
        ...blank('contractor', callId),
        contractor_attribution_key: contractor.contractor_attribution_key,
        permit_id: permit.permit_id,
        source_url: permit.source.url,
        label: firstText(contractor.company_name, contractor.printed_name),
      },
      contractor.contractor_attribution_key,
    );
  }

  addCenters(callId: string, centers: SearchCenter[]): void {
    for (const center of centers) {
      this.push(
        { ...blank('search_center', callId), label: `${center.name} (${center.kind})` },
        `${center.name}|${center.kind}`,
      );
    }
  }

  addProperties(callId: string, properties: PropertySummary[]): void {
    for (const property of properties) this.property(property, callId);
  }

  addProperty(callId: string, property: PropertySummary, permits: PermitSummary[]): void {
    this.property(property, callId);
    for (const permit of permits) this.permit(permit, callId, addressLabel(property.address));
  }

  addPermits(callId: string, permits: PermitSummary[]): void {
    for (const permit of permits) this.permit(permit, callId);
  }

  addPermit(callId: string, permit: PermitSummary, property: PropertySummary | null): void {
    this.permit(permit, callId, property ? addressLabel(property.address) : null);
    if (property) this.property(property, callId);
  }

  addContractor(callId: string, contractor: Contractor): void {
    this.seen.contractors += 1;
    this.push(
      {
        ...blank('contractor', callId),
        contractor_attribution_key: contractor.contractor_attribution_key,
        label: contractor.company_name ?? contractor.printed_names[0] ?? null,
      },
      contractor.contractor_attribution_key,
    );
  }

  addRun(callId: string, meta: Meta): void {
    this.cid(meta.manifest_cid);
    for (const group of Object.values(meta.groups)) this.cid(group.cid);
    if (meta.run.run_id === this.runId) {
      this.push({ ...blank('run', callId), label: meta.run.run_id }, this.runId);
    }
  }

  /** Leads of this workspace: their property and permit ids become citable. */
  addLeads(callId: string, leads: Lead[]): void {
    for (const lead of leads) {
      this.seen.leads += 1;
      this.namedProperties.add(lead.property_id);
      if (lead.permit_id) this.namedPermits.add(lead.permit_id);
      this.push(
        {
          ...blank('lead', callId),
          property_id: lead.property_id,
          permit_id: lead.permit_id || null,
          label: addressLabel(lead.snapshot.address),
        },
        `${lead.property_id}#${lead.permit_id}`,
      );
    }
  }
}

/** Limitations the answer depends on: from `/v1/meta.limitations`, by what this turn returned. */
export function turnLimitations(meta: Meta, evidence: EvidenceCollector): ChatLimitation[] {
  const out: ChatLimitation[] = [];
  const add = (match: (source: string, reason: string | null) => boolean) => {
    for (const limitation of meta.limitations) {
      if (match(limitation.source, limitation.incomplete_reason ?? null)) {
        out.push({
          source: limitation.source,
          reason: limitation.incomplete_reason ?? null,
          detail: limitation.detail,
        });
      }
    }
  };
  if (evidence.seen.contractors > 0) add((source) => source === 'bbb.org');
  if (evidence.seen.permits > 0) {
    out.push({
      source: 'austin-issued-construction-permits/3syk-w9eu',
      reason: 'needs_review',
      detail: `${String(evidence.seen.permitsNeedsReview)} of the ${String(evidence.seen.permits)} permits returned in this turn are needs_review (status or work class unmapped); county-wide ${meta.counts.roofing_permits_needs_review.toLocaleString('en-US')} roofing permits are, and they never count as open.`,
    });
  }
  if (evidence.seen.properties > 0) add((_, reason) => reason === 'partial_history');
  return out;
}

/** Server assumptions: the centers the searches used, and the identity and snapshot rules. */
export function turnAssumptions(
  evidence: EvidenceCollector,
  used: { centers: CenterPoint[]; pin: boolean },
  pin: { lat: number; lon: number } | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const center of used.centers) {
    const key = `${center.name}|${center.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      `Search center ${center.name} (${center.kind}, ${center.match_type} match): ${center.parcel_count.toLocaleString('en-US')} parcels; ${center.basis} (those with coordinates); distances are measured from that point.`,
    );
  }
  if (used.pin && pin) {
    out.push(
      `Search center: the map's pin at ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}; distances are measured from it.`,
    );
  }
  if (evidence.seen.contractors > 0) {
    out.push(
      'Contractors are the listed contractor as printed on the permit, not a verified identity.',
    );
  }
  if (evidence.seen.durationsAsOf) {
    out.push(`Open durations are computed as of ${evidence.seen.durationsAsOf}.`);
  }
  if (evidence.seen.leads > 0) {
    out.push("Leads are matched on the snapshot saved with each lead, not on today's data.");
  }
  return out;
}

/** The center the turn's searches used first: a resolved place, else the map's pin. */
export function centerUsed(
  used: { centers: CenterPoint[]; pin: boolean },
  pin: { lat: number; lon: number } | null,
): ChatCenter | null {
  const first = used.centers[0];
  if (first) return { name: first.name, kind: first.kind, lat: first.lat, lon: first.lon };
  if (used.pin && pin) return { ...MAP_PIN, lat: pin.lat, lon: pin.lon };
  return null;
}
