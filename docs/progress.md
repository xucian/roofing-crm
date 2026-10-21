# Progress — feature increments (guide-product-work)

One row per piece of `docs/decisions.md` (metagross item 26: five pieces, `Piece i/5`). Status is `pending`, `prepared`,
`observed` or `verified`. A piece is `verified` only after the operator has deployed it, used it on the public CloudFront
URL, inspected AWS and replied with the observation (item 27); agent-run checks never verify a piece. No secrets or
payloads are recorded here.

Product and role: the Roofing CRM, built by `metagross` (`build-frontend-backends`, `apply-engineering-guidelines`,
`guide-product-work`). Data source: the pipeline API v1, whose contract froze at `de08901`. The CRM pins the contract
at pipeline commit `56b020c`. `API_BASE` is `https://733jzm4xv4.execute-api.us-east-2.amazonaws.com` (pipeline handoff,
2026-10-20), committed as `apiBase` in `packages/pipeline-client/openapi.pin.json`. The pipeline's T7 correction
(Parquet read from its deploy bucket) is live: its letter of 2026-10-20 reports T7 and T8 verified by its operator,
`API_BASE` and the contract unchanged, and the measured cold times. F1 can be deployed and checked live.

## How the pieces fit

```
browser ──HTTPS──▶ CloudFront, stack RoofingCrm (us-east-2) ─┬─ default ─▶ S3: SPA, /config.json
                                                              ├─ basemap/* ▶ S3: travis.pmtiles (Range), glyphs, sprites
                                                              └─ api/* ───▶ HTTP API ─┬▶ leads Lambda (tRPC) ─▶ DynamoDB
                                                                  F3: leads.create, leads.createMany, leads.list
                                                                  F4: leads.update, leads.delete, list filters
                                                                      │ per new lead: /v1/meta first, then the permit
                                                                      ▼ or the property (the snapshot), one at a time
                                                                       └▶ agent Lambda (F5: agent.chat) ─▶ Bedrock Sonnet 4.6
                                                                          tools: 8 pipeline reads, list_leads, create_lead
browser ──HTTPS──▶ pipeline API v1 (API_BASE), one call at a time:
                   /v1/meta (takes the cold start), then /v1/properties/search; /v1/search-centers from the place box
                   F2: /v1/properties/{id} for the drawer; /v1/permits/search?property_id= past its first 50 permits
```

Example (F3): "Save lead" on the row of property 103857 sends `POST /api/trpc/leads.create`
`{workspace_id, property_id: "103857", permit_id: ""}`. The function reads `/v1/meta` and `/v1/properties/103857`
and writes the lead with its snapshot: 802 BARTON BLVD, roof 18 years old (new construction, 2008), and its
longest-open roofing permit, 1981-013092 BP, open since 1981-10-23, contractor "Gary Pools", BBB blocked at source,
from run `20261018T143520Z-t5-full`. Saving it again returns the same lead, with no pipeline call.

Example: the link `<WebUrl>/?lat=30.26720&lon=-97.74310&radius=5&age=15` makes the app call
`GET {API_BASE}/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&open_permits=false&limit=500`.
The answer `{items, total, next_cursor, area_note}` becomes up to 500 clustered markers, "N matches, showing 500", and
one row per roof with its match reason and roof-age basis; the call's `x-request-id` is shown under the results.

## Pieces

| Piece | ID | Usable increment | Depends on | Configuration / version | Status | Automated checks | Operator run / request id | AWS reference | Expected vs actual | Operator observation | Correction / cleanup | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1/5 | F1 | Find aged roofs on the map: hosted URL, Travis County and Austin by default, default search on load, pin and GPS, place box, radius, age threshold, clustered markers, list with total and match reasons, freshness footer, disabled sections (README AC 1-4, 7, 11). Plus CI (item 21). | Pipeline: contract pin and `API_BASE` (done); its T7 correction live (done, 2026-10-20) | Build `c1d594d` on `assignment`: F1 in `25cbc04`, the cold-start changes (decisions, 2026-10-20 §31 entry) and the committed `apiBase` in `0e6926b`, the basemap glyph fix in `c1d594d`. Contract pinned at pipeline `56b020c` (sha256 `7d8ece68…`, equal to the served file). `API_BASE` is `apiBase` in `openapi.pin.json`. Basemap built locally (Protomaps 20261016, sha256 `9e5238…48c8`) and uploaded by this deploy. | verified (2026-10-20) | 2026-10-20, `pnpm check` exit 0: Prettier, ESLint, typecheck, 156 tests (shared 24, pipeline-client 42, web 71, api 19), build, `cdk synth`, pin in sync; `check:served` matches the pin with only the committed `apiBase`. Production bundle under the deployed CSP in Chrome against a local fake pipeline (synthetic rows, scratchpad only): default search, 500 clustered markers, "12,431 matches, showing 500", rows, load more to 1,000, place box choices, footer CIDs, loading and 429-retry states, phone layout; no page errors, no request off the page's origin. | 2026-10-20, default search on the F1 link: request id `FjSrki-ZCYcEPCA=`, 53,308 matches. | Stack `RoofingCrm` (CREATE_COMPLETE 2026-10-20, build `c1d594d`, 307 s), distribution `E1S9QF3GJB2Y3V`, bucket `roofingcrm-webbuckete51352c0-y4fbaarodus7`; links in the F1 handoff. | Expected (pipeline letter, T7 correction live): on an idle pipeline the first call (`/v1/meta`) about 3 to 5 s, 8 to 9 s right after a pipeline deploy or a long idle, then the default search 1.6 to 1.7 s. Actual (agent comparison, 2026-10-20): the API answers the same query with `total` 53,308, as the app shows. `FjSrki-ZCYcEPCA=` is in both pipeline log groups: access log `/v1/properties/search` 200 at 16:33:39 UTC, 542 ms; API log `query` ok, 510 ms. The footer's run `20261018T143520Z-t5-full`, manifest CID `bafybeid6jqq…qiup36ud4` and 177 group CIDs equal `/v1/meta`. | 2026-10-20, live: dragging the pin or clicking the map moves the circle and refreshes the results; the radius change updates them at once. The footer (data source, run, manifest CID, 177 group CIDs, "Atlas: not published yet", build `c1d594d`) stays the same when the pin moves, as expected: it describes the pipeline run, not the search. The rest of step 2 (threshold, place box, location, navigation) checked by hand and as expected. AWS: stack outputs, bucket contents, CloudFront behaviors and invalidations confirmed; the request id has 2 lines in the API log group and 1 in the access log group. 2026-10-17, local preview (no AWS): `pnpm check` passes on the operator's machine; map, pin, radius and threshold work. GPS works in Firefox: a fix outside Travis County keeps the center and says so. Chrome on macOS returns `POSITION_UNAVAILABLE` on every site, browserleaks.com/geo included, so that is the browser's location access, not the app, which falls back to "Drop a pin on the map instead". | 2026-10-20: the first `pnpm deploy:aws` stopped before any AWS change. In `basemap/`, 252 of the 256 "Noto Sans Devanagari Regular v1" glyph files were dangling links: the assets repository links them to "Noto Sans Regular", and `pnpm basemap` copied the links into a temp dir it then deleted. It now copies the bytes and repairs an incomplete copy in place; the archive is unchanged (sha256 `9e5238…`). | None: F1 is verified. Stack `RoofingCrm` stays up for the evaluation. Next piece: F2. |
| 2/5 | F2 | Permit signal and detail: open and stalled toggle (on by default), long-open ordering, detail drawer with status, open duration, contractor attribution, BBB status, owner public fields, sources and CIDs (AC 5-6) | F1 verified (2026-10-20) | Committed on `assignment` on top of `c1d594d`; deployed 2026-10-20 (77 s); decisions.md, 2026-10-20 F2 entry. Same contract pin and `API_BASE`; no new AWS resource (web update of stack `RoofingCrm`). | verified (2026-10-20) | 2026-10-20, `pnpm check` exit 0: Prettier, ESLint, typecheck, 182 tests after the Escape fix (shared 27, pipeline-client 44, web 92, api 19), build, `cdk synth`, pin in sync. Production bundle in Chrome against the live pipeline (`pnpm build`, `vite preview`): default search with permits on, 54,173 matches, long-open and permit clusters; `?property=` link opens the drawer with the permits sorted, contractor, "Blocked at source", owner and sources; layouts at 1440, 1200 and 500 px. | 2026-10-20: drawer request id `FjbYcj-ACYcEMxw=`; 54,173 matches with the toggle on, 53,308 off. | Stack `RoofingCrm` updated 2026-10-20 (web only); distribution `E1S9QF3GJB2Y3V`, newest invalidation Completed; pipeline log groups as for F1. | Expected: permits on by default; 53,308 matches with the toggle off and 54,173 with it on (live API, 2026-10-20); the drawer's request id in both pipeline log groups. Actual (agent comparison, 2026-10-20): the counts are as expected; `FjbYcj-ACYcEMxw=` is `GET /v1/properties/103857`, 200 at 17:33:03 UTC in 175 ms in the access log, and `query` ok in 152 ms in the API log. | 2026-10-20, live: deploy 77 s. Steps 2.1 to 2.5 as listed, except that Escape did not close the drawer; × did, and `property=` left the URL. The drawer showed the roof age, the permit history, the owner and the sources in detail. The invalidation was checked. Re-check, 2026-10-20: Escape closes the drawer; the operator accepts F2 as verified. | 2026-10-20: the drawer listened for Escape only while focus was inside it, and after step 4 focus was on the permit toggle. It now listens on the page while it is open. A new app test presses Escape with focus on the toggle: it fails on the old code and passes now. | None: F2 is verified. Next piece: F3. |
| 3/5 | F3 | Save leads: tRPC API, DynamoDB, create one or many, leads page, persistence across reloads (AC 8, creating) | F1 and F2 verified (2026-10-20) | Committed on `assignment` as "F3 built: save leads" (`9b46c7b`) plus the esbuild fix after it; decisions.md, 2026-10-20 F3 entry. Same contract pin and `API_BASE`. New in stack `RoofingCrm`: HTTP API with three routes and throttles, `leads` Lambda, leads table, SNS topic, five alarms, CloudFront `/api/*` behaviour. | verified (2026-10-20) | 2026-10-20, `pnpm check` exit 0: Prettier, ESLint, typecheck, 246 tests (shared 38, pipeline-client 48, api-client 4, api 54, web 102), build, `cdk synth` with the function bundled, pin in sync. The bundled function loaded in Node: a bad input gets 400 with the request id, a batch gets 400, and the logs are JSON with `request_id`. The handler run locally against the live pipeline with an in-memory table: 6 rows saved in 6.3 s (3 property leads, 1 permit lead, an unknown property `not_found` with the pipeline request id, a permit on the wrong property `mismatch`). Production bundle in Chrome (local API, live pipeline): save one, save 3 ticked, save a permit from the drawer, Leads page after a reload, Show on map; phone width with no horizontal scroll; no page errors. | 2026-10-20: multi-save request id `FjpMnhxwCYcEMZg=`; permit lead saved by request `FjrIajyYiYcEPrQ=`. | Stack `RoofingCrm` updated 2026-10-20 (build `1a81015`): HTTP API `n5cb128ot8`; function `RoofingCrm-ApiFunction6BF808ED-hh43pNo1k6rz`; log groups `RoofingCrm-ApiFunctionLogs4B382957-u7QMrCiAmIt9` (function) and `RoofingCrm-ApiAccessLogs50B185DB-9vCOaEMyo1G3` (access); table `RoofingCrm-ApiLeads2EEDC5EB-1RUNII921SH9X`; topic `RoofingCrm-ApiAlerts29EC5504-214UkUOxrUjr`, email subscription confirmed. | Expected: after the handoff below, the workspace has 5 leads, each with a snapshot of run `20261018T143520Z-t5-full`, and they survive a reload; the multi-save's request id is in the `leads` function's log group with one "lead created" line per row. Actual (agent comparison, 2026-10-20): `FjpMnhxwCYcEMZg=` is `POST /api/trpc/leads.createMany`, 200 in 2,243 ms in the access log. The function log has, in order, `/v1/meta` (49 ms) and then for each of 3 properties the property read and "lead created". The table holds 8 leads in one workspace (`01M5DB4D…`), all from run `20261018T143520Z-t5-full`, all property leads (keys `<property_id>#`). An earlier multi-save (`FjouuhWSCYcEPwQ=`) took the truncated-permits path live: `/v1/permits/search` answered 200 for a property with more than 50 permits. Point-in-time recovery is on; the 5 alarms are OK; the metrics are in `RoofingCrm`. The CRM API's 6 calls all answered 200, with no failed row and no error. The first run had no permit lead: no permit save was attempted. After a second click, the permit lead is `223832#1981-001682 BP` (created 19:20:38 UTC, basis `saved`, contractor "Travis Lewis", the same run), and request `FjrIajyYiYcEPrQ=` logged "lead created". The table now holds 9 leads. | 2026-10-20, live: deploy and steps 1 to 5 done, "confirmed everything"; alarm email subscription confirmed. Then a permit lead: on the Leads page, "6701 WILLAMETTE DR, AUSTIN 78723 · New · Permit lead · 1981-001682 BP · property 223832", roof 63 years old (year built 1963), the permit open 45 years since 1981-08-03, "Contractor as printed: Travis Lewis · BBB blocked at source", with the snapshot of run `20261018T143520Z-t5-full` taken 19:20 UTC. | 2026-10-20: the first `pnpm deploy:aws` stopped at bundling, before any AWS change: `Command "esbuild" not found`. CDK bundles with `pnpm exec esbuild` at the repository root, and esbuild was a dependency of `apps/api` only. `pnpm check` had passed because its synth runs through `apps/api`'s own script, whose PATH holds that package's binaries. esbuild is now a root dev dependency, so both paths find it; the deploy's own invocation (the cdk binary, root PATH, deploy inputs) was re-run and bundles. | None: F3 is verified. Next piece: F4. |
| 4/5 | F4 | Manage leads: status and note editing, delete, filters by status, roof age, permit group, open years and radius (AC 8, managing) | F3 verified (2026-10-20) | Committed on `assignment` as "F4 built: manage leads" (`6e23f37`), deployed 2026-10-20; decisions.md, 2026-10-20 entries "Pipeline T9 letter" and "F4 built". Same contract pin and `API_BASE`. Changes in stack `RoofingCrm`, no new resource: routes `POST /api/trpc/leads.update` and `leads.delete` (2/s, burst 5 each); `UpdateItem` and `DeleteItem` on the leads table; reserved concurrency 10 on the `leads` function; `TableSystemErrors` covers both operations. | verified (2026-10-20) | 2026-10-20, `pnpm check` exit 0: Prettier, ESLint, typecheck, 278 tests (shared 49, pipeline-client 48, api-client 5, api 66, web 110), build, `cdk synth`, pin in sync. Production bundle in headless Chrome under the deployed CSP (`vite preview`), with the real handler run locally over an in-memory table of 4 synthetic leads (scratchpad only): status and note saved with request ids, and still there after a reload; status, roof-age and radius filters (3, 2 and 2 of 4) with request ids; a delete after its confirmation, nav "Leads 3"; at 390 px no horizontal scroll (scrollWidth 390); no page errors. | 2026-10-20: filtered read `FjxJPgpZiYcEPCA=` (1 of 9); delete `FjxO4hxUCYcEJ1Q=`. | Stack `RoofingCrm` updated 2026-10-20 (UPDATE_COMPLETE 19:59 UTC, build `6e23f37`); function, log groups and table as for F3; the function reserves 10 executions. | Expected, from the 9 leads in the table (read 2026-10-20, all New, each with an open roofing permit): roof older than 30 → 5 of 9; adding permit open at least 40 years → 3 of 9; adding near the map's pin (5 miles around Austin) → 1 of 9. After the delete, 8 items in the table, the edited one with `status` `working` and its note. Actual (agent comparison, 2026-10-20): `FjxJPgpZiYcEPCA=` is `GET /api/trpc/{proxy+}`, 200 in 30 ms in the access log; the function logged "leads listed" with filter `roof_age_min` 30, `open_years_min` 40, `within_miles` 5, returned 1 of 9 scanned, as expected. `FjxO4hxUCYcEJ1Q=` is `POST /api/trpc/leads.delete`, 200 in 27 ms; the function logged "lead deleted", outcome `deleted`, for property 192632, the 1-of-9 match. The table holds 8 leads; `223832#1981-001682 BP` is `working` with a 15-character note (updated 20:00:34 UTC). Reserved concurrency 10; the five alarms OK. | 2026-10-20, live: deploy and steps 1 to 6 as listed, "everything checks out": several filters at once, a status change, a note, and the delete of the lead for 1101 MAHAN DR, 78721. | None. | None: F4 is verified. Next piece: F5. |
| 5/5 | F5 | Ask in natural language: `pidgeot-agent` on Bedrock through the AI SDK, pipeline and lead tools, the Assistant page (AC 9); the dashboard (item 17) | F1-F4 verified (2026-10-20) | Committed on `assignment` as "F5 built: ask in natural language" (`2f5e95e`, deployed by the operator 2026-10-20 21:29 UTC), then the fixes of the alakazam F5 review ("F5: alakazam review fixes", `6e3d3f9`, deployed by the operator 2026-10-21); decisions.md, 2026-10-21 F5 entry. Same contract pin and `API_BASE`. Model `us.anthropic.claude-sonnet-4-6`. New in stack `RoofingCrm`: the `agent` function (reserved 5) and its log group, route `POST /api/trpc/agent.chat` (0.5/s, burst 3), Bedrock and LangSmith-secret grants, alarms `AgentErrors`, `AgentThrottles`, `ChatFailed` and `ChatDailyTokens`, the dashboard. The deploy script creates the secret `pidgeot-agent/langsmith-api-key` from `.env`. | verified (2026-10-21) | 2026-10-21, `pnpm check` exit 0: Prettier, ESLint, typecheck, 322 tests (shared 49, pipeline-client 50, api-client 5, api 104, web 114), build, `cdk synth` with both functions bundled (leads 1.2 MB without the AI SDK, agent 2.2 MB), pin in sync. Golden set: 10 of 10 in-process (2026-10-20); 10 of 10 against the deployed URL (2026-10-21, `2f5e95e`: p50 7.0 s, slowest 12.4 s cold; README turn `Fk5DMjwUCYcEPpQ=`: `/v1/meta`, `resolve_search_center`, `search_permits` 139 matches, 11.4 s, 10 ids cited, no warning in the agent log, 9 alarms OK); after the review fixes 13 of 13 in-process (p50 6.5 s). `cdk diff` against the deployed stack before the fixes: no differences. Production bundle in headless Chrome: the README example answered in 12.3 s, chips, records, limitations, tool calls; a chip opened the map; 390 px without horizontal scroll; no page errors. After the deploy of `6e3d3f9`: 13 of 13 against the URL (2026-10-21, on pipeline run `20261020T200236Z-t5-full`: p50 6.4 s, slowest 11.4 s, the README turn; workspace `01M5EFFC…`). The Assistant scroll fix after verification: `pnpm check` exit 0, 323 tests (web 115). | 2026-10-21: README question `FlDTWjJkiYcEP8w=` (12.3 s); save `FlD_HhRHiYcEJYQ=` (10.7 s); off-topic `FlERBhWACYcEP8w=` (2.3 s). | Agent function `RoofingCrm-ApiAgentFunctionD5C1BB5C-VRphe0Q02rMX`, log group `RoofingCrm-ApiAgentLogs16389536-TtW3PG8BBt1t`, dashboard `ObservabilityDashboard9A1D08B3-woa7jyp69jDf`, LangSmith project `pidgeot-agent`. | Expected: the README question answers `answered` within about 15 s, via `resolve_search_center` then `search_permits` with `min_open_years` 5; its request id in the agent's log group with one "chat turn" line and a "chat tool call" line per tool; its trace in LangSmith project `pidgeot-agent`; the golden set against the URL passes. Actual (agent comparison, 2026-10-21): `FlDTWjJkiYcEP8w=` is in the agent log group on a cold instance (init 575 ms): `/v1/meta` 81 ms, `resolve_search_center` 56 ms, `search_permits` 139 matches in 1,046 ms, then "chat turn" `answered`, 3 model steps, 2 tool calls, 0 tool errors, 10 ids cited, no citation failure, no deadline hit. Of the 11.2 s turn the model took 8.6 s, 6.2 s of it the last step (the written answer, 624 output tokens in the turn); the browser's 12.3 s adds about 1 s of network. In LangSmith `pidgeot-agent` its root run `pidgeot-agent turn` has the three model steps and the two tool calls as child runs, all `success`, with no map pin in its inputs. `FlD_HhRHiYcEJYQ=`: 4 tool calls and two "lead created" lines (`103857#1981-013092 BP`, `215724#1987-006022 BP`, both on run `20261020T200236Z-t5-full`), a 9.8 s turn. `FlERBhWACYcEP8w=`: `out_of_scope`, one model step, no tool call, 1.4 s. The 9 alarms OK. | 2026-10-21, live: steps 1 to 5 confirmed. The README question in 12.3 s: "Answered · around AUSTIN", the "older than five years" assumption, 38 records, two limitations (BBB blocked at the source; `needs_review` permits), `resolve_search_center` then `search_permits` (139 matches, 20 returned). A chip opened the map. The save turn saved 1981-013092 BP and 1987-006022 BP in 10.7 s and the nav's Leads count went up by 2, to 10. The off-topic question answered "Out of scope" in 2.3 s. Both dashboards looked at. The LangSmith trace the operator pasted (`Fk5JjgJ_CYcEMcg=`) is from the pipeline's project `staraptor-agent`; the agent checked `pidgeot-agent` (previous column). Noted: the page did not scroll to the new answer. | The Assistant page did not scroll to a new question or its answer. It now brings the latest exchange into view with its question at the top (`AssistantPage.tsx`, test in `App.test.tsx`); not a README criterion, so it ships with the next deploy and does not gate F5. The pipeline's run 2 (`20261020T200236Z-t5-full`, served since 2026-10-21 04:10Z) needed no CRM change: decisions.md, 2026-10-21 "Pipeline run 2" entry. | None for F5. Next: deploy the scroll fix, record the demo, then the PR, the slowking self-assessment and the closing decisions entry. |

## F1: what is done and what remains

Done before the contract existed (2026-10-17): the workspace and CI; `packages/shared` (defaults, geo math, formatters,
disabled sections, hosting helpers, basemap constants); `packages/pipeline-client` transport, error model and the
pin/generate/check tooling; the map shell in `apps/web`; the `RoofingCrm` stack in `apps/api/cdk`; `pnpm basemap`;
`pnpm deploy:aws`; the runbook.

Done on 2026-10-20 (docs/decisions.md, 2026-10-20 entry):

1. Pin: `packages/contract/openapi.json` at `56b020c`, its snapshot and the generated types.
2. Typed operations: `getMeta`, `searchProperties` (with `cursor`) and `searchCenters` over openapi-fetch. The browser
   transport waits 29 s per attempt. It retries only fast failures: a 429 with back-off, and a fast 5xx once. A timeout or
   a slow failure is shown with "Try again". A queue keeps one pipeline call in flight per page, with `/v1/meta` first.
3. Web:
   - the default search on load, debounced on later changes;
   - markers from the first page;
   - "N matches, showing M" and rows with the match reasons, the roof-age basis, confidence, anchor, as-of date and
     caveats, coordinates and source;
   - "load more", which restarts on `stale_cursor`;
   - the `area_note` notice, including the GPS fallback;
   - the loading state with elapsed seconds and, after 3 s, why it is slow; the "pipeline busy, retrying" notice; the
     error state with the request id and "Try again";
   - the footer's run id, manifest CID, group CIDs and Atlas;
   - the place box;
   - marker and row selection.
4. `API_BASE` is committed as `apiBase` in `packages/pipeline-client/openapi.pin.json`, which CI's served-contract
   check, `pnpm deploy:aws` and `pnpm dev` read, and is recorded in `docs/runbook.md`.
5. `pnpm check` passes.

Remaining:

- Nothing to check: the operator ran the handoff below on 2026-10-20 (build `c1d594d`) and F1 is verified.
- Operator: push `c1d594d` and this progress record to `xucian:assignment`. The pipeline's `assignment` branch, with the
  pinned `56b020c`, is already on GitHub.

## F5 handoff (run on 2026-10-21; F5 verified)

**Piece 5/5 — F5: ask in natural language.** Same account (561303652468), region (us-east-2) and profile (`cdk-lab`), in
the browser you used for F3 and F4. About ten minutes, four of them the deploy.

### Step 1: deploy

Done once on 2026-10-20 (build `2f5e95e`). Deploy again for the review fixes: `AWS_PROFILE=cdk-lab pnpm deploy:aws`,
answer `y`. It prints `LangSmith key: pidgeot-agent/langsmith-api-key is up to date.`; only the agent function changes,
so CDK should not ask about IAM. It is done when it prints `Deployed build …`.

### Step 2: use the app

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open https://d2ymfvxnntp0j0.cloudfront.net/assistant | "Assistant" in the nav, and four example questions. |
| 2 | Click the first: "Show me open roofing permits older than five years within five miles of Austin". Note the request id at the bottom of the answer. | Within about 15 s: "Answered · around AUSTIN", the longest-open permits with chips, an assumption that "older than five years" means open five years, "Records found", "Limitations", and "How it searched": `resolve_search_center` then `search_permits`. |
| 3 | Click a permit chip. | The map opens with that property in the drawer. |
| 4 | Back on **Assistant**, ask: "Save the two longest-open roofing permits within 3 miles of Austin as leads". | "Saved to your leads" with two permits; the nav's Leads count goes up by 2. |
| 5 | Ask: "What is the capital of France?" | "Out of scope", with no tool calls. |

### Step 3: one glance at the traces

Open [LangSmith](https://smith.langchain.com), project `pidgeot-agent`: the turns of step 2 to 5 are there, the first with
its child runs (the model steps and the two tool calls). I look up the request id in the agent's log group, check the
dashboard and the alarms, and run the golden set against the URL myself.

### Step 4: reply with

The request id from step 2, and a sentence on the answer and the LangSmith trace.

Optional, not a check: CloudWatch → Dashboards, the one named in the deploy's output, shows the chat turns.

## F4 handoff (run on 2026-10-20; F4 verified)

**Piece 4/5 — F4: manage leads.** Same account (561303652468), region (us-east-2) and profile (`cdk-lab`). Use the
browser you used for F3: its workspace holds the 9 leads. About eight minutes, three of them the deploy.

### Step 1: deploy

`AWS_PROFILE=cdk-lab pnpm deploy:aws`, answer `y`. CDK lists one IAM change, the function's new `dynamodb:UpdateItem`
and `dynamodb:DeleteItem` on the leads table: answer `y`. It finds F3's alarm email and does not ask for it again. The
deploy is done when it prints `Deployed build …`.

### Step 2: use the app

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open https://d2ymfvxnntp0j0.cloudfront.net/leads | 9 leads, all New, under a filter bar. |
| 2 | On the first lead, set the status to **Working**. Then **Add a note**, type anything, **Save note**. | "Status set to Working." and "Note saved.", each with a request id. The note shows on the card. |
| 3 | Under Status, untick **New**, then tick it again. | "1 of 9 leads match the filters" (the Working one), then all 9 again. |
| 4 | Type `30` in "Roof older than", then `40` in "Permit open at least", then tick **Near the map's pin**. Note the request id under the count. | 5 of 9, then 3 of 9, then 1 of 9 (within 5 miles of Austin, `30.26720, -97.74310`). |
| 5 | **Clear filters**. On a lead other than the one you edited, **Delete…**, then **Delete**. | "Deleted the lead for …" with a request id; the nav shows "Leads 8". |
| 6 | Reload the page. | 8 leads; the Working status and the note are still there; the filters are cleared. |

### Step 3: one AWS glance

Open DynamoDB's [Explore items](https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#item-explorer)
and pick the table that starts with `RoofingCrm-ApiLeads`. It holds 8 items, and the one you edited has `status`
`working` and your `note`. I look up the request ids in the function's logs, and check its reserved concurrency,
myself.

### Step 4: reply with

The request id from step 4 (the 1 of 9 read), the delete's request id from step 5, and a sentence on what you saw.

Optional, not a check: on the map, the deleted lead's row offers **Save lead** again.

## F3 handoff (run on 2026-10-20; F3 verified)

**Piece 3/5 — F3: save leads.** Same account (561303652468), region (us-east-2) and profile (`cdk-lab`). About ten
minutes, five of them the deploy.

### Step 1: deploy

`AWS_PROFILE=cdk-lab pnpm deploy:aws`, answer `y`. CDK then lists the new IAM resources (the function's role, its table
grant, API Gateway's permission to invoke it) and asks: answer `y`. Next it asks for an email address for the alarms:
enter one, or leave it blank. The deploy is done when it prints `Deployed build …` and the new resources.

### Step 2: use the app

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open https://d2ymfvxnntp0j0.cloudfront.net/?lat=30.26720&lon=-97.74310&radius=5&age=15 and click **Save lead** on the first row. | "Saved 1 lead." with a request id; the row says "Saved as lead"; the nav shows "Leads 1". |
| 2 | Tick **Select** on three more rows, then **Save 3 as leads** in the bar. | "Saved 3 leads." after a few seconds (one pipeline read per row); the three rows say "Saved as lead". Note this request id. |
| 3 | Open a row, and in the drawer click **Save permit as lead** on a roofing permit. | "Saved 1 lead." in the drawer, and that permit says "Saved as lead". |
| 4 | Click **Leads** in the nav, then reload the page. | 5 leads, newest first, still there after the reload. Each shows the roof age, a permit with status and open duration, the contractor as printed and "Snapshot of pipeline run 20261018T143520Z-t5-full". |
| 5 | Click **Show on map** on one. | The map centers on it, with its property open in the drawer. |

### Step 3: one AWS glance

Open DynamoDB's [Explore items](https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#item-explorer)
and pick the table that starts with `RoofingCrm-ApiLeads`. It holds 5 items whose `workspace_id` is the id shown at the
top of the Leads page. I look up the multi-save's request id in the function's logs myself.

### Step 4: reply with

The request id from step 2, and a sentence on what the Leads page showed.

Optional, not a check: if you entered an email in step 1, AWS has sent a "Confirm subscription" email; click its link
to receive the alarms.

## F2 handoff (run on 2026-10-20; F2 verified)

**Piece 2/5 — F2: permit signal and property detail.** Same account (561303652468), region (us-east-2), profile
(`cdk-lab`) and links as F1 below. About five minutes.

### Step 1: deploy

`AWS_PROFILE=cdk-lab pnpm deploy:aws`, answer `y`. F2 changes only the web app, so CDK should not ask about IAM, and
the deploy takes about two minutes. It is done when it prints `Deployed build …`.

### Step 2: use the app

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open https://d2ymfvxnntp0j0.cloudfront.net/?lat=30.26720&lon=-97.74310&radius=5&age=15 | "Open and stalled roofing permits" is ticked. About 54,173 matches (53,308 was aged roofs only). Red and violet clusters; the legend adds "Permit open 5+ years" and "Open or stalled permit". The first rows have red "Long-open roofing permit" badges and a "Roofing permits: …" line. |
| 2 | Click the first row. Note the request id at the bottom of the drawer. | A drawer opens (beside the list on a screen 1440 px or wider, over the map's right side otherwise), and the URL gains `&property=…`. Its roofing permits start with the longest-open one, red "Long-open" badge and "Open N years, since …". Each permit has the contractor as printed ("an attribution, not a verified identity") and BBB "Blocked at source". Then the owner's roll fields, and sources and CIDs. |
| 3 | Zoom into a red cluster and click a single red marker. | The drawer switches to that property and its row is highlighted. |
| 4 | Untick "Open and stalled roofing permits". | 53,308 matches again, all markers orange, `permits=0` in the URL. |
| 5 | Press Escape (or ×). | The drawer closes and `property=` leaves the URL. |

### Step 3: check AWS

Open the distribution's [Invalidations](https://us-east-1.console.aws.amazon.com/cloudfront/v4/home?region=us-east-1#/distributions/E1S9QF3GJB2Y3V/invalidations):
the newest one is from this deploy (`/index.html`, `/config.json`, `/favicon.svg`) and Completed. I check the drawer's
request id in the pipeline's log groups myself.

### Step 4: reply with

The drawer's request id, the match count with the toggle on and off, and a sentence on what the drawer showed.

Re-check after the Escape fix (done 2026-10-20): open a row, click the toggle, press Escape: the drawer closes.

## F1 handoff (run on 2026-10-20; F1 verified)

**Piece 1/5 — F1: find aged roofs on the map.** AWS account 561303652468, region us-east-2, profile `cdk-lab`. About
ten minutes once the deploy has finished.

Links for this deploy. Sign in to the console in account 561303652468 first: in another account they say the resource
does not exist. Redeploys update the same stack, so the links stay valid.

| What | Link |
| --- | --- |
| The app (F1 link) | https://d2ymfvxnntp0j0.cloudfront.net/?lat=30.26720&lon=-97.74310&radius=5&age=15 |
| Stack `RoofingCrm` | [Outputs](https://us-east-2.console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks/outputs?stackId=arn%3Aaws%3Acloudformation%3Aus-east-2%3A561303652468%3Astack%2FRoofingCrm%2F0173c000-cca1-11f1-baa3-0acc57f4cb4d) · [Events](https://us-east-2.console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks/events?stackId=arn%3Aaws%3Acloudformation%3Aus-east-2%3A561303652468%3Astack%2FRoofingCrm%2F0173c000-cca1-11f1-baa3-0acc57f4cb4d) (if the deploy fails) |
| Bucket `roofingcrm-webbuckete51352c0-y4fbaarodus7` | [Objects](https://s3.console.aws.amazon.com/s3/buckets/roofingcrm-webbuckete51352c0-y4fbaarodus7?region=us-east-2&tab=objects) |
| Distribution `E1S9QF3GJB2Y3V` | [Behaviors](https://us-east-1.console.aws.amazon.com/cloudfront/v4/home?region=us-east-1#/distributions/E1S9QF3GJB2Y3V/behaviors) · [Invalidations](https://us-east-1.console.aws.amazon.com/cloudfront/v4/home?region=us-east-1#/distributions/E1S9QF3GJB2Y3V/invalidations) |
| What CloudFront serves | [config.json](https://d2ymfvxnntp0j0.cloudfront.net/config.json) · [basemap/SOURCE.json](https://d2ymfvxnntp0j0.cloudfront.net/basemap/SOURCE.json) |
| Pipeline API logs (stack `TravisApi`) | [API function log group](https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#logsV2:log-groups/log-group/TravisApi-ApiFunctionLogs0D7A2434-ZaFrnBApK12C/log-events) · [Access log group](https://us-east-2.console.aws.amazon.com/cloudwatch/home?region=us-east-2#logsV2:log-groups/log-group/TravisApi-AccessLogs8B620ECA-PBB76GmFFv1e/log-events) |

### Step 1: deploy

Done on 2026-10-20: build `c1d594d`, 307 s, outputs as in the table above. To redeploy, run
`AWS_PROFILE=cdk-lab pnpm deploy:aws` and answer `y` to its question and to CDK's IAM approval. It is done when it
prints `Deployed build <commit>.` and the F1 link above. If it stops with an error, open the stack's Events link: the first `CREATE_FAILED` row names the cause.

### Step 2: use the app

| # | Do | Expect |
| --- | --- | --- |
| 1 | Open the F1 link. | The map opens on Austin with a 5-mile circle. The list says "Searching the pipeline…" with a seconds counter and, after 3 s, why it is slow. The first pipeline call takes about 3 to 5 s on an idle pipeline (8 to 9 s right after a pipeline deploy or a long idle). The search after it takes under 2 s. |
| 2 | Wait for the results. Note the total and the request id. | Clustered markers. "N matches, showing 500". Rows with "Aged roof", the roof-age basis and as-of date, coordinates and source. "Request id …" under the results. The footer shows the run id, the manifest CID, the group CIDs and "Atlas: not published yet". |
| 3 | Click the map north of the river, or drag the pin there. | The circle moves, and the URL's `lat`/`lon`, the markers and the count change. |
| 4 | Set "Radius" to 2 and "Roofs older than" to 30. | The circle shrinks, the URL shows `radius=2&age=30` and the count drops. |
| 5 | Type `Pflugerville` in "City or ZIP" and press Go. | The center moves to Pflugerville and the box shows its match type. |
| 6 | Press "Use my location". Use Firefox: Chrome on this Mac gets no location on any site. | From outside Travis County, the center stays where it was and a notice says why. |
| 7 | Look at the navigation. | Under "Coming soon": Outreach, Campaigns, Sequences, Reporting and Billing, each disabled with a "Soon" badge. |

### Step 3: check AWS

1. **Stack.** Open the stack's Outputs. The status is `CREATE_COMPLETE`, `PipelineApiBase` is
   `https://733jzm4xv4.execute-api.us-east-2.amazonaws.com` and `WebUrl` is `https://d2ymfvxnntp0j0.cloudfront.net`.
2. **Bucket.** Open the bucket's Objects. It holds `index.html`, `favicon.svg`, `config.json`, `assets/` (the
   bundles) and `basemap/` (`travis.pmtiles` at 71.8 MB, `SOURCE.json`, `fonts/`, `sprites/`). Then open the served
   `config.json`: its `pipelineApiBase` is the API base above. In the served `SOURCE.json`, `protomapsBuild` is
   `20261016` and `sha256` starts with `9e5238`, as in the runbook.
3. **CloudFront and the pipeline logs.** The distribution's Behaviors tab lists `basemap/*` and `Default (*)`. The
   Invalidations tab shows two from this deploy, both Completed: `/index.html`, `/config.json`, `/favicon.svg`; and
   `/basemap/*`. Then open the API function log group and set the time range to the last hour. Paste the request id from
   step 2 in double quotes into the search box. At least one line matches; do the same in the access log group. Lines
   can take a minute to arrive. The same check from the terminal prints two counts, each 1 or more:

   ```sh
   RID='<request id from step 2>'
   for g in TravisApi-ApiFunctionLogs0D7A2434-ZaFrnBApK12C TravisApi-AccessLogs8B620ECA-PBB76GmFFv1e; do
     AWS_PROFILE=cdk-lab aws logs filter-log-events --region us-east-2 --log-group-name "$g" \
       --start-time $(( ($(date +%s) - 3600) * 1000 )) --filter-pattern "\"$RID\"" --query 'length(events)'
   done
   ```

### Step 4: reply with

- the request id shown under the results (step 2, item 2);
- the total N for the default search;
- one or two sentences on what the circle, markers, list and footer did after the pin and radius change, and anything
  in steps 2 and 3 that differed from what is listed here.
