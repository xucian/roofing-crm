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
export type PropertyDetail = PipelineSchemas['PropertyDetail'];
export type PermitSummary = PipelineSchemas['PermitSummary'];
export type PermitDetail = PipelineSchemas['PermitDetail'];
export type PermitContractor = PipelineSchemas['PermitContractor'];
export type PermitSearchResponse = PipelineSchemas['PermitSearchResponse'];
export type PermitSearchQuery = NonNullable<
  paths['/v1/permits/search']['get']['parameters']['query']
>;
export type PermitTextSearchResponse = PipelineSchemas['PermitTextSearchResponse'];
export type PermitTextSearchQuery = NonNullable<
  paths['/v1/permits/text-search']['get']['parameters']['query']
>;
export type Contractor = PipelineSchemas['Contractor'];
export type Limitation = PipelineSchemas['Limitation'];
export type Bbb = PipelineSchemas['Bbb'];
export type Owner = PipelineSchemas['Owner'];
export type RoofWorkClass = PipelineSchemas['RoofWorkClass'];
export type Source = PipelineSchemas['Source'];
export type StatusGroup = PipelineSchemas['StatusGroup'];
export type UnpublishedSource = PipelineSchemas['UnpublishedSource'];

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
  /** One property with its owner and its first 50 permits (`permits_total` counts them all). */
  getProperty(propertyId: string, options?: CallOptions): Promise<PipelineAnswer<PropertyDetail>>;
  /** One permit with its property (when linked), contractor attribution and BBB status. */
  getPermit(permitId: string, options?: CallOptions): Promise<PipelineAnswer<PermitDetail>>;
  /** Permits by area, status, contractor or property; pages beyond a property's first 50. */
  searchPermits(
    query: PermitSearchQuery,
    options?: CallOptions,
  ): Promise<PipelineAnswer<PermitSearchResponse>>;
  /** Free-text search over permit descriptions (`/v1/permits/text-search`), for the agent (F5). */
  searchPermitText(
    query: PermitTextSearchQuery,
    options?: CallOptions,
  ): Promise<PipelineAnswer<PermitTextSearchResponse>>;
  /** Permits under one printed contractor name and phone: an attribution, not a verified identity. */
  getContractor(key: string, options?: CallOptions): Promise<PipelineAnswer<Contractor>>;
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
          // `roof_work_class` is form style without explode, as on permit search.
          querySerializer: { array: { style: 'form', explode: false } },
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
    async getProperty(propertyId, callOptions) {
      return answer(
        await client.GET('/v1/properties/{property_id}', {
          params: { path: { property_id: propertyId } },
          signal: callOptions?.signal,
        }),
      );
    },
    async getPermit(permitId, callOptions) {
      // openapi-fetch URL-encodes path parameters: the space in a permit number becomes %20.
      const result = await client.GET('/v1/permits/{permit_id}', {
        params: { path: { permit_id: permitId } },
        signal: callOptions?.signal,
      });
      // openapi-fetch's inferred body drops the contract's null-only field (`applicant: null`);
      // the body is the schema's PermitDetail.
      return answer(result as { data?: PermitDetail; response: Response });
    },
    async searchPermits(query, callOptions) {
      return answer(
        await client.GET('/v1/permits/search', {
          params: { query },
          // The contract's list parameters (`status_group`, `roof_work_class`) are form style
          // without explode: one comma-separated value, not the parameter repeated.
          querySerializer: { array: { style: 'form', explode: false } },
          signal: callOptions?.signal,
        }),
      );
    },
    async searchPermitText(query, callOptions) {
      return answer(
        await client.GET('/v1/permits/text-search', {
          params: { query },
          querySerializer: { array: { style: 'form', explode: false } },
          signal: callOptions?.signal,
        }),
      );
    },
    async getContractor(key, callOptions) {
      return answer(
        await client.GET('/v1/contractors/{contractor_attribution_key}', {
          params: { path: { contractor_attribution_key: key } },
          signal: callOptions?.signal,
        }),
      );
    },
  };
}
