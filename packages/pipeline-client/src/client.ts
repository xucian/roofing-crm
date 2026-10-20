import createClient from 'openapi-fetch';
import type { components, paths } from './generated/pipeline-api';
import { PipelineError } from './errors';
import { readRequestId } from './request-id';
import type { PipelineFetch } from './transport';

/** Schemas of the pinned pipeline contract (openapi.pin.json); never written by hand. */
export type PipelineSchemas = components['schemas'];
export type Meta = PipelineSchemas['Meta'];
export type PropertySearchResponse = PipelineSchemas['PropertySearchResponse'];
export type PropertySummary = PipelineSchemas['PropertySummary'];
export type MatchReason = PipelineSchemas['MatchReason'];
export type RoofAgeAnchor = PipelineSchemas['RoofAgeAnchor'];
export type RoofAgeBasis = PipelineSchemas['RoofAgeBasis'];
export type RoofAgeConfidence = PipelineSchemas['RoofAgeConfidence'];
export type SearchCenter = PipelineSchemas['SearchCenter'];
export type SearchCentersResponse = PipelineSchemas['SearchCentersResponse'];
export type PropertySearchQuery = NonNullable<
  paths['/v1/properties/search']['get']['parameters']['query']
>;

/** A successful answer and the id that joins it to the pipeline's logs (`x-request-id`). */
export interface PipelineAnswer<T> {
  data: T;
  requestId: string | undefined;
}

export interface CallOptions {
  signal?: AbortSignal | undefined;
}

/** The pipeline API v1 operations the CRM uses, typed by the pinned contract. */
export interface PipelineClient {
  getMeta(options?: CallOptions): Promise<PipelineAnswer<Meta>>;
  searchProperties(
    query: PropertySearchQuery,
    options?: CallOptions,
  ): Promise<PipelineAnswer<PropertySearchResponse>>;
  /** Resolves a city, alias or ZIP to search centers (`/v1/search-centers`). */
  searchCenters(q: string, options?: CallOptions): Promise<PipelineAnswer<SearchCentersResponse>>;
}

export interface PipelineClientOptions {
  /** API_BASE, without a trailing slash. */
  baseUrl: string;
  /** The transport: `createPipelineFetch`, possibly behind `serializeFetch`. It throws on non-2xx. */
  fetch: PipelineFetch;
}

/**
 * openapi-fetch over the package's transport. The transport already turned every non-2xx into a
 * `PipelineError` with its request id, so a call here either returns typed data or throws one.
 */
export function createPipelineClient(options: PipelineClientOptions): PipelineClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    fetch: (request) => options.fetch(request),
    headers: { accept: 'application/json' },
  });

  const answer = <T>(result: { data?: T; response: Response }): PipelineAnswer<T> => {
    const requestId = readRequestId(result.response.headers);
    if (result.data === undefined) {
      throw new PipelineError({
        kind: 'http',
        url: result.response.url,
        attempts: 1,
        status: result.response.status,
        requestId,
        detail: 'The pipeline API answered without a JSON body.',
      });
    }
    return { data: result.data, requestId };
  };

  return {
    async getMeta(callOptions) {
      return answer(await client.GET('/v1/meta', { signal: callOptions?.signal }));
    },
    async searchProperties(query, callOptions) {
      return answer(
        await client.GET('/v1/properties/search', {
          params: { query },
          signal: callOptions?.signal,
        }),
      );
    },
    async searchCenters(q, callOptions) {
      return answer(
        await client.GET('/v1/search-centers', {
          params: { query: { q } },
          signal: callOptions?.signal,
        }),
      );
    },
  };
}
