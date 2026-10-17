# Progress — feature increments (guide-product-work)

One row per piece of `docs/decisions.md` (metagross item 26: five pieces, `Piece i/5`). Status is `pending`, `prepared`,
`observed` or `verified`. A piece is `verified` only after the operator has deployed it, used it on the public CloudFront
URL, inspected AWS and replied with the observation (item 27); agent-run checks never verify a piece. No secrets or
payloads are recorded here.

Product and role: the Roofing CRM, built by `metagross` (`build-frontend-backends`, `apply-engineering-guidelines`,
`guide-product-work`). Data source: the pipeline API v1, whose contract froze at `de08901`. The pipeline repository is at
`6b698a4` (its T2 prepared, checked 2026-10-17). Its T7, which commits `openapi.json` and publishes `API_BASE`, is
pending, so F1 is prepared but cannot be deployed yet.

## How F1 fits

```
browser ──HTTPS──▶ CloudFront, stack RoofingCrm (us-east-2) ─┬─ default ─▶ S3: SPA, /config.json
                                                              └─ basemap/* ▶ S3: travis.pmtiles (Range), glyphs, sprites
browser ──HTTPS──▶ pipeline API v1 (API_BASE): /v1/meta, /v1/properties/search      ◀── arrives with the pipeline's T7
```

Example, once T7 lands: the link `<WebUrl>/?lat=30.26720&lon=-97.74310&radius=5&age=15` makes the app call
`GET {API_BASE}/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&open_permits=false&limit=500`.
The answer `{items, total, next_cursor, area_note}` becomes up to 500 clustered markers, "N matches, showing 500", and
one row per roof with its match reason and roof-age basis; the call's `x-request-id` is shown under the results.

## Pieces

| Piece | ID | Usable increment | Depends on | Configuration / version | Status | Automated checks | Operator run / request id | AWS reference | Expected vs actual | Operator observation | Correction / cleanup | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1/5 | F1 | Find aged roofs on the map: hosted URL, Travis County and Austin by default, default search on load, pin and GPS, radius, age threshold, clustered markers, list with total and match reasons, freshness footer, disabled sections (README AC 1-4, 7, 11). Plus CI (item 21). | Pipeline T7: the pinned `openapi.json` and `API_BASE` | Working tree on `assignment` over `59d0635`, not committed. Pin pending. Basemap built locally (Protomaps 20261016, sha256 `9e5238…48c8`), not deployed. | prepared (blocked on pipeline T7) | 2026-10-17, uncached `pnpm check`: Prettier, ESLint, typecheck, 110 tests (shared 24, pipeline-client 29, web 38, api 19), build, `cdk synth`, pin check "pending". Production bundle run locally under the deployed CSP in Chromium: map, basemap, pin, radius, threshold, GPS inside and outside the county, phone to desktop layouts; no console errors, no request off the page's origin. | — | — (stack `RoofingCrm` not deployed) | Expected after T7: see the handoff below. Actual: not run; without `API_BASE` the app says "Pipeline API not configured" instead of showing rows. | — | — | When T7 lands: the steps below, then the handoff. |
| 2/5 | F2 | Permit signal and detail: open and stalled toggle (on by default), long-open ordering, detail drawer with status, open duration, contractor attribution, BBB status, owner public fields, sources and CIDs (AC 5-6) | F1 verified | — | pending | — | — | — | — | — | — | Starts only after F1 is verified. |
| 3/5 | F3 | Save leads: tRPC API, DynamoDB, create one or many, leads page, persistence across reloads (AC 8, creating) | F1 verified (F2 for permit leads) | — | pending | — | — | — | — | — | — | — |
| 4/5 | F4 | Manage leads: status and note editing, delete, filters by status, roof age, permit group, open years and radius (AC 8, managing) | F3 verified | — | pending | — | — | — | — | — | — | — |
| 5/5 | F5 | Ask in natural language: `pidgeot-agent` on Bedrock through the AI SDK, pipeline and lead tools (AC 9) | F1-F4 | — | pending | — | — | — | — | — | — | — |

## F1: what is done and what remains

Done (no dependency on the contract file): the workspace and CI; `packages/shared` (defaults, geo math, formatters,
disabled sections, hosting helpers, basemap constants); `packages/pipeline-client` transport, error model and the
pin/generate/check tooling; the map shell in `apps/web`; the `RoofingCrm` stack in `apps/api/cdk`; `pnpm basemap`;
`pnpm deploy:aws`; the runbook.

Remaining once T7 lands, in order:

1. Pin the contract: `pnpm --filter @roofing-crm/pipeline-client pin <T7 commit> <path of openapi.json>`, then commit the
   pin, `openapi/openapi.json` and `src/generated/pipeline-api.ts` together.
2. Typed operations in `packages/pipeline-client` (openapi-fetch over `createPipelineFetch`): `getMeta` and
   `searchProperties` with paging; tests against the generated types, plus a type-level check that the generated error
   schema still carries `error` and `request_id`.
3. Web: the default search on load (`open_permits=false`, `limit=500`, debounced on radius and threshold); markers from
   the first page; the list with "N matches, showing M", rows (match reasons, roof-age basis, confidence, anchor, as-of
   date and caveats, coordinates, source) and "load more" through `next_cursor`, restarting on `stale_cursor`; the
   `area_note` notice, which also covers GPS fixes inside the map's box but outside the county; the error state with the
   request id; a "pipeline busy, retrying" state from the transport's retries; the footer's run id, group CIDs, manifest
   CID and `atlas`.
4. Record `API_BASE` in `docs/runbook.md`, the operator's `.env` and the CI repository variable `PIPELINE_API_BASE`.
5. Run `pnpm check`. The operator deploys, then the handoff below.

Open question for the operator: the place box (§7, 2026-10-17 entry) is in none of item 26's pieces. Proposal: add it to
F1's post-T7 work. It is not built until a dated decisions entry places it.

## F1 handoff (applies once T7 lands)

**Piece 1/5 — F1 find aged roofs on the map**

- **Run:** `pnpm deploy:aws`, with `PIPELINE_API_BASE` in `.env` and your deploy profile in `AWS_PROFILE`. Open the
  "F1 link" it prints (`<WebUrl>/?lat=30.26720&lon=-97.74310&radius=5&age=15`). Then drop a pin north of the river, set
  the radius to 2 and the threshold to 30, and press "Use my location".
- **Expect:** the map opens on Austin with a 5-mile circle and the default search already run: clustered markers, "N
  matches, showing 500" with N equal to the API's `total`, rows with "aged roof", the roof-age basis and as-of date,
  coordinates and source, and the footer with the run id, group CIDs and manifest CID. The pin, the radius and the
  threshold change the circle, the URL, the markers and the count. A location outside Travis County keeps the center and
  says so. Outreach, Campaigns, Sequences, Reporting and Billing show disabled, marked "Soon".
- **AWS (us-east-2, the account `pnpm deploy:aws` printed):**
  1. Open: CloudFormation, stack `RoofingCrm`, Outputs. Status is CREATE_COMPLETE or UPDATE_COMPLETE, and
     `PipelineApiBase` equals `API_BASE`.
  2. Inspect: S3, the bucket named in `WebBucketName`. `config.json` holds that `pipelineApiBase`; `assets/` holds the
     bundles; `basemap/` holds `travis.pmtiles` and `SOURCE.json`, whose build matches the runbook line.
  3. Compare: CloudFront, the distribution in `DistributionId`. Behaviors list `basemap/*` (compress off) and the default
     behaviour with the SPA function; Invalidations show this deploy's `/index.html`, `/config.json`, `/favicon.svg` and
     `/basemap/*`. Then, in the browser's network panel, the `properties/search` response carries the same `x-request-id`
     the app shows under the results; the pipeline's API logs can be filtered by it.
- **Reply with:** the `x-request-id` shown under the results, the total shown for the default search, and one or two
  sentences on what the circle, markers, list and footer did after your pin and radius change.

Until then the operator can preview the shell locally (no AWS): `pnpm install --frozen-lockfile && pnpm basemap &&
pnpm build && pnpm --filter @roofing-crm/web preview`, then open http://localhost:4173. That is a look, not F1's check.
