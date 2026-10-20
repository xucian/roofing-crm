/**
 * The prompt-injection boundary for tool text (docs/decisions.md, 2026-10-17 sync entry: third-party
 * text reaches the model only as data): every string a tool returns reaches the model capped and
 * stripped of control, zero-width and bidi characters, under the system rule that tool text is data.
 * The same as the pipeline agent's.
 */
export const TOOL_TEXT_MAX = 1000;

/** C0 and C1 controls, newlines and tabs included (a record field never needs layout): each becomes a space. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Zero-width characters and bidi marks, embeddings, overrides and isolates, built from code points. */
const INVISIBLE = new RegExp(
  `[${[
    0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x180e, 0x034f, 0x061c, 0x200e, 0x200f, 0x202a, 0x202b,
    0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ]
    .map((c) => `\\u${c.toString(16).padStart(4, '0')}`)
    .join('')}]`,
  'g',
);

/** Cleans one tool string: controls become spaces, invisible and bidi characters go, then trim and cap. */
export function sanitizeText(text: string, max = TOOL_TEXT_MAX): string {
  const out = text.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Deep copy with every string sanitized. */
export function sanitizeDeep<T>(value: T, max = TOOL_TEXT_MAX): T {
  if (typeof value === 'string') return sanitizeText(value, max) as T;
  if (Array.isArray(value)) return value.map((item: unknown) => sanitizeDeep(item, max)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeDeep(item, max);
    }
    return out as T;
  }
  return value;
}

const IMAGE = /!\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])/g;
const HTML = /<\/?[a-z!][^<>]*>/gi;
const LINK = /(?<!\[)\[([^\][\n]*)\]\(\s*[^)\n]*\)/g;
const REF_DEF = /^[ \t]*\[[^\]\n]+\]:[ \t]*\S+.*$/gm;
const BARE_URL = /\b(?:https?|ftp|data|javascript):[^\s)<>\]"']+/gi;
/** Bold and italic markers: the page renders plain text, so `**139**` would show its asterisks. */
const EMPHASIS = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * "No HTML, no images, no links" for the answer and the model's assumption lines, enforced by the
 * server before the citation check: the page renders plain text with citation chips, and the
 * evidence carries every source link. A Markdown link keeps its text and loses its target; bold
 * markers are dropped.
 */
export function sanitizeAnswer(text: string): string {
  return text
    .replace(IMAGE, '')
    .replace(HTML, '')
    .replace(REF_DEF, '')
    .replace(LINK, '$1')
    .replace(BARE_URL, '')
    .replace(EMPHASIS, '$2')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
