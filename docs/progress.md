# Progress — feature increments (guide-product-work)

One row per piece of `docs/decisions.md` (metagross item 26: five pieces, `Piece i/5`). Status is `pending`, `prepared`,
`observed` or `verified`. A piece is `verified` only after the operator has deployed it, used it on the public CloudFront
URL, inspected AWS and replied with the observation (item 27); agent-run checks never verify a piece. No secrets or
payloads are recorded here.

Product and role: the Roofing CRM, built by `metagross` (`build-frontend-backends`, `apply-engineering-guidelines`,
`guide-product-work`). Data source: the pipeline API v1, whose contract froze at `de08901`. The CRM pins the contract
at pipeline commit `56b020c`. `API_BASE` is `https://733jzm4xv4.execute-api.us-east-2.amazonaws.com` (pipeline handoff,
2026-10-20). On that account, cold searches time out until the pipeline's T7 correction (Parquet read from its deploy
bucket) is live. F1 is therefore built and checked locally, and is deployed only once the operator relays "T7
correction live" with the measured cold times.

## How F1 fits

```
browser ──HTTPS──▶ CloudFront, stack RoofingCrm (us-east-2) ─┬─ default ─▶ S3: SPA, /config.json
                                                              └─ basemap/* ▶ S3: travis.pmtiles (Range), glyphs, sprites
browser ──HTTPS──▶ pipeline API v1 (API_BASE), one call at a time:
                   /v1/properties/search, then /v1/meta; /v1/search-centers from the place box
```

Example: the link `<WebUrl>/?lat=30.26720&lon=-97.74310&radius=5&age=15` makes the app call
`GET {API_BASE}/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&open_permits=false&limit=500`.
The answer `{items, total, next_cursor, area_note}` becomes up to 500 clustered markers, "N matches, showing 500", and
one row per roof with its match reason and roof-age basis; the call's `x-request-id` is shown under the results.

## Pieces

| Piece | ID | Usable increment | Depends on | Configuration / version | Status | Automated checks | Operator run / request id | AWS reference | Expected vs actual | Operator observation | Correction / cleanup | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1/5 | F1 | Find aged roofs on the map: hosted URL, Travis County and Austin by default, default search on load, pin and GPS, place box, radius, age threshold, clustered markers, list with total and match reasons, freshness footer, disabled sections (README AC 1-4, 7, 11). Plus CI (item 21). | Pipeline: contract pin and `API_BASE` (done); its T7 correction live (pending) | Working tree on `assignment` over `58ec92a`, not committed. Contract pinned at pipeline `56b020c` (sha256 `7d8ece68…`, equal to the served file). `API_BASE` in `.env`. Basemap built locally (Protomaps 20261016, sha256 `9e5238…48c8`), not deployed. | prepared (live check waits for the pipeline's "T7 correction live") | 2026-10-20, `pnpm check` exit 0: Prettier, ESLint, typecheck, 153 tests (shared 24, pipeline-client 41, web 69, api 19), build, `cdk synth`, pin in sync; `check:served` matches the pin. Production bundle under the deployed CSP in Chrome against a local fake pipeline (synthetic rows, scratchpad only): default search, 500 clustered markers, "12,431 matches, showing 500", rows, load more to 1,000, place box choices, footer CIDs, loading and 429-retry states, phone layout; no page errors, no request off the page's origin. | — | — (stack `RoofingCrm` not deployed) | Expected after the T7 correction: see the handoff below; the default search about 7 to 8 s cold, faster warm. Actual: not run against the live API (the handoff says not to until the correction is live). | 2026-10-17, local preview (no AWS): `pnpm check` passes on the operator's machine; map, pin, radius and threshold work. GPS works in Firefox: a fix outside Travis County keeps the center and says so. Chrome on macOS returns `POSITION_UNAVAILABLE` on every site, browserleaks.com/geo included, so that is the browser's location access, not the app, which falls back to "Drop a pin on the map instead". | — | Operator: set the CI variable (runbook); on "T7 correction live", deploy and run the handoff below. |
| 2/5 | F2 | Permit signal and detail: open and stalled toggle (on by default), long-open ordering, detail drawer with status, open duration, contractor attribution, BBB status, owner public fields, sources and CIDs (AC 5-6) | F1 verified | — | pending | — | — | — | — | — | — | Starts only after F1 is verified. |
| 3/5 | F3 | Save leads: tRPC API, DynamoDB, create one or many, leads page, persistence across reloads (AC 8, creating) | F1 verified (F2 for permit leads) | — | pending | — | — | — | — | — | — | — |
| 4/5 | F4 | Manage leads: status and note editing, delete, filters by status, roof age, permit group, open years and radius (AC 8, managing) | F3 verified | — | pending | — | — | — | — | — | — | — |
| 5/5 | F5 | Ask in natural language: `pidgeot-agent` on Bedrock through the AI SDK, pipeline and lead tools (AC 9) | F1-F4 | — | pending | — | — | — | — | — | — | — |

## F1: what is done and what remains

Done before the contract existed (2026-10-17): the workspace and CI; `packages/shared` (defaults, geo math, formatters,
disabled sections, hosting helpers, basemap constants); `packages/pipeline-client` transport, error model and the
pin/generate/check tooling; the map shell in `apps/web`; the `RoofingCrm` stack in `apps/api/cdk`; `pnpm basemap`;
`pnpm deploy:aws`; the runbook.

Done on 2026-10-20 (docs/decisions.md, 2026-10-20 entry):

1. Pin: `packages/contract/openapi.json` at `56b020c`, its snapshot and the generated types.
2. Typed operations: `getMeta`, `searchProperties` (with `cursor`) and `searchCenters` over openapi-fetch. The browser
   transport waits 29 s per attempt and retries a slow failure without a response once. A queue keeps one pipeline call
   in flight per page.
3. Web:
   - the default search on load, debounced on later changes;
   - markers from the first page;
   - "N matches, showing M" and rows with the match reasons, the roof-age basis, confidence, anchor, as-of date and
     caveats, coordinates and source;
   - "load more", which restarts on `stale_cursor`;
   - the `area_note` notice, including the GPS fallback;
   - the loading state with elapsed seconds, the "pipeline busy, retrying" notice and the error state with the request
     id;
   - the footer's run id, manifest CID, group CIDs and Atlas;
   - the place box;
   - marker and row selection.
4. `API_BASE` is recorded in `docs/runbook.md` and the operator's `.env`.
5. `pnpm check` passes.

Remaining:

- Operator: set the CI repository variable `PIPELINE_API_BASE` (the command is in the runbook).
- Operator: push the pipeline's `assignment` branch, so the pinned commit `56b020c` is on GitHub.
- When the pipeline tab relays "T7 correction live" with its measured cold times, the operator deploys and runs the
  handoff below.

## F1 handoff (applies once the pipeline's T7 correction is live)

**Piece 1/5 — F1 find aged roofs on the map**

- **Run:** `pnpm deploy:aws`, with `PIPELINE_API_BASE` in `.env` and your deploy profile in `AWS_PROFILE`. Open the
  "F1 link" it prints (`<WebUrl>/?lat=30.26720&lon=-97.74310&radius=5&age=15`). Then drop a pin north of the river, set
  the radius to 2 and the threshold to 30, type `Pflugerville` in "City or ZIP" and press Go, and press "Use my
  location".
- **Expect:** the map opens on Austin with a 5-mile circle and the default search under way ("Searching the pipeline…"
  with a seconds counter; about 7 to 8 s on a cold pipeline). Then: clustered markers; "N matches, showing 500" with N
  equal to the API's `total`; rows with "Aged roof", the roof-age basis and as-of date, coordinates and source; and the
  footer with the run id, manifest CID, the group CIDs list and "Atlas: not published yet". The place box moves the
  center to Pflugerville and shows its match type. The pin, the radius and the
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
