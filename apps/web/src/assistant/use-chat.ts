import {
  describeCrmApiError,
  type CrmApiClient,
  type CrmApiFailure,
} from '@roofing-crm/api-client';
import {
  CHAT_LIMITS,
  ulid,
  type ChatMessage,
  type ChatResponse,
  type GeoPoint,
} from '@roofing-crm/shared';
import { useCallback, useRef, useState } from 'react';
import type { Workspace } from '../leads/workspace';

/** One exchange on the page: the question, and the answer or why there is none. */
export interface ChatExchange {
  id: number;
  question: string;
  /** The map's pin sent with the question. */
  pin: GeoPoint | null;
  state:
    | { status: 'pending'; startedAt: number }
    | { status: 'answered'; response: ChatResponse; ms: number }
    | { status: 'failed'; error: CrmApiFailure };
}

/** The browser waits a little longer than the server's 25 s turn and CloudFront's 30 s origin limit. */
export const CHAT_TIMEOUT_MS = 35_000;

/**
 * The messages to send: the earlier answered exchanges, oldest dropped first, within the server's
 * bounds (20 messages, 4,000 characters each, 16,000 in total, the last from the user). An exchange
 * without answer text is sent as its question only, so roles may repeat; the server allows that.
 */
export function historyFor(exchanges: ChatExchange[], question: string): ChatMessage[] {
  const clip = (text: string) => text.slice(0, CHAT_LIMITS.messageChars);
  const turns: ChatMessage[][] = exchanges
    .filter((exchange) => exchange.state.status === 'answered')
    .map((exchange) => {
      const answer =
        exchange.state.status === 'answered' ? exchange.state.response.answer.trim() : '';
      const user: ChatMessage = { role: 'user', content: clip(exchange.question) };
      return answer ? [user, { role: 'assistant', content: clip(answer) }] : [user];
    });
  const last: ChatMessage = { role: 'user', content: clip(question) };
  const size = (messages: ChatMessage[]) =>
    messages.reduce((sum, message) => sum + message.content.length, 0);
  while (turns.length > 0) {
    const messages = [...turns.flat(), last];
    if (messages.length <= CHAT_LIMITS.messages && size(messages) <= CHAT_LIMITS.totalChars) {
      return messages;
    }
    turns.shift();
  }
  return [last];
}

export interface ChatStore {
  exchanges: ChatExchange[];
  pending: boolean;
  ask: (question: string, pin: GeoPoint | null) => void;
  clear: () => void;
}

/**
 * The assistant's conversation (docs/decisions.md §6): held in the page (no server memory), one
 * question at a time. A turn that saved leads asks the leads store to read them again, so the Leads
 * page and the map's marks show them.
 */
export function useChat(
  client: CrmApiClient,
  workspace: Workspace,
  onLeadsSaved: () => void,
): ChatStore {
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  const session = useRef(ulid());
  const next = useRef(0);
  const pending = exchanges.some((exchange) => exchange.state.status === 'pending');

  const ask = useCallback(
    (question: string, pin: GeoPoint | null): void => {
      const text = question.trim();
      if (text === '' || pending) return;
      const id = (next.current += 1);
      const startedAt = Date.now();
      const messages = historyFor(exchanges, text);
      setExchanges((current) => [
        ...current,
        { id, question: text, pin, state: { status: 'pending', startedAt } },
      ]);
      const settle = (state: ChatExchange['state']) => {
        setExchanges((current) =>
          current.map((exchange) => (exchange.id === id ? { ...exchange, state } : exchange)),
        );
      };
      client.agent.chat
        .mutate(
          {
            workspace_id: workspace.id,
            session_id: session.current,
            messages,
            ...(pin ? { map_center: pin } : {}),
          },
          { signal: AbortSignal.timeout(CHAT_TIMEOUT_MS) },
        )
        .then(
          (response) => {
            settle({ status: 'answered', response, ms: Date.now() - startedAt });
            if (response.leads_created.some((lead) => lead.outcome === 'created')) onLeadsSaved();
          },
          (error: unknown) => {
            settle({ status: 'failed', error: describeCrmApiError(error) });
          },
        );
    },
    [client, workspace.id, exchanges, pending, onLeadsSaved],
  );

  return {
    exchanges,
    pending,
    ask,
    clear: () => {
      if (!pending) setExchanges([]);
    },
  };
}
