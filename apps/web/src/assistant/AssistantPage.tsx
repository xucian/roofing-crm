import {
  CHAT_LIMITS,
  CITATION_TOKEN,
  formatCoordinates,
  type ChatEvidence,
  type ChatOutcome,
  type ChatResponse,
  type GeoPoint,
} from '@roofing-crm/shared';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Callout } from '../app/Callout';
import { CrmErrorDetails } from '../leads/CrmErrorDetails';
import { EXAMPLES } from './examples';
import type { ChatExchange, ChatStore } from './use-chat';

export interface AssistantPageProps {
  chat: ChatStore;
  /** The map's pin, sent with each question for "around here". */
  pin: GeoPoint;
  /** Opens a property in the drawer on the map. */
  onOpenProperty: (propertyId: string) => void;
}

const OUTCOME_LABELS: Readonly<Record<ChatOutcome, string>> = {
  answered: 'Answered',
  no_matches: 'No matches',
  needs_clarification: 'Needs clarification',
  out_of_scope: 'Out of scope',
  out_of_county: 'Outside Travis County',
  limit_reached: 'Time limit reached',
  tool_error: 'No answer',
};

const KIND_LABELS: Readonly<Record<ChatEvidence['kind'], string>> = {
  property: 'Property',
  permit: 'Permit',
  contractor: 'Contractor',
  search_center: 'Search center',
  run: 'Pipeline run',
  lead: 'Your lead',
};

/**
 * The assistant (README AC 9, demo step "Ask the RAG agent a natural-language query for roofing
 * opportunities in the area and show relevant results"): `pidgeot-agent` answers from the pipeline's
 * records and this workspace's leads. Every id in an answer is a chip that opens the record; under
 * each answer are the records the tools returned, the assumptions, the limitations and the tool calls,
 * all built by the server, not by the model.
 */
export function AssistantPage({ chat, pin, onOpenProperty }: AssistantPageProps) {
  const [draft, setDraft] = useState('');
  const submit = (question: string) => {
    if (question.trim() === '' || chat.pending) return;
    chat.ask(question, pin);
    setDraft('');
  };
  return (
    <section className="assistant-page" aria-labelledby="assistant-heading">
      <header className="leads-header">
        <h1 id="assistant-heading" className="leads-title">
          Assistant
        </h1>
        <p className="field-hint">
          Ask about roofs, roofing permits, contractors and your leads in Travis County. Answers
          come only from the pipeline&apos;s records and this browser&apos;s leads, each record
          cited. &quot;Here&quot; means the map&apos;s pin, <code>{formatCoordinates(pin)}</code>.
          Say &quot;save … as leads&quot; to save results. A turn takes about 10 seconds.
        </p>
      </header>

      {chat.exchanges.length === 0 ? (
        <div className="assistant-examples" aria-label="Example questions">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="button button--quiet assistant-example"
              onClick={() => {
                submit(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : (
        <ol className="assistant-transcript">
          {chat.exchanges.map((exchange) => (
            <Exchange key={exchange.id} exchange={exchange} onOpenProperty={onOpenProperty} />
          ))}
        </ol>
      )}

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <label className="field-label" htmlFor="assistant-question">
          Your question
        </label>
        <textarea
          id="assistant-question"
          className="lead-note-input"
          rows={2}
          maxLength={CHAT_LIMITS.messageChars}
          value={draft}
          placeholder="e.g. open roofing permits older than five years within five miles of Austin"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
        <p className="lead-actions">
          <button type="submit" className="button" disabled={chat.pending || draft.trim() === ''}>
            {chat.pending ? 'Asking…' : 'Ask'}
          </button>
          {chat.exchanges.length > 0 ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={chat.pending}
              onClick={chat.clear}
            >
              New conversation
            </button>
          ) : null}
        </p>
      </form>
    </section>
  );
}

function Exchange({
  exchange,
  onOpenProperty,
}: {
  exchange: ChatExchange;
  onOpenProperty: (propertyId: string) => void;
}) {
  const { state } = exchange;
  return (
    <li className="assistant-exchange">
      <p className="assistant-question">{exchange.question}</p>
      {state.status === 'pending' ? <Pending startedAt={state.startedAt} /> : null}
      {state.status === 'failed' ? (
        <Callout tone="error" title="The assistant did not answer">
          <CrmErrorDetails failure={state.error} />
        </Callout>
      ) : null}
      {state.status === 'answered' ? (
        <Answer response={state.response} ms={state.ms} onOpenProperty={onOpenProperty} />
      ) : null}
    </li>
  );
}

function Pending({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <p className="field-hint" aria-live="polite">
      Searching the records… {String(Math.max(0, Math.round((now - startedAt) / 1000)))} s
    </p>
  );
}

/** One citation chip: a property or permit opens its property on the map. */
function Citation({
  kind,
  id,
  evidence,
  onOpenProperty,
}: {
  kind: string;
  id: string;
  evidence: ChatEvidence[];
  onOpenProperty: (propertyId: string) => void;
}) {
  const record = evidence.find((item) =>
    kind === 'property'
      ? item.property_id === id && (item.kind === 'property' || item.kind === 'lead')
      : kind === 'permit'
        ? item.permit_id === id && item.kind === 'permit'
        : kind === 'contractor'
          ? item.contractor_attribution_key === id
          : item.kind === 'run',
  );
  const propertyId =
    kind === 'property'
      ? id
      : kind === 'permit'
        ? (record?.property_id ?? evidence.find((item) => item.permit_id === id)?.property_id)
        : null;
  const label =
    kind === 'property'
      ? `Property ${id}`
      : kind === 'permit'
        ? `Permit ${id}`
        : kind === 'contractor'
          ? (record?.label ?? 'Contractor')
          : `Run ${id}`;
  // The answer names the kind ("Property 103857"), so the chip shows the id; its name says both.
  const shown = kind === 'property' || kind === 'permit' ? id : label;
  if (!propertyId) {
    return (
      <span className="assistant-chip assistant-chip--static" title={label}>
        {shown}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`assistant-chip assistant-chip--${kind}`}
      aria-label={label}
      title={record?.label ? `${record.label}: show on the map` : 'Show on the map'}
      onClick={() => {
        onOpenProperty(propertyId);
      }}
    >
      {shown}
    </button>
  );
}

/** Text with its `[[kind:id]]` tokens as chips. */
function withCitations(
  text: string,
  evidence: ChatEvidence[],
  onOpenProperty: (propertyId: string) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(new RegExp(CITATION_TOKEN.source, 'g'))) {
    const index = match.index;
    if (index > at) out.push(text.slice(at, index));
    out.push(
      <Citation
        key={`${String(index)}-${match[0]}`}
        kind={match[1] ?? ''}
        id={(match[2] ?? '').trim()}
        evidence={evidence}
        onOpenProperty={onOpenProperty}
      />,
    );
    at = index + match[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The answer's Markdown subset: paragraphs and "- " lists, as plain text with citation chips. */
function AnswerText({
  text,
  evidence,
  onOpenProperty,
}: {
  text: string;
  evidence: ChatEvidence[];
  onOpenProperty: (propertyId: string) => void;
}) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const item = /^[-*•]\s+(.*)$/.exec(line);
    const list = item !== null;
    const content = item?.[1] ?? line.replace(/^#+\s*/, '');
    const last = blocks.at(-1);
    if (last && last.list && list) last.lines.push(content);
    else blocks.push({ list, lines: [content] });
  }
  return (
    <div className="assistant-answer">
      {blocks.map((block, index) =>
        block.list ? (
          <ul key={index}>
            {block.lines.map((line, n) => (
              <li key={n}>{withCitations(line, evidence, onOpenProperty)}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, n) => (
              <Fragment key={n}>{withCitations(line, evidence, onOpenProperty)}</Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function Answer({
  response,
  ms,
  onOpenProperty,
}: {
  response: ChatResponse;
  ms: number;
  onOpenProperty: (propertyId: string) => void;
}) {
  const records = response.evidence.filter(
    (item) => item.kind !== 'search_center' && item.kind !== 'run',
  );
  return (
    <div className="assistant-response">
      <p className={`assistant-outcome assistant-outcome--${response.outcome}`}>
        {OUTCOME_LABELS[response.outcome]}
        {response.center_used ? (
          <span className="field-hint">
            {' '}
            · around {response.center_used.name} ({formatCoordinates(response.center_used, 4)})
          </span>
        ) : null}
      </p>
      {response.answer ? (
        <AnswerText
          text={response.answer}
          evidence={response.evidence}
          onOpenProperty={onOpenProperty}
        />
      ) : (
        <p className="field-hint">
          {response.outcome === 'tool_error'
            ? 'The answer could not be checked against the records, so it is not shown. The records found are below; ask again or rephrase.'
            : null}
        </p>
      )}
      {response.leads_created.length > 0 ? (
        <Callout tone="info" title="Saved to your leads">
          {response.leads_created
            .map(
              (lead) =>
                `${lead.permit_id ? `Permit ${lead.permit_id}` : `Property ${lead.property_id}`} (${lead.outcome === 'created' ? 'new' : 'already saved'})`,
            )
            .join(', ')}
          . They are on the Leads page.
        </Callout>
      ) : null}
      {response.assumptions.length > 0 ? (
        <div className="assistant-section">
          <p className="field-label">Assumptions</p>
          <ul>
            {response.assumptions.map((line) => (
              <li key={line}>{withCitations(line, response.evidence, onOpenProperty)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {records.length > 0 ? (
        <details className="assistant-section">
          <summary>Records found ({records.length})</summary>
          <ul className="assistant-evidence">
            {records.map((item) => (
              <li
                key={`${item.kind}-${item.permit_id ?? ''}-${item.property_id ?? ''}-${item.contractor_attribution_key ?? ''}`}
              >
                <span className="assistant-evidence-kind">{KIND_LABELS[item.kind]}</span>{' '}
                {item.permit_id ?? item.property_id ?? ''}
                {item.label ? ` · ${item.label}` : ''}
                {item.property_id ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        if (item.property_id) onOpenProperty(item.property_id);
                      }}
                    >
                      Show on map
                    </button>
                  </>
                ) : null}
                {item.source_url ? (
                  <>
                    {' · '}
                    <a href={item.source_url} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                ) : null}
                {item.record_cid ? (
                  <span className="field-hint">
                    {' '}
                    · CID <code>{item.record_cid}</code>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {response.limitations.length > 0 ? (
        <details className="assistant-section">
          <summary>Limitations ({response.limitations.length})</summary>
          <ul>
            {response.limitations.map((limitation) => (
              <li key={`${limitation.source}-${limitation.reason ?? ''}`}>
                <code>{limitation.source}</code>: {limitation.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {response.tool_calls.length > 0 ? (
        <details className="assistant-section">
          <summary>How it searched ({response.tool_calls.length} tool calls)</summary>
          <ol className="assistant-tools">
            {response.tool_calls.map((call) => (
              <li key={call.id}>
                <code>{call.name}</code>{' '}
                <code className="assistant-args">{JSON.stringify(call.args)}</code>
                {' → '}
                {call.status === 'ok'
                  ? call.result_summary
                  : `${call.status}: ${call.result_summary}`}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <p className="results-request">
        Request id <code>{response.request_id}</code> · {response.model_id} · run{' '}
        <code>{response.run_id}</code> · {(ms / 1000).toFixed(1)} s
      </p>
    </div>
  );
}
