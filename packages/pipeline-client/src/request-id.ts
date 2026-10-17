/**
 * The correlation id of a pipeline response: `x-request-id` on responses the server writes,
 * `apigw-requestid` on responses API Gateway generates itself (throttles, platform errors).
 * Both are exposed to browsers through CORS by the pipeline API.
 */
export function readRequestId(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('apigw-requestid') ?? undefined;
}
