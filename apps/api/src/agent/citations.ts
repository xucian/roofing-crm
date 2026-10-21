import { CITABLE, type EvidenceCollector } from './evidence';

/**
 * The citation check, as in the pipeline agent: every id the model writes must name a record a tool
 * returned in this turn, and every CID one a tool returned. That covers the `[[kind:id]]` tokens and
 * ids written outside them: bare Austin permit numbers, 32-hex contractor keys and "property <id>"
 * mentions. A bare id a lookup found missing may be named ("permit X is not in this dataset"), never
 * cited as a token. Anything else fails closed: the server returns no model text and `tool_error`.
 * Run over the answer and the model's assumption lines together.
 */
export interface CitationCheck {
  ok: boolean;
  cited: { kind: string; id: string }[];
  failures: { token: string; reason: string }[];
}

const TOKEN = /\[\[([^\]\n]*)\]\]/g;
/** CIDv1 in base32 (`bafy…`, `bagu…`), as the dataset writes them. */
const CID = /\bba[a-z2-7]{40,}\b/g;
/** An Austin permit number (`1981-001682 BP`), also with a hyphen or no separator before the type. */
const BARE_PERMIT = /\b(\d{4}-\d{6})[ -]?([A-Z]{2})\b/g;
/** Exactly 32 hex characters: a contractor attribution key. */
const HEX32 = /\b[0-9a-f]{32}\b/g;
/** "property 103857", "property ID 103857", "property #103857". */
const PROPERTY_MENTION = /\bproperty(?:\s+id)?\s*(?:#|no\.|number)?\s*:?\s*(\d{3,9})\b/gi;

export function checkCitations(text: string, evidence: EvidenceCollector): CitationCheck {
  const cited: CitationCheck['cited'] = [];
  const failures: CitationCheck['failures'] = [];
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    const inner = match[1] ?? '';
    const colon = inner.indexOf(':');
    if (colon <= 0) {
      failures.push({ token, reason: 'malformed citation token' });
      continue;
    }
    const kind = inner.slice(0, colon).trim();
    const id = inner.slice(colon + 1).trim();
    const evidenceKind = CITABLE[kind];
    if (!evidenceKind) {
      failures.push({ token, reason: `unknown citation kind ${kind}` });
      continue;
    }
    if (!id || !evidence.has(evidenceKind, id)) {
      failures.push({ token, reason: `no tool returned ${kind} ${id} in this turn` });
      continue;
    }
    cited.push({ kind, id });
  }
  const rest = text.replace(TOKEN, ' ');
  for (const match of rest.matchAll(BARE_PERMIT)) {
    const id = `${match[1] ?? ''} ${match[2] ?? ''}`;
    if (!evidence.mentionable('permit', id)) {
      failures.push({ token: match[0], reason: `no tool returned permit ${id} in this turn` });
    }
  }
  for (const match of rest.matchAll(HEX32)) {
    if (!evidence.mentionable('contractor', match[0])) {
      failures.push({ token: match[0], reason: 'no tool returned this key in this turn' });
    }
  }
  for (const match of rest.matchAll(PROPERTY_MENTION)) {
    const id = match[1] ?? '';
    if (!evidence.mentionable('property', id)) {
      failures.push({ token: match[0], reason: `no tool returned property ${id} in this turn` });
    }
  }
  for (const match of text.matchAll(CID)) {
    if (!evidence.cids.has(match[0])) {
      failures.push({ token: match[0], reason: 'no tool returned this CID in this turn' });
    }
  }
  return { ok: failures.length === 0, cited, failures };
}
