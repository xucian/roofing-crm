import { TRPCClientError, createTRPCClient, httpLink, type TRPCClient } from '@trpc/client';
import type { AppRouter } from '@roofing-crm/api/router';
import type { LeadFailure } from '@roofing-crm/shared';

export type { AppRouter };

/** The CRM API's path behind the page's own origin (CloudFront `/api/*`); fixed once deployed. */
export const API_PATH = '/api/trpc';

export type CrmApiClient = TRPCClient<AppRouter>;

export interface CrmApiClientOptions {
  /** `/api/trpc` on the page's origin by default. */
  url?: string;
  /** Replaced in tests. */
  fetch?: typeof globalThis.fetch;
}

/**
 * The typed client of the CRM API (metagross items 3, 6). `httpLink`, not the batching link: one
 * procedure per request keeps each mutation on its own HTTP API route and throttle. No automatic
 * retry: a save is retried by the person, who sees why it failed.
 */
export function createCrmApiClient(options: CrmApiClientOptions = {}): CrmApiClient {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: options.url ?? API_PATH,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }),
    ],
  });
}

/** A failed CRM API call, in the terms the error states show (docs/decisions.md §4). */
export interface CrmApiFailure {
  message: string;
  /** HTTP status, when a response arrived. */
  status: number | null;
  /** The function's tRPC code (`NOT_FOUND`, …); null when the function did not answer. */
  code: string | null;
  /** The CRM request id (API Gateway's), which finds the call in the `leads` function's logs. */
  requestId: string | null;
  /** Why a lead could not be saved, with the pipeline's request id, when that was the cause. */
  failure: LeadFailure | null;
}

interface ErrorShapeData {
  code?: string;
  httpStatus?: number;
  requestId?: string | null;
  failure?: LeadFailure | null;
}

export function describeCrmApiError(error: unknown): CrmApiFailure {
  if (error instanceof TRPCClientError) {
    const data = (error as TRPCClientError<AppRouter>).data as ErrorShapeData | undefined;
    const meta = error.meta as { response?: Response } | undefined;
    const status = data?.httpStatus ?? meta?.response?.status ?? null;
    const headers = meta?.response?.headers;
    const headerId = headers?.get('x-request-id') ?? headers?.get('apigw-requestid') ?? null;
    const requestId = data?.requestId ?? headerId;
    // No tRPC body: CloudFront, API Gateway or the network answered instead of the function.
    const message =
      data === undefined
        ? status === 429
          ? 'The CRM API is busy (HTTP 429). Wait a moment and try again.'
          : status === null
            ? 'The CRM API could not be reached.'
            : `The CRM API failed (HTTP ${String(status)}).`
        : error.message;
    return { message, status, code: data?.code ?? null, requestId, failure: data?.failure ?? null };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    status: null,
    code: null,
    requestId: null,
    failure: null,
  };
}
