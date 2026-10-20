import { leadKey, type Lead } from '@roofing-crm/shared';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { Deadline } from '../deadline';
import type { LeadPatch, LeadRepository, ListedPage, PutOutcome } from '../leads/repository';

// Test doubles for the leads function. Pipeline bodies come from the synthetic contract fixtures
// (`@roofing-crm/pipeline-client/testing`), never county data.

export const WORKSPACE = '01JBQ7Z0000000000000000000';
export const OTHER_WORKSPACE = '01JBQ7Z0000000000000000001';

/** The table, in memory, with the repository's semantics (conditional put, pages by sort key). */
export class MemoryRepository implements LeadRepository {
  readonly items = new Map<string, Map<string, Lead>>();
  writes = 0;

  private workspace(id: string): Map<string, Lead> {
    let leads = this.items.get(id);
    if (!leads) this.items.set(id, (leads = new Map<string, Lead>()));
    return leads;
  }

  get(workspaceId: string, key: string): Promise<Lead | null> {
    return Promise.resolve(this.workspace(workspaceId).get(key) ?? null);
  }

  putNew(workspaceId: string, lead: Lead): Promise<PutOutcome> {
    const leads = this.workspace(workspaceId);
    const existing = leads.get(leadKey(lead));
    if (existing) return Promise.resolve({ created: false, lead: existing });
    this.writes += 1;
    leads.set(leadKey(lead), lead);
    return Promise.resolve({ created: true, lead });
  }

  list(
    workspaceId: string,
    cursor: string | null,
    limit: number,
    matches: (lead: Lead) => boolean = () => true,
  ): Promise<ListedPage> {
    const leads = this.workspace(workspaceId);
    const keys = [...leads.keys()].sort();
    const items: Lead[] = [];
    let scanned = 0;
    for (const key of keys.slice(cursor === null ? 0 : keys.indexOf(cursor) + 1)) {
      const lead = leads.get(key)!;
      scanned += 1;
      if (matches(lead)) items.push(lead);
      if (items.length === limit) {
        return Promise.resolve({ items, next_cursor: key === keys.at(-1) ? null : key, scanned });
      }
    }
    return Promise.resolve({ items, next_cursor: null, scanned });
  }

  update(
    workspaceId: string,
    key: string,
    patch: LeadPatch,
    updatedAt: string,
  ): Promise<Lead | null> {
    const leads = this.workspace(workspaceId);
    const lead = leads.get(key);
    if (!lead) return Promise.resolve(null);
    this.writes += 1;
    const updated: Lead = {
      ...lead,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
      updated_at: updatedAt,
    };
    leads.set(key, updated);
    return Promise.resolve(updated);
  }

  delete(workspaceId: string, key: string): Promise<Lead | null> {
    const leads = this.workspace(workspaceId);
    const lead = leads.get(key) ?? null;
    if (lead) {
      this.writes += 1;
      leads.delete(key);
    }
    return Promise.resolve(lead);
  }
}

/** A deadline under the test's control. */
export function fakeDeadline(
  remainingMs = 25_000,
): Deadline & { set(ms: number): void; abort(): void } {
  let left = remainingMs;
  const controller = new AbortController();
  return {
    remainingMs: () => left,
    signal: controller.signal,
    set: (ms) => {
      left = ms;
    },
    abort: () => {
      left = 0;
      controller.abort(new DOMException('deadline', 'TimeoutError'));
    },
  };
}

export type PipelineRoute = (url: URL) => { status?: number; body: unknown; requestId?: string };

/** fetch for the pipeline, routed by path; records every URL it was asked for. */
export function stubPipelineFetch(routes: Record<string, PipelineRoute>): {
  fetch: (request: Request) => Promise<Response>;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch = (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    calls.push(decodeURIComponent(url.pathname) + url.search);
    const route = routes[decodeURIComponent(url.pathname)];
    const answer = route
      ? route(url)
      : { status: 404, body: { error: 'not_found', request_id: 'pl-404' }, requestId: 'pl-404' };
    return Promise.resolve(
      Response.json(answer.body, {
        status: answer.status ?? 200,
        headers: { 'x-request-id': answer.requestId ?? `pl-${url.pathname}` },
      }),
    );
  };
  return { fetch, calls };
}

/** An HTTP API (payload 2.0) event as API Gateway sends it to the function. */
export function httpEvent(input: {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  query?: string;
  proxy?: boolean;
}): APIGatewayProxyEventV2 {
  const proxy = input.proxy ?? input.method === 'GET';
  const procedure = input.path.replace(/^\/api\/trpc\//, '');
  return {
    version: '2.0',
    routeKey: proxy ? `${input.method} /api/trpc/{proxy+}` : `${input.method} ${input.path}`,
    rawPath: input.path,
    rawQueryString: input.query ?? '',
    headers: { 'content-type': 'application/json', host: 'example.cloudfront.net' },
    ...(proxy ? { pathParameters: { proxy: procedure } } : {}),
    requestContext: {
      accountId: '000000000000',
      apiId: 'fixture',
      domainName: 'fixture.execute-api.us-east-2.amazonaws.com',
      domainPrefix: 'fixture',
      http: {
        method: input.method,
        path: input.path,
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'vitest',
      },
      requestId: 'crm-req-1',
      routeKey: proxy ? `${input.method} /api/trpc/{proxy+}` : `${input.method} ${input.path}`,
      stage: '$default',
      time: '20/Oct/2026:12:00:00 +0000',
      timeEpoch: 1_792_497_600_000,
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    isBase64Encoded: false,
  };
}
