import { z } from 'zod';
import { WorkspaceIdSchema } from './leads';

// The CRM agent's chat contract (docs/decisions.md §6, the alakazam entry and the 2026-10-17 sync
// entry): the pipeline chat's request bounds and response shape, plus the browser's workspace (for the
// lead tools), the map's pin, `center_used` and `leads_created`. One module for the `agent` function
// and the Assistant page.

/** The runtime agent's name (docs/runbook.md): LangSmith project, log field, prompt version prefix. */
export const AGENT_NAME = 'pidgeot-agent';

/** At most 20 messages, 4,000 characters each and 16,000 in total, the last from the user. */
export const CHAT_LIMITS = { messages: 20, messageChars: 4000, totalChars: 16_000 } as const;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(CHAT_LIMITS.messageChars),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * One turn: the whole history, held by the browser (no server memory; alakazam item 11). Over-limit
 * requests are refused (400), never truncated (item 12).
 */
export const ChatInputSchema = z
  .object({
    workspace_id: WorkspaceIdSchema,
    session_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    messages: z.array(ChatMessageSchema).min(1).max(CHAT_LIMITS.messages),
    /** The map's pin, so "around here" has a center the user chose. */
    map_center: z
      .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
      .optional(),
  })
  .superRefine((input, context) => {
    const total = input.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (total > CHAT_LIMITS.totalChars) {
      context.addIssue({
        code: 'custom',
        path: ['messages'],
        message: `at most ${String(CHAT_LIMITS.totalChars)} characters in total`,
      });
    }
    const last = input.messages.at(-1);
    if (last?.role !== 'user' || last.content.trim() === '') {
      context.addIssue({
        code: 'custom',
        path: ['messages'],
        message: 'the last message must be a non-empty user message',
      });
    }
  });
export type ChatInput = z.input<typeof ChatInputSchema>;

export const CHAT_OUTCOMES = [
  'answered',
  'no_matches',
  'needs_clarification',
  'out_of_scope',
  'out_of_county',
  'limit_reached',
  'tool_error',
] as const;
export type ChatOutcome = (typeof CHAT_OUTCOMES)[number];

/** One tool call of the turn: what was asked and a one-line, count-only summary of the result. */
export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'ok' | 'error' | 'rate_limited' | 'timeout';
  total: number | null;
  returned: number | null;
  result_summary: string;
}

export type ChatEvidenceKind =
  'property' | 'permit' | 'contractor' | 'search_center' | 'run' | 'lead';

/** A record a tool returned in this turn, built by the server, never taken from the model's text. */
export interface ChatEvidence {
  kind: ChatEvidenceKind;
  tool_call_id: string;
  property_id: string | null;
  permit_id: string | null;
  contractor_attribution_key: string | null;
  /** The published record's CID, when it has one. */
  record_cid: string | null;
  /** The record's source page. */
  source_url: string | null;
  /** What the page shows for it: an address, a contractor's printed name, a place. */
  label: string | null;
}

/** Missing or partial data the answer depends on, from `/v1/meta.limitations` and this turn. */
export interface ChatLimitation {
  source: string;
  reason: string | null;
  detail: string;
}

/** The center the searches of this turn used: a resolved place, or the map's pin. */
export interface ChatCenter {
  name: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface ChatLeadCreated {
  lead_id: string;
  property_id: string;
  permit_id: string;
  outcome: 'created' | 'existing';
}

/** A record an answer offers to save as a lead: a property, or one of its permits. */
export interface ChatOfferedLead {
  property_id: string;
  /** Empty for a property lead. */
  permit_id: string;
}

export interface ChatResponse {
  outcome: ChatOutcome;
  /** Markdown subset, no HTML, images or links; ids cited as [[property:<id>]], [[permit:<id>]], … */
  answer: string;
  assumptions: string[];
  tool_calls: ChatToolCall[];
  evidence: ChatEvidence[];
  limitations: ChatLimitation[];
  center_used: ChatCenter | null;
  leads_created: ChatLeadCreated[];
  /**
   * The records the answer offers to save (its SAVE_OFFER line), each one a tool returned in this
   * turn and the answer cites, at most 5; empty when it offers none. The Assistant page saves them
   * with `leads.createMany` when the user presses its Save button.
   */
  save_offer: ChatOfferedLead[];
  run_id: string;
  model_id: string;
  prompt_version: string;
  request_id: string;
}

/** Why the agent cannot take a turn now (503): the daily budget, the model, or repeated failures. */
export const AGENT_UNAVAILABLE_REASONS = [
  'budget_exhausted',
  'model_unavailable',
  'circuit_open',
] as const;
export type AgentUnavailableReason = (typeof AGENT_UNAVAILABLE_REASONS)[number];

/** A citation token in an answer: `[[property:103857]]`. */
export const CITATION_TOKEN = /\[\[(property|permit|contractor|run):([^\]\n]+)\]\]/g;
