# Architecture decisions — Roofing CRM

Fixed on 2026-10-16 before implementation, revised the same day. `README.md` is the spec; this file records
how it is met. Change it only by adding a dated entry at the end; before the PR is marked ready, a dated
closing entry records what was delivered against this plan and what was not.

## 1. Scope

- A map-based roofing lead CRM for Travis County, TX, public at one HTTPS URL, no login, usable by anyone.
- All property and permit data comes from the pipeline API defined in the pipeline repository's
  [`docs/api-contract.md`](https://github.com/xucian/oracle-property-intelligence-platform-pipeline-travis-tx/blob/assignment/docs/api-contract.md)
  (`API_BASE` recorded in `README.md` after the pipeline deploys). This repository ingests nothing and keeps no
  copy of county data. If the CRM needs a field the API lacks, the contract changes in the pipeline repository first.

## 2. How the kit is used

- Built with the [soofi-xyz-team-kit](https://github.com/soofi-xyz/soofi-xyz-team-kit) run as its Claude Code
  plugin (kit v0.99.1, commit `99c7bff`). Agents: `arceus` (routing), `metagross` (fullstack build),
  `slowking` (self-assessment). Skills: `apply-engineering-guidelines`, `guide-product-work`,
  `build-frontend-backends`, `build-rag-systems`, `build-ai-agents`, `evaluate-candidate-*`.
- Three guided increments, each deployed and clicked through on the public URL before the next:
  1. find leads on the map, 2. save and manage leads, 3. ask in natural language.

## 3. Stack (us-east-2, TypeScript, one CDK stack, near-zero standing cost)

- Frontend: React + Vite, MapLibre GL with a keyless raster basemap (CARTO Voyager tiles with attribution, or
  Protomaps PMTiles hosted on the same S3 bucket if the builder prefers no third-party tile dependency), hosted
  on S3 + CloudFront.
- Backend: one Lambda (Node 22) behind an HTTP API: leads CRUD on DynamoDB (on-demand capacity) and
  `/agent/chat`. Pipeline calls go through a typed client of API v1 that backs off on `429` (1 s, 2 s, 4 s)
  as the contract specifies; the agent's tool calls cross that HTTP boundary and are subject to the same throttles.
- Agent: Vercel AI SDK + Zod on Bedrock running on the Lambda, never in the browser. Model: the same
  `BEDROCK_MODEL_ID` stack parameter as the pipeline, default `us.anthropic.claude-opus-5-5`, with the same
  Lambda-role grants (profile ARN plus the foundation-model ARNs of the routed regions). Same contingency as
  the pipeline: if Bedrock enablement on the account is still pending in increment 3, the Anthropic provider
  of the same SDK with a key in Secrets Manager, recorded as a dated deviation.
- Powertools logger, tracer and metrics. Stage throttling shared by all clients, a tighter route throttle on
  `/agent/chat` and on the lead write routes, a per-request output cap, reserved concurrency, a CloudWatch
  alarm on daily chat usage. The leads table has point-in-time recovery on, since the write API is public. The
  chat call is synchronous because the user waits, with a 30-second timeout and two retries with backoff;
  alarms go to a PagerDuty free-tier service through SNS when it can be wired, otherwise to email, recorded.
- Not used: Cloudflare, SAM as IaC, Terraform, browser-held keys, a second copy of Travis data.

## 4. Defaults and rules

- Default county Travis; initial view centered on Austin (30.2672, −97.7431). **The default search runs on
  load** at that center with the default radius, so the map is never empty.
- Search center = dropped pin or browser GPS. A GPS fix outside Travis County keeps the Austin center and says
  so; the demo uses pin drop. Radius default 5 miles (0.1–25); roof-age threshold default 15 years
  (configurable); open-permit filter on by default; long-open = 5 years. "Older than" is strict, as in the
  contract: `roof_age_years > threshold`.
- Default result set in the radius = roofs older than the threshold **or** open/stalled roofing permits
  (API `properties/search` with the same params). Order as the API returns it: open permits, then stalled, by
  open duration, then aged roofs by age.
- **Scale.** Most Austin housing is older than 15 years, so a 5-mile radius returns thousands. The map renders
  the first 500 results as clustered markers and shows the API's `total` ("12,431 matches, showing 500"); the
  list pages through the rest. Narrowing the radius or raising the threshold is the user's tool, not a hidden cap.
- Every row shows why it matched (`match_reasons`), the roof-age basis, coordinates and the source. Stalled
  permits show how long they were open and how long ago they expired, as the API reports them.
- BBB is shown as the API returns it: a rating when present, otherwise "unavailable". Never invented.
- Roof age is shown with its basis; only a strict re-roof permit moves it, per the contract's two-tier rule.
- A pipeline API failure shows an error state with the request id; nothing is cached or faked in its place.
- Owner public-roll fields appear in the detail view only. No phones or emails exist in the sources; none are shown.

## 5. Lead model (DynamoDB)

| Field | Notes |
| --- | --- |
| `lead_id` | ULID |
| `property_id`, `permit_id` | at least one is set; `permit_id` empty for a property-only lead, `property_id` empty for a permit whose parcel is unknown; the pair, with empty strings for the missing side, is unique → create is an upsert |
| `status` | `new` (default), `working`, `closed` |
| `note` | free text |
| `snapshot` | address, lat, lon, roof_age_years, roof_age_basis, permit status group and open duration, contractor printed name, `run_id` — copied at creation for display, labelled as a snapshot |
| `created_at`, `updated_at` | |

Operations: create (one row, or several from a multi-selection in the results list in one action), list with
filters (status, roof age min, permit status group, min open years, radius around the current map center),
update status and note, delete. Leads persist across reloads on the public URL.

## 6. Agent

- Own endpoint `/agent/chat`, stateless (the client sends the full history); tools: `resolve_place`,
  `search_properties`, `search_permits`, `search_permit_text`, `get_property`, `get_permit` (pipeline API) and
  `list_leads`, `create_lead` (CRM). A question that names a city or ZIP resolves it through `resolve_place`
  before searching; the answer names the center it used. `create_lead` runs only when the user explicitly asks to save something, and the agent
  states what it saved.
- Answers cite property and permit ids and the source; "permits older than five years" means open duration,
  not roof age; out-of-county or off-topic questions get a clear miss, never invented rows.
- **This is the README's "RAG-backed agent".** Retrieval is structured (radius, age, status, tenure through
  the query tools) and lexical (full-text search over permit text); generation only reports rows those tools
  returned. No embedding index: the README's example question is a spatial and numeric filter, which embeddings
  cannot evaluate, and the kit's RAG skill counts operational retrieval over records as RAG. The intent file
  and the PR say this in one paragraph.

## 7. UI structure

Map with pin drop, GPS button, a place box (city or ZIP, backed by `/v1/places`) that moves the center, radius
control, age threshold, open-permit toggle, clustered markers and legend;
results list next to the map with the total; a footer showing the pipeline `run_id` and dataset CID from
`/v1/meta` so data freshness is visible; detail drawer (property with `property_id` and `geo_id`, roof age
and basis, permits with status, open duration, contractor and BBB, owner public fields, sources); Leads page
with filters, status and note editing, delete; Chat panel. Navigation shows disabled sections with "coming
soon": Outreach, Campaigns, Sequences, Reporting, Billing.

## 8. Quality bar

TypeScript strict, Vitest, ESLint, Prettier, `tsc`, GitHub Actions on the PR. No secrets in git, logs or video.
No mock Travis data in the submitted branch.

## 9. Out of scope

Ingestion, live BBB integration, outbound messaging to owners, authentication.

## 10. PR deliverables

Public URL (no login), `API_BASE` it consumes, demo video recorded on that URL walking the README demo
transcript, `docs/runbook.md` (deploy from a clean clone, `.env.example`), `docs/slowking-self-assessment.md`,
"how to review in two minutes", what is real vs unavailable, limitations, monthly cost. The URL stays up after
submission.

## 2026-10-16 — README.md is read-only; where review findings go

- `README.md` is the assignment's problem statement and is never edited, by hand or by an agent. Where a kit
  convention conflicts with it, the README wins and the deviation is recorded in this file.
- §1: `API_BASE` is recorded in the PR description, `docs/runbook.md` and `.env.example` (§10), not in a README.
- Kit reviews of this plan write their findings to `docs/reviews/<date>-<agent>.md` and edit nothing else.
  Accepted findings enter this file as dated entries that link the review; rejected ones stay in the review.

## 2026-10-16 — After the metagross review (`docs/reviews/2026-10-16-metagross.md`)

All 28 items are accepted as classified there; their wording is part of this plan, amended as below. Where this
entry and the review differ, this entry wins.

- §2: five pieces replace the three increments: F1 find aged roofs, F2 permit signal and detail, F3 save leads,
  F4 manage leads, F5 ask in natural language (item 26), each tracked in `docs/progress.md` (item 27).
- §3, layout and API: pnpm + Turborepo (`apps/web`, `apps/api` with `cdk/` inside, `packages/api-client`,
  `packages/pipeline-client`, `packages/shared`, `packages/tsconfig`); tRPC under `/api/trpc` with `httpLink` and no
  batching, so each procedure keeps its route throttle (items 3–6).
- §3, hosting: one CloudFront distribution, S3 for the app and the basemap, `/api/*` to the HTTP API, so the CRM
  API is same-origin; `API_BASE` is passed once as CDK context (item 2). S3 + CloudFront instead of Amplify,
  synchronous chat and email-first paging are justified deviations, for the reasons in items 1, 12 and 19.
- §3, basemap: a Protomaps PMTiles extract of the Travis bounding box on the same bucket; CARTO only if the extract
  cannot be produced in F1 (item 11). A repository script makes the extract and the deploy uploads it; the file is
  not committed, and the runbook names the Protomaps build it came from.
- §3, functions: two `NodejsFunction`s from one codebase, `leads` and `agent`, each shaped as in item 9 with its
  own timeout, memory and reserved concurrency. Justified deviation from §3's one Lambda and the kit's single-Lambda
  overview: a burst of chat turns cannot starve lead writes, and the AI SDK stays out of the CRUD cold start.
- §3, chat budget: a 25 s handler deadline (Lambda timeout 29 s) under the HTTP API's 30 s integration cap, one
  `AbortSignal` across model and pipeline calls, at most one retry, a partial answer when the budget runs out. This
  replaces "a 30-second timeout and two retries" (item 13).
- §3, model: `BEDROCK_MODEL_ID` defaults to `us.anthropic.claude-sonnet-5-5`, with Opus as the parameter flip; a
  cost choice for a public endpoint. The Sonnet profile is confirmed in the account's inference profiles before F5.
- §3, operations: the `project_name: roofing-crm` tag (item 10); pipeline-client timeouts and retries (item 14);
  log retention and PII rules, named metrics and the alarm set (items 15, 16, 18); test layers and CI (item 21).
  Deploys run only from the operator's machine; CI runs checks.
- §5, lead key: partition key `workspace_id`, sort key `<property_id>#<permit_id>` (empty string for a missing
  side); create is a conditional put and a repeated create returns the existing lead (item 22, adapted).
  `workspace_id` is a ULID the browser keeps in local storage and sends with every lead call, so each visitor sees
  only their own leads. It partitions, it does not authenticate, and clearing site data starts a new workspace.
  The list is a paginated query on the workspace with filters applied in the Lambda; item 22's `by_status` index
  is dropped.
- §5, snapshot: the `leads` function fetches each lead's property and permit from the pipeline at create time and
  never takes a snapshot from the client, so every snapshot carries the pipeline's `run_id`. `createMany` takes at
  most 25 rows, fetches them with bounded concurrency inside the request deadline and reports each row as created,
  existing or failed; a pipeline failure fails that row with the request id (§4). Item 7 is amended to match: the
  CRM calls the pipeline from the agent's tools and from lead creation, and never proxies reads.
- §10: the deliverables add `docs/intent.md`, `docs/progress.md`, `docs/metrics.md` and `docs/reviews/` (item 28).
- Contract names (item 8): the rule is accepted. The renames land in one entry that syncs this file with the
  pipeline contract once its v1 freezes, since the pipeline's own reviews may still change it.
- Not applicable, as reasoned in the review: items 17, 20, 23, 24, 25.

## 2026-10-16 — After the alakazam review (`docs/reviews/2026-10-16-alakazam.md`)

All 25 items are accepted as classified there, amended as below. Where this entry and the review differ, this
entry wins, and the metagross entry above wins on the chat budget.

- §6: the taxonomy sentence is replaced by item 1's wording: grounded generation over operational records, with
  structured and lexical retrieval through the pipeline's tools; the kit's vector step is omitted, and that is
  recorded. The CRM builds no index (item 2, README override).
- Semantic leg (item 3) and contractor search (item 24): nothing is requested from the pipeline now. Both proposals
  in the review are optional and nullable, which the contract accepts after its v1 freeze, so neither is on the
  critical path. If the pipeline adds a semantic or hybrid mode (its own alakazam review decides that for its
  agent), the CRM agent adopts it; until then the omission is a recorded deviation for item 3's reasons, and a
  question that names a contractor is answered as not supported yet.
- Tool names: item 18's renames land with the contract sync (metagross entry); its two added tools stand.
- Budget: items 13 and 23 work within the metagross entry's 25 s deadline, not 30 s.
- Increments: "increment 3" in items 7 and 15 means F5.
- Workspace: the chat request carries `workspace_id`, and `list_leads` and `create_lead` act only on that
  workspace (item 17 amended).
- Fixtures (items 6, 7): recorded pipeline responses are a copy of county data, which §1 and §8 keep out of the
  branch. A script captures them into a git-ignored folder; the golden question set (questions and expected tool
  calls, no data) is committed; the replay runs locally and against the live API after each deploy.
- Owner fields stay out of the model context (item 9).
- Agent name: `pidgeot-agent` is proposed; the operator confirms it before F5 scaffolding (item 20).
- LangSmith (item 15): if no LangSmith workspace exists by F5, the facade ships degraded and this file records it.

## 2026-10-16 — Agent name confirmed; LangSmith available

Closes alakazam open decisions 1 and 2; 3 and 4 were settled in the entry above.

- Agent name (item 20): `pidgeot-agent`, picked by `ash`, the kit agent that names runtime agents (a real Pokémon
  as `<pokemon>-agent`, no clash with kit agent names), and confirmed by the operator, as the kit requires. The
  one-line rationale is in `docs/runbook.md`, since `README.md` is read-only.
- LangSmith (item 15): a workspace exists, so F5 ships the facade enabled, not degraded. The key stays in the
  operator's git-ignored `.env`; `.env.example` lists the variable names and the project value, never the key. The
  deploy script writes the key to Secrets Manager with the AWS CLI, outside CloudFormation, and CDK only references
  the secret, so the key never lands in a template; the agent function gets `LANGSMITH_API_KEY_SECRET_ARN`. A
  missing key degrades tracing and never fails a turn.
- §2: the kit agents in use are `arceus`, `metagross`, `alakazam` (agent and retrieval design), `ash` (agent
  naming) and `slowking`; `evaluate-candidate-*` means `evaluate-candidate-intent`, `-product` and
  `-implementation`, which `slowking` runs.

## 2026-10-17 — Synced with the frozen pipeline contract v1

The pipeline froze contract v1 at its commit `de08901`; later changes there are additive only. This entry brings
the plan in line with it (diff from this plan's baseline: `git diff 44c7fce de08901 -- docs/api-contract.md` in
the pipeline repository). Where it differs from earlier text, this entry wins.

- Pinning: the CRM pins the pipeline's committed `openapi.json` (normative; generated in the pipeline's first T7
  commit) by commit and generates the `packages/pipeline-client` types from it; CI compares the pin with the served
  `GET /v1/openapi.json` when `API_BASE` is set (metagross items 8, 21). `API_BASE` arrives with T7 in the
  pipeline's runbook and PR body; the CRM copies it into its runbook, `.env.example` and PR.
- Names (§6, §7): `/v1/search-centers` and `resolve_search_center` replace `/v1/places` and `resolve_place`. The
  place box shows each match's `match_type` and asks which place was meant when no match is exact.
- Search (§4): the map asks for `limit=500` (the REST default is 50). A center outside the county returns no rows
  and an `area_note` ("outside Travis County"), which the UI shows.
- Transport (§3, §4): error states show the `x-request-id` header, or `apigw-requestid` on gateway-generated
  responses. Throttle numbers come from `/v1/meta.limits`, never hard-coded; `429` backs off 1 s, 2 s, 4 s on the
  status code alone; `400 stale_cursor` restarts the list from the first page.
- Roof age (§4): shown with its basis, confidence, anchor, as-of date and caveats. Only a completed primary roof
  replacement resets it (else completed new construction, else year built) and issue dates never count; this
  replaces §4's "two-tier rule".
- Permits (§4, §7): `needs_review` (status or work class unmapped) is its own group and never counts as open.
  Stalled permits show `open_duration_days` and `days_since_expiry`. The detail drawer lists the first 50 permits
  with `permits_total` and pages the rest through `/v1/permits/search?property_id=`.
- Contractor and BBB (§4, §7): the contractor is shown as printed (name, company, trade, phone) and labelled an
  attribution, not a verified identity. §4's "no phones or emails" is about owners, whose roll has none; a
  contractor's business phone printed on a public permit is shown. BBB shows the rating when `available`, "no BBB
  profile" when `unavailable` and "blocked at source" when `blocked`, as it is in the current run.
- Provenance (§4, §7): fields backed by `record_cid` and fields backed by `unpublished_source` (description, printed
  status, contractor fields, `geo_id`, `owner_name` and others) are labelled separately; the latter are
  source-backed, not CID-backed. Third-party text is rendered as plain text and reaches the model only as data,
  never as instructions.
- Footer (§7): `run.run_id`, the group CIDs (`groups.*.cid`) and `manifest_cid` from `/v1/meta`, plus `atlas`
  once it is set.
- Leads (§5): served permits always carry `property_id`, so every lead has one; `permit_id` is empty for a
  property-only lead. The snapshot is one call per row: the permit, which embeds its property, or the property for
  a property-only lead. Permit ids contain a space and are URL-encoded.
- Agent (§6; alakazam items 8, 12, 17–19): tools mirror the frozen MCP registry's descriptions and input and output
  schemas (`limit` 20, max 50; `open_permits` required on `search_properties`; one id on `get_property`; failures
  returned as results with `{error, detail?, retry_after_seconds?, request_id}`). Requests take the pipeline chat's
  bounds (20 messages, 4,000 characters each, 16,000 in total, the last from the user; `400` or `413`), replacing
  item 12's numbers, plus `workspace_id`; an unavailable model is `503 agent_unavailable` with a reason. Responses
  take the pipeline chat's shape (`outcome`, `answer` with `[[property:<id>]]`-style citations, `assumptions`,
  `tool_calls`, server-built `evidence` checked against this turn's tool results, typed `limitations`, run, model
  and prompt ids) plus `center_used` and `leads_created`; at the deadline the answer is `200` with
  `outcome: "limit_reached"`.

## 2026-10-17 — F1 built ahead of the pipeline's T7; what waits for it

The pipeline is at `f35d7e8`: its contract is frozen at `de08901`, but T7, which commits `openapi.json` and publishes
`API_BASE`, has not started (it follows T6). F1 is built only where it does not depend on that file and stays
`prepared` in `docs/progress.md`. Nothing is typed from the contract prose, and no Travis data is mocked, recorded or
bundled.

- **Built now.** The workspace (pnpm 10 and Turborepo: `apps/web`, `apps/api` with `cdk/` only, `packages/pipeline-client`,
  `packages/shared`, `packages/tsconfig`); the map shell (Austin default, pin drop and drag, GPS, radius 0.1 to 25 miles,
  strict age threshold, clustered results layer, legend, URL state, disabled sections, footer); the pipeline client's
  transport and error model; the pin, generate and check tooling; the stack (S3 and CloudFront, `config.json`, security
  headers, basemap); `pnpm basemap`; `pnpm deploy:aws`; CI (item 21).
- **Waits for T7** (the pinned `openapi.json` and `API_BASE`): the generated types; the typed calls to `/v1/meta` and
  `/v1/properties/search`; list rows with match reasons, roof-age basis, confidence, anchor, as-of date and caveats,
  coordinates and source; "N matches, showing M" with paging and the `stale_cursor` restart; markers from the first 500
  rows; the `area_note` notice; the footer's run id, group CIDs and manifest CID; the error state with the request id;
  the first deploy and the operator's check. `docs/progress.md` lists these as F1's remaining steps.
- **Pin mechanics** (2026-10-17 entry). `packages/pipeline-client/openapi.pin.json` holds the pipeline repository, commit,
  path and sha256, all null until T7. `pnpm --filter @roofing-crm/pipeline-client pin <commit> <path>` reads the bytes at
  that commit (`git show` in a local clone, else the raw GitHub URL), checks that they are OpenAPI 3.1, commits them as
  `openapi/openapi.json` and generates `src/generated/pipeline-api.ts` with openapi-typescript; calls go through
  openapi-fetch over the package's transport. CI fails when the snapshot's sha256 or the generated file drifts and, once
  the repository variable `PIPELINE_API_BASE` is set, when the served `GET /v1/openapi.json` differs from the pin. Zod
  schemas from the same pin are generated when a runtime consumer needs them (F5's tools); F1 needs compile-time types
  only, so appendix A's "Zod" for this package waits until then.
- **Transport** (items 7, 14; pipeline decisions §21). A 15 s timeout per attempt in the browser (8 s for the Lambda
  later), covering the body; `429` backs off 1 s, 2 s, 4 s on the status alone and ignores `Retry-After`; a request with no
  readable response is treated the same way, because in a browser a gateway `429` without CORS headers looks like a
  network error; a 5xx or a timeout is retried once after a full-jitter delay under 1 s, for GET only; 400, 404 and 413 are
  never retried; every failure carries `x-request-id`, else `apigw-requestid`, else the body's `request_id`.
- **F1 asks for aged roofs only** (`open_permits=false`). F2 adds the open-permit toggle, on by default as §4 says; until
  then the result set is roofs older than the threshold.
- **SPA routing** is a viewer-request CloudFront Function on the app behaviour, replacing item 2's distribution-wide 403/404
  to `/index.html`: those apply to every behaviour, so they would turn a missing basemap object, and F3's `/api/*` errors,
  into `index.html` with status 200.
- **Basemap.** The PMTiles extract is produced in F1, so CARTO is not used (item 11). Glyphs and sprites are self-hosted
  beside it for the same reason: protomaps/basemaps-assets at `028c18f`, all four font stacks the light style can request,
  including the Devanagari stack its label expression names. `pnpm basemap` runs the `pmtiles` CLI or the pinned
  `protomaps/go-pmtiles:v1.31.2` image, takes the newest daily build unless `--build` names one, and records build, box,
  zoom and sha256 in `basemap/SOURCE.json`, which is uploaded with it; the runbook names the deployed build.
- **Hosting.** The CSP is built from the pipeline origin (`connect-src 'self' <API_BASE origin>`, MapLibre 6's module worker
  same-origin, no `unsafe-*`), with HSTS and `Permissions-Policy: geolocation=(self)`. Hashed bundles are immutable for a
  year and kept across deploys; `index.html`, `favicon.svg` and `config.json` are revalidated and invalidated per deploy;
  `basemap/*` is served uncompressed and cached for 7 days. The bucket holds build output only and is retained on stack
  deletion; the stack has termination protection; the deployment helper's log group keeps 90 days (item 15, applied to
  the one Lambda F1 creates).
- **Deploy inputs.** CDK context `pipelineApiBase` and `basemapDir`; `pnpm deploy:aws` passes them with
  `requireDeployInputs=true`, refuses while the pin is pending or the served contract differs from it, shows the AWS
  identity and stops on a missing CDK bootstrap. CI synthesizes without them; `config.json` then says `null` and the app
  shows "Pipeline API not configured". `.env.example` lists `PIPELINE_API_BASE` without a value: the operator's brief of
  2026-10-17 limits that file to names, so the value goes to the runbook and the PR, replacing the 2026-10-17 entry's
  ".env.example" for it.
- **GPS** (§4). Each press asks the browser for a fresh fix, since a cached one keeps a place the user has left. A fix
  outside the map's box keeps the current center (Austin at start) and says so; inside the box, the search's `area_note`
  decides once T7 lands.
- **Toolchain.** TypeScript 5.9, because openapi-typescript needs TypeScript 5 and typescript-eslint stops below 6.1;
  MapLibre 6, the maintained line, with its module worker emitted as a same-origin `.js` asset; React 19, Vite 7, Vitest 4,
  ESLint 10 run once from the root config, CDK 2.273. pnpm resolves only versions at least seven days old
  (`minimumReleaseAge`), and CI pins its actions by commit. Vite loads its config with `--configLoader runner` so the
  config can import the TypeScript workspace package `@roofing-crm/shared`. All packages use bundler module resolution,
  since nothing runs TypeScript on bare Node. Turborepo's `agentGuidance` is off, so `turbo` does not re-create the
  `AGENTS.md` the operator removed in `b88fb22`.
- **`apps/api`** holds only `cdk/` until F3 adds the tRPC Lambda. F1's stack has no HTTP API, function or table, and the
  `/api/*` behaviour arrives with F3.
- **Open for the operator.** The place box (§7 and the 2026-10-17 entry) is in none of item 26's pieces. Proposal: add it
  to F1's post-T7 work, since it centers the map and is typed by the same pin. Until a dated entry decides, it is not built.

## 2026-10-17 — Place box joins F1

The operator accepted the proposal above: the place box (§7) is part of F1's post-T7 work. It calls
`/v1/search-centers` through the pinned client, moves the center to the chosen match, shows its `match_type` and
asks which place was meant when no match is exact (2026-10-17 sync entry).

## 2026-10-20 — Contract pinned; F1 completed for the pipeline's account

The pipeline handed over `API_BASE` and its contract on 2026-10-20. Contract v1 is unchanged. On the new AWS account,
cold property and permit searches time out, so the pipeline is replacing its baked DuckDB file with Parquet served from
its private deploy bucket (its T7 correction). The handoff gives the cold times expected afterwards: about 7 to 8 s for
F1's default search and about 3 s for details. F1's remaining steps are built and checked locally. Its live check waits
for the pipeline's "T7 correction live" notice. Where this entry differs from earlier text, this entry wins.

- **Pin.** `packages/contract/openapi.json` is pinned at pipeline commit `56b020c` (sha256 `7d8ece68…`), byte-identical
  to the served `GET /v1/openapi.json`. The pipeline's later commits do not change the file. `API_BASE` is
  `https://733jzm4xv4.execute-api.us-east-2.amazonaws.com` (`docs/runbook.md`, the operator's `.env`; the CI variable
  is set by the operator).
- **Typed client.** `packages/pipeline-client` adds openapi-fetch 0.17 over the existing transport, with `getMeta`,
  `searchProperties` and `searchCenters` typed by the generated file. The operations return the data with its
  `x-request-id`, and every failure is the transport's `PipelineError`. A type-level test fails to compile if the pinned
  error schemas lose `error` or `request_id`.
- **Transport, for this account** (amends the 2026-10-17 "Transport" bullet):
  - The browser waits 29 s per attempt, not 15 s. That covers a cold search, stays above the pipeline function's 25 s
    limit and stays under API Gateway's 30 s cut.
  - A 503, which can be the account-wide Lambda throttle, is a 5xx and is retried once, as before.
  - A request that fails with no readable response after more than 5 s is retried once like a 5xx. It was admitted and
    then failed, so the 1 s, 2 s, 4 s throttle schedule no longer applies. A fast failure keeps that schedule, because
    it is how a gateway 429 without CORS headers looks.
  - The Lambda timeout (8 s) is not changed in F1; F3 checks it against the measured detail times.
- **No fan-out.** The account runs 10 Lambda executions at once, shared by the pipeline API, the pipeline chat and the
  CRM. The page therefore sends its pipeline calls through one queue (`serializeFetch`), so one call is in flight at a
  time:
  - `/v1/meta` for the footer is read after the first search settles, so the default search goes first.
  - A newer search cancels the older one, and radius, threshold and center changes wait 400 ms for the next change.
  - F3's `createMany` and F5's tool loop follow the same rule. Their bounded concurrency is 1 until the account's
    increase lands.
- **Loading and retry states.** While a search runs, the list shows how many seconds it has taken and, after 3 s, that a
  cold pipeline takes longer. During a back-off, a "Pipeline busy, retrying" notice names the cause and the wait. When
  the query changes, the previous rows stay dimmed until the new answer arrives.
- **GPS inside the map's box but outside the county** (completes the 2026-10-17 GPS bullet). When the search answers
  with an `area_note`, the center goes back to where it was and the notice quotes the note. A pin dropped there keeps
  the pin, and the list shows the note.
- **Place box.** A single exact match moves the center at once. Otherwise each match is listed with its kind,
  `match_type` and parcel count, and the user picks one. Two exact matches also ask. No match says so.
- **Footer.** Shows the run id and the manifest CID. The group CIDs fold into a list: the current run has 177 groups.
  Atlas shows "not published yet" while `atlas` is null.
- **Markers and rows.** The map draws the first page (500). "Load more" appends further pages to the list only, and the
  list says so. A marker click selects its row, a row click highlights its marker, and the selected marker is drawn
  above the clusters.
- **Tests and fixtures.** The web tests stub `fetch` with synthetic records in the contract's shapes: `FIXTURE`
  addresses, `fx-` ids and example.org URLs. No county data enters the repository (§1, §8). A local visual check ran the
  production bundle, under the deployed CSP, against a throwaway fake pipeline in the session scratchpad. That fake is
  not part of the repository.
- **Still open.** Bedrock access on this account was blocked on 2026-10-16. F5 checks it first, as the pipeline's T9
  does.

## 2026-10-20 — Pipeline cold starts (pipeline decisions §31)

The pipeline measured its cold starts and keeps no warm instance, because its README rules out ongoing cost. On an idle
pipeline API the first call takes about 5 s, or 8 to 9 s right after a pipeline deploy or a long idle; later calls take
0.6 to 3 s. Its letter of the same day asks for four things. This entry amends the entry above where they differ.

- **`/v1/meta` first.** The page reads `/v1/meta` as soon as it opens. That call pays the cold start, and the default
  search, queued behind it, lands on the warm instance. This replaces "read after the first search settles".
- **Timeout stays 29 s, and timeouts are not retried.** The letter asks to raise the browser timeout from 15 s to 25 s.
  It was already 29 s, and stays there: above the pipeline function's 25 s limit plus network time, so the browser never
  abandons a request the pipeline is still running, and below API Gateway's 30 s cut. The letter's reasoning still
  changes the retry rules: a request that timed out may still hold its instance, so an immediate retry only starts a
  second cold one. From now on:
  - Not retried automatically: a timeout, and any failure that took longer than 5 s (a 5xx after the function ran, or
    no readable response).
  - Retried once, after under 1 s: a 5xx that came back fast, such as the account-wide throttle's 503.
  - Backed off 1 s, 2 s, then 4 s: a 429, and a fast failure with no readable response.

  This amends metagross item 14 and the transport bullet above. A failed search shows "Try again".
- **Say why it is slow.** After 3 s, a running search or place lookup adds: "The first search (lookup) after a quiet
  period starts the pipeline's data service, which takes up to about 15 seconds." The seconds counter stays.
- **F3 and F5 (recorded now, built with those pieces).** The CRM's own functions call the pipeline as the browser does.
  Each chat turn (F5) and each lead-creation request (F3) first sends `GET /v1/meta`. Each pipeline call's timeout comes
  from what remains of the 25 s handler deadline, up to about 20 s, instead of the fixed 8 s `LAMBDA_TIMEOUT_MS`.
- **Served-contract check.** `check:served`, which CI's second job and `pnpm deploy:aws` both run, now waits 29 s
  instead of 8 s. Its single `GET /v1/openapi.json` often pays the cold start, and since a timeout is no longer retried,
  an 8 s limit would fail CI or stop a deploy after every pipeline deploy.

## 2026-10-20 — The CRM deploys into the pipeline's AWS account

The operator confirmed that the `RoofingCrm` stack goes into the pipeline's account: 561303652468, us-east-2, profile
`cdk-lab`. As before, the operator runs every deploy. Consequences:

- CDK is already bootstrapped there, since the pipeline deploys with CDK in us-east-2. The CRM's resources carry
  `project_name=roofing-crm`, so their cost shows apart from the pipeline's. Stack names do not clash: the pipeline's are
  `TravisApi` and `TravisWeb`.
- The account's quotas apply to the CRM too: 3008 MB per function, and 10 concurrent Lambda executions shared by every
  function in the account (an increase is requested).
- **No reserved concurrency until the increase lands.** AWS keeps a minimum of the account's concurrency unreserved, so
  with 10 in total nothing can be reserved. The pipeline's own decisions record the same finding for its chat function.
  §3 and metagross item 9 give each CRM function (`leads`, `agent`) its own reserved concurrency. In F3 and F5 that waits
  for the increase. Until then the HTTP API's route throttles alone bound the CRM's functions. This leaves the reason for
  the two-function split (a burst of chat turns cannot starve lead writes) only partly met, and the split is kept, so
  reservations can be added once the increase lands.
- F1 adds no long-running function. Its only Lambda is CDK's bucket-deployment helper, which runs during a deploy.
- Bedrock on this account was blocked on 2026-10-16. F5 checks it first. §3 keeps the contingency: the Anthropic provider
  of the same SDK, with its key in Secrets Manager, recorded as a dated deviation.

## 2026-10-20 — Pipeline T7 correction live; `API_BASE` is committed configuration

The pipeline's letter of 2026-10-20 reports its T7 correction live, with T7 and T8 verified by its operator. `API_BASE`
and contract v1 are unchanged: the served `/v1/openapi.json` still hashes to `7d8ece68…`, so the pin stands and F1's live
check can go ahead.

- **`API_BASE` is committed configuration.** It is `apiBase` in `packages/pipeline-client/openapi.pin.json`, next to the
  contract that deployment must serve. CI's served-contract check, `pnpm deploy:aws` and `pnpm dev` read it there, and
  `PIPELINE_API_BASE` in the environment overrides it for one run (a local pipeline, say). It is not a secret, and the
  PR names it anyway. This replaces the operator's `.env` entry and the GitHub repository variable of the entries above:
  CI's second job now runs on every push and PR, forks included, with nothing to set up. The deploy still hands it to
  the stack as CDK context (metagross item 2); only where the script finds it changed.
- **Measured times** (the letter): warm, F1's default search takes 0.3 s in the function and 1.6 to 1.7 s end to end,
  mostly the 500-item response; on an idle API about 3 to 5 s; after a pipeline deploy or a long idle 8 to 9 s. Text
  search is 1 to 1.5 s warm. The pipeline warms three instances after each of its deploys, and before a demo on request;
  the demo video is recorded after asking for that.
- **Timeout stays 29 s.** The letter repeats "25 s per attempt". The cold-start entry above keeps 29 s for the reason it
  gives: the browser outlasts the pipeline function's 25 s limit, so it never abandons a request the pipeline is still
  serving, and never retries a timeout.
- **`GET /v1/properties/by-geo-id/{geo_id}`** now returns the lowest `property_id` when several accounts share a `geo_id`
  (1,160 do); before, the pick was arbitrary. F2's drawer reads properties by `property_id` and is not affected. F5's
  `get_property` tool takes either id, as the pipeline's MCP tool does, so a `geo_id` question now gets the same property
  every time; the agent cites the `property_id` it received.
- **`/v1/agent/chat`** answers `503 agent_unavailable` until the pipeline's T9. The CRM's agent is its own (§6) and calls
  only the pipeline's query endpoints, so this changes nothing here.
- **One pipeline call in flight** stays until the account's concurrency increase lands.

## 2026-10-20 — F2 built: permit signal and property detail

F1 was verified on the public URL on 2026-10-20 (`docs/progress.md`). F2 (README AC 5 and 6) is browser-only: it adds
two pipeline reads to the pinned client and no AWS resource, so it deploys as a web update of the same stack. Where this
entry differs from earlier text, this entry wins.

- **Permit signal on by default** (§4). The search panel's "Open and stalled roofing permits" toggle sends
  `open_permits`, and every search sends `long_open_years=5` explicitly, so the legend and the server use the same
  threshold. The URL carries `permits=1` or `permits=0`; a link without it keeps the default (on). Measured on
  2026-10-20 at the default search: 53,308 matches with the toggle off, 54,173 with it on, and every one of the first 500
  rows has an open roofing permit, longest open first, as the contract's sort says.
- **Emphasis on long-open permits** (AC 5). A marker takes the color of the match's strongest signal: a long-open
  roofing permit (`long_open_roofing_permit`), then an open or stalled one, then an aged roof. Long-open markers are
  drawn above the others, and a cluster takes the strongest color among its members (`clusterProperties` counts). Rows
  show the match reasons with the same colors and the property's roofing permits by group (`roofing_permit_counts`).
- **The drawer** (§7, AC 6). A row or a marker opens its property; `?property=<property_id>` opens it from a link, and
  × or Escape closes it. It reads `GET /v1/properties/{property_id}` through the same one-at-a-time queue. With a
  shared link the order is `/v1/meta`, the property, then the search. It shows:
  - the ids, the distance and match reasons from the row when the property is in the results, and the roof age with
    its basis, confidence, anchor, as-of date, caveats and year built;
  - the permits. The embedded list comes unordered (seen live on 2026-10-20), so the drawer sorts it by the permit
    search's rule (open, stalled, closed, needs review; longest open first; permit id). Roofing permits come first;
    trade and other permits are folded under "Other permits". Each permit shows its status group and printed status,
    open duration (open: since when; stalled: how long it was open and how long ago it expired), roof work class,
    description, dates, how it was linked to the property, and its source and CIDs;
  - the contractor as printed (name, company, trade, phone; empty fields left out), labelled "an attribution, not a
    verified identity", and BBB exactly as reported: "Rating …", "No BBB profile" or "Blocked at source". The
    pipeline's BBB note is shown once per drawer. In the current run every contractor is "Blocked at source";
  - the owner's public roll fields (name, mailing address, deed date, tenure, absentee, out-of-area), in the drawer
    only, with the note that the roll has no owner phone or email;
  - the property's sources: CID-backed fields (`record_cid`, `property_cid`, `data_group_cid`) and source-backed
    fields (`unpublished_source.fields`) are labelled apart, as are the owner's and each permit's;
  - the request id of the property read.
- **More than 50 permits.** "Load more permits" reads `/v1/permits/search?property_id=…` with every status group,
  `roofing_only=false` and `limit=500`, which replaces the embedded list, and pages on through `next_cursor`. A stale
  cursor restarts from the first page. The contract's list parameters are `style: form, explode: false`, so the client
  sends `status_group=open,stalled,closed,needs_review`, not the parameter repeated.
- **Layout.** From 1440 px wide the drawer is a third column between the map and the list. From 901 to 1439 px it lies
  over the map's right side, because a third column would leave the map about 300 px wide at 1280 px. On a phone it
  takes the whole screen until closed.
- **Tests.** Synthetic permits and property details in the contract's shapes join the fixtures (`FX-` permit ids,
  example.org URLs). The app tests cover the toggle and its URL, the drawer's order and fields, a shared link, a
  failed read with its request id and "Try again", and permit paging with the comma-separated list parameters.

## 2026-10-20 — F3 built: save leads

F2 was verified on the public URL on 2026-10-20 (`docs/progress.md`). F3 is the creating half of README AC 8: save one
property or permit as a lead, save several from a multi-selection, and list them on a Leads page that survives a
reload. It adds the stack's first API, table and alarms. Where this entry differs from earlier text, this entry wins.

- **API** (metagross items 3, 9). tRPC 11 on one `leads` NodejsFunction: Node 22, arm64, 1024 MB, 29 s timeout, X-Ray
  active, everything bundled (the AWS SDK included), no reserved concurrency (2026-10-20 account entry). It sits behind
  an HTTP API whose `$default` stage CloudFront reaches under `/api/*`: caching disabled, every viewer header but Host
  forwarded, HTTPS only, since a redirect would turn a POST into a GET. The procedures are `leads.create`,
  `leads.createMany` and `leads.list`. The tRPC Lambda adapter takes the procedure from a `{proxy+}` parameter or else
  from the whole path, so the handler strips `/api/trpc` first. The server refuses batches (`allowBatching: false`), as
  `httpLink` never sends them.
- **Routes and throttles** (item 4, amended). `POST /api/trpc/leads.create` allows 2 requests/s with a burst of 5, and
  `POST /api/trpc/leads.createMany` 0.5/s with a burst of 2. Queries go through `GET /api/trpc/{proxy+}` under the stage
  default of 10/s, burst 20. These are tighter than item 4's example because nothing can be reserved, so the rates
  alone bound the function. The catch-all is GET only, not ANY: a mutation without its own route gets API Gateway's
  404, so F4 adds one route per mutation.
- **Table** (§5, item 22). As decided: on demand, point-in-time recovery, partition key `workspace_id`, sort key
  `lead_key` = `<property_id>#<permit_id>`. An item is the Lead's fields plus those two keys. The table is retained if
  the stack is deleted, because leads are user data. The function may GetItem, PutItem and Query; F4 adds UpdateItem
  and DeleteItem.
- **Create, per row.**
  1. An existing lead comes back at once, with no pipeline call (a consistent read).
  2. Otherwise the function reads `/v1/meta`, once per request and first, then the permit (which embeds its property;
     the property is read separately only when it is not embedded) or the property.
  3. It builds the snapshot and writes it with a conditional put. If another request wrote the lead in between, that
     lead is returned.

  Rows run one after another. A permit whose `property_id` differs from the property named fails as `mismatch`.
- **Snapshot** (§5). Address, coordinates, roof age with its year and basis, roofing permit counts, and one permit:
  its status group and printed status, roof work class, open since, open duration, days since expiry, the contractor
  as printed, and BBB as reported. The run id comes from `/v1/meta`.
  - For a property lead, that permit is the property's longest-open open or stalled roofing permit, in the permit
    search's order, so F4's permit filters also work on rows saved from the list. When the property's embedded list is
    truncated, the permit search with `limit=1` finds it instead.
  - The contractor is the printed name, else the printed company. Seen live: a permit that prints only "Gary Pools".
  - Third-party text is cut to the schema's bounds, never refused. The UI labels the whole record as a snapshot.
- **Time budget.** Each request has 25 s, or the Lambda's remaining time minus 1.5 s if that is less. Each pipeline
  attempt gets the lesser of 20 s and that remainder. A row that would start with under 2.5 s left fails as
  `deadline` without a write, and the browser offers to try the failed rows again.
  - Measured locally against the live pipeline: 6 rows took 6.3 s (7 pipeline calls), so 25 warm rows fit in about
    23 s. On a cold pipeline the last rows may report `deadline`.
- **Errors** (§4). Every answer and every error carries `request_id`, API Gateway's request id, which is also sent as
  `x-request-id`. A failed row adds `pipeline_request_id`. A single create maps its failure to an HTTP status:
  `not_found` 404, `mismatch` 400, `pipeline` 502, `deadline` 504. An unexpected error does not show its own message.
- **Browser.**
  - **Workspace.** The browser keeps a ULID in local storage under `roofing-crm.workspace`. If storage is refused,
    the workspace lasts for that page only, and the Leads page says so.
  - **`@roofing-crm/api-client`.** A vanilla tRPC client with `httpLink`, not React Query hooks (item 6 amended): the
    app's other data hooks are plain React, and the kit's rule allows "React hooks (if using React) or vanilla
    client".
  - **Loading and saving.** Leads are read once when the page opens, up to 10 pages of 200. Saves run one at a time.
  - **Where to save.** Each result row has "Save lead" and a "Select" tick, and a sticky bar offers "Save N as leads"
    (at most 25). The drawer has "Save property as lead", and "Save permit as lead" on each roofing permit.
  - **The save report.** It lists the rows created, those already saved and those that failed, with reasons and both
    request ids, and offers "Try the failed rows again".
  - **The Leads page.** It is at `/leads` (CloudFront's SPA routing serves it), newest first, with "Show on map". The
    map stays mounted while the Leads page shows, so it keeps its view and results.
- **Observability** (items 15, 16).
  - **Logs.** Powertools Logger writes JSON with `request_id` on every line. It logs ids, outcomes, pipeline request
    ids and durations, never a snapshot or a note.
  - **Traces.** Powertools Tracer covers the handler, the DynamoDB client and one subsegment per pipeline call.
  - **Metrics.** Powertools Metrics, namespace `RoofingCrm`, flushed once per request; `docs/metrics.md` lists them.
  - **Retention.** Function and access logs are kept 90 days. The access log records neither the IP address nor the
    user agent.
- **Alarms** (items 18, 19). Five alarms, each with ALARM and OK actions on one SNS topic:
  - function errors, at least 1;
  - function throttles, at least 1;
  - HTTP API 5xx, at least 1 in 5 minutes;
  - DynamoDB system errors on the table, at least 1;
  - `PipelineCallFailed` with status 5xx or timeout, at least 5 in 5 minutes.

  `ChatFailed` arrives with F5. `pnpm deploy:aws` subscribes the email with the AWS CLI, from `ALERT_EMAIL` or a
  prompt the first time, so the address is in neither git nor the template. The channel is email only, as item 19
  allows.
- **Pipeline client.** It gains `getPermit`. `timeoutMs` may now be a function, asked before each attempt.
  `SERVER_TIMEOUT_MAX_MS` (20 s) replaces `LAMBDA_TIMEOUT_MS` (8 s), as the 2026-10-20 cold-start entry asked. The
  permit order (`comparePermits`) moves here from the web app, so the snapshot uses the drawer's rule. The synthetic
  contract fixtures move to `@roofing-crm/pipeline-client/testing`, shared by the web and API tests.
- **Not done, both extras rather than README criteria.**
  - Item 17's CloudWatch dashboard: once the account's three free dashboards are used, another costs about $3 a month.
    `docs/metrics.md` lists every metric and its alarm instead. To be revisited at the PR.
  - Item 21's DynamoDB Local integration test: there is no container runtime on the builder's machine. The repository
    is tested with `aws-sdk-client-mock`. The whole handler was also run locally against the live pipeline, with an
    in-memory table.

## 2026-10-20 — Pipeline T9 letter; the account's Lambda limit is 1,000

The pipeline's letter of 2026-10-20 reports its chat route live (`POST /v1/agent/chat`, Bedrock Sonnet 4.6), with the
contract (`7d8ece68…`) and the GET routes unchanged. For the CRM:

- **Concurrency.** The pipeline now reserves 5 executions for its chat route, so the account's increase has landed.
  The agent read it on 2026-10-20 (`aws lambda get-account-settings`, read-only): limit 1,000, unreserved 995. The
  2026-10-20 account entry deferred the CRM's reservations until then. F4 gives the `leads` function its own
  (F4 entry below), and F5 gives the `agent` function one.
- **Bedrock.** The pipeline's chat runs on Bedrock in this account, so the 2026-10-16 block is gone. F5 still confirms
  the Sonnet inference profile `BEDROCK_MODEL_ID` names before it relies on it.
- **No change for F4.** The CRM's agent (F5) calls the pipeline's GET routes as tools and never its chat, so the chat
  route's limits (0.4 requests/s, burst 5; 200 calls or 5M tokens per UTC day) do not bind it. The new CORS preflight
  answers do not matter either: the browser sends the pipeline plain GETs. The pipeline's measured turn time (7–11 s
  warm, 10–12.5 s cold, 25 s server deadline) is a reference for F5's own 25 s budget.

## 2026-10-20 — F4 built: manage leads

F3 was verified on the public URL on 2026-10-20 (`docs/progress.md`). F4 is the managing half of README AC 8 and the
demo step "filtering leads by roof age, permit status/open duration, and location radius" (§5). It adds two routes, two
table permissions and a reserved concurrency; nothing new reads the pipeline. Where this entry differs from earlier
text, this entry wins.

- **`leads.update`.** It sets the status, the note, or both (at least one is required), plus `updated_at`. The snapshot
  and the keys never change. The update is conditional on the lead existing, so editing a deleted lead writes nothing
  and answers `NOT_FOUND`. Last write wins: a workspace is one browser, so there is no version check.
- **`leads.delete`.** It deletes and answers `deleted`, or `missing` when the lead is gone already. That is an answer,
  not an error, so a retried delete is harmless.
- **Routes.** Each mutation has its own POST route: `leads.update` and `leads.delete` allow 2 requests/s with a burst
  of 5, as `leads.create` does. The function may also UpdateItem and DeleteItem, and the `TableSystemErrors` alarm
  covers both operations.
- **Filters** (§5). `leads.list` takes an optional `filter`. Every field is optional, and a field left out does not
  filter.
  - `statuses`.
  - `roof_age_min`: strict, `roof_age_years > n`, as on the map.
  - `permit_groups`: the snapshot permit's status group, or `none` for a lead without one.
  - `open_years_min`: `open_duration_days >= n × 365`, the contract's `long_open_years` rule, open or stalled.
  - `within`: great-circle miles around a point, inside the map's radius bounds; the browser sends the map's pin.

  An empty list matches no lead. The filters read the snapshot, so a lead matches as it was when saved; the page says
  so. One predicate, `matchesLeadFilter` in `packages/shared`, decides. The `leads` function applies it, as the
  metagross entry decided. The browser uses it only to mark an edited lead the filters no longer keep, and F5's
  `list_leads` can reuse it.
- **Filtered paging.** The function filters in code, not with a DynamoDB `FilterExpression`. The reads cost the same,
  and the browser's predicate stays the one the server uses.
  - A page reads Query pages until it holds `limit` matches.
  - One request reads at most 2,000 leads; past that it answers with a cursor.
  - The cursor is the stored sort key of the last lead read.
- **Reserved concurrency.** The `leads` function reserves 10 executions (§3, metagross item 9; letter entry above).
  That covers the route throttles' worst case: two 25 s `createMany` calls plus creates, edits and lists. It is also
  the bulkhead that keeps F5's chat from starving lead writes. `FunctionThrottles` now means the function hit its
  reservation.
- **Logs and metrics** (items 15, 16).
  - "leads listed" logs the filter's fields, `returned`, `scanned` and `has_more`. The radius's point is left out,
    since it may be a GPS fix.
  - "lead updated" logs the fields changed, the new status and the note's length, never the note.
  - Deletes log "lead deleted", or "lead not deleted" with outcome `missing`.
  - `LeadProcessed` gains `operation` = `update` and `delete`; `ProcessingDuration` gains both operations.
- **Browser.**
  - **Editing a card.** The status is a select that saves on change. "Add a note" or "Edit note" opens a text area
    (at most 2,000 characters) with Save and Cancel.
  - **Deleting.** "Delete…" asks "Delete this lead and its note?" with Delete and Keep. Each action shows its outcome
    with the CRM request id. A delete is reported above the list, since its card is gone, and the map's row offers
    "Save lead" again.
  - **Queues.** Edits and deletes run one at a time in their own queue, so a 25-row save does not hold them up.
  - **A lead deleted elsewhere.** When an edit finds the lead gone (another tab), the card leaves the list and the
    page says why. `@roofing-crm/api-client` now carries the tRPC `code`, so only the function's own `NOT_FOUND`
    drops a card, never API Gateway's 404 for a missing route.
- **Filter bar.**
  - **Fields.** Status and Permit tick boxes (all ticked filters nothing), "Roof older than" and "Permit open at least"
    in years (empty filters nothing), and "Near the map's pin" with miles. The miles default to the map's radius.
  - **State.** The filters live in the app, so they survive a visit to the map. The list is filtered only while the
    Leads page shows.
  - **Reads.** A change reads the list again after 300 ms. The previous answer stays, dimmed, until the next one
    arrives.
  - **Summary.** The page shows "N of M leads match the filters" with the read's request id. An edited lead that no
    longer matches stays, marked, until the filters change.
- **Tests.** The shared predicate is tested at every field's boundary, and the repository's update, delete and paging
  with `aws-sdk-client-mock`. Service and handler tests cover the routes end to end, the log lines included, and the
  stack tests the routes, throttles, grants, alarm and reservation. App tests cover editing, delete with its
  confirmation, each filter through the function's call, an edited lead the filters no longer keep, and a lead
  deleted elsewhere.
- **Not done, both extras.** The filters are not in the URL, so a reload clears them. The order stays newest first.

## 2026-10-21 — F5 built: ask in natural language

F4 was verified on the public URL on 2026-10-20 (`docs/progress.md`). F5 is README AC 9 and the demo step "Ask the RAG
agent a natural-language query for roofing opportunities in the area and show relevant results": `pidgeot-agent` (§6,
the alakazam entries) behind the Assistant page. It also builds item 17's dashboard. Where this entry differs from
earlier text, this entry wins.

- **Model: Claude Sonnet 4.6.** It runs by the US inference profile `us.anthropic.claude-sonnet-4-6`, through
  `@ai-sdk/amazon-bedrock`. This replaces the metagross entry's default `us.anthropic.claude-sonnet-5-5`, because the
  account denies every Claude model from Opus 4.7 and Sonnet 5 on (pipeline progress, T9). The pipeline's agent runs the
  same profile and measured 7 to 12 s a turn. The CDK context `bedrockModelId` changes it without a code change.
- **Runtime** (§3, the metagross entry).
  - **Its own function.** A second NodejsFunction, `agent`: Node 22, arm64, 1,024 MB, 29 s, X-Ray, reserved
    concurrency 5. It sits behind its own route, `POST /api/trpc/agent.chat`, at 0.5 requests/s with a burst of 3.
  - **One router.** `agent.chat` is a tRPC mutation on the router the leads function serves. The agent reaches the
    router only through the request context, so the `leads` bundle (1.2 MB) carries no AI SDK and the `agent` bundle is
    2.2 MB.
  - **IAM.** Bedrock `InvokeModel` on the profile and on its foundation model in us-east-1, us-east-2 and us-west-2.
    `GetSecretValue` on the LangSmith secret only. On the leads table, GetItem, PutItem, Query and UpdateItem; no
    DeleteItem.
- **The turn** (metagross item 13; alakazam items 13 and 14, as in the pipeline agent).
  - A `ToolLoopAgent` on the model wrapped with the kit's Bedrock prompt caching.
  - At most 6 steps, 700 output tokens a step and 1,500 a turn.
  - A 25 s deadline counted from API Gateway's receipt, so a cold start is inside it. One retry, only on throttling or
    a 5xx. A circuit breaker pauses chat for 30 s after 3 failed turns.
  - `/v1/meta` is read first and takes the pipeline's cold start.
  - The deadline or the output budget ends the turn as `limit_reached`, with the evidence found so far.
- **Tools** (alakazam items 18, 19 and 22; the 2026-10-17 entry). They have the frozen MCP registry's descriptions
  and bounds (`limit` 20, at most 50; `open_permits` required).
  - **Eight over the pipeline API.** `resolve_search_center`, `search_properties`, `search_permits`,
    `search_permit_text`, `get_property`, `get_permit`, `get_contractor` and `get_run_summary`. They use the typed
    client: one call at a time, inside the deadline, and a failure comes back as a result with the pipeline request id.
    `get_property` shows the model 20 permits, roofing first in the permit search's order. `get_run_summary` returns the
    `/v1/meta` read at the start of the turn.
  - **`list_leads`.** It takes the Leads page's filter (F4) and applies it through `leads.list`.
  - **`create_lead`.** It saves through `leads.create`, so it takes the same snapshot. The server refuses it unless the
    latest message asks to save leads (a verb of saving and the word "lead"), unless every id came from a tool result in
    this turn, and after 5 saves in one turn.
  - **The search-center rule.** A search's point must be a search center returned in this turn, the map's pin the page
    sent (new: `map_center` in the request), or numbers the user typed.
- **Grounding** (alakazam items 8 and 17).
  - The server builds the evidence from tool results.
  - The answer and the model's assumption lines are sanitized: no HTML, images, links or bold. Every `[[kind:id]]`
    token, bare permit number, contractor key, "property <id>" mention and CID must be one a tool returned in this turn.
    Otherwise the response carries no model text and the outcome `tool_error`.
  - `answered` and `no_matches` require a successful tool call.
  - The server adds assumptions (the center used, the identity rule, the durations' date, the snapshot rule for
    leads) and the limitations from `/v1/meta`.
  - Responses take the pipeline chat's shape, plus `center_used` and `leads_created`.
- **Personal data** (alakazam item 9).
  - **To the model.** The owner's name and mailing address never reach it. Tenure, absentee and out-of-area do, and so
    do the contractor fields printed on the permit. A lead's note never does.
  - **Logs.** They hold ids, counts, timings and hashes of free text, never the question or the answer.
  - **LangSmith.** The traces hold the question and the answer. The earlier messages reach them only as hashes.
- **Daily budget** (§3).
  - **Caps.** At most 200 turns and 2,000,000 model tokens per UTC day, counted in one item of the leads table (partition
    `#agent-usage`, which no ULID workspace matches). Past either cap, chat answers 503 `budget_exhausted` until 00:00
    UTC.
  - **Alarms.** `ChatDailyTokens` fires at 1.5 million tokens in a day. `ChatFailed` fires at 3 turns without an
    answer in 5 minutes. `AgentErrors` and `AgentThrottles` watch the function.
  - **Bound.** Together with the route throttle and the reservation, this bounds a public endpoint at about $10 of
    Bedrock a day.
- **LangSmith** (alakazam item 15; 2026-10-16 entry).
  - **The secret.** `pnpm deploy:aws` reads only `LANGSMITH_API_KEY` from `.env`. It writes it to the secret
    `pidgeot-agent/langsmith-api-key` through a file only this user can read, so it is never in argv. It writes a new
    version only when the key changed.
  - **The function.** CDK grants the function that secret and sets `LANGSMITH_API_KEY_SECRET_ID` (the runbook's
    planned `…_SECRET_ARN` becomes the name) and `LANGSMITH_PROJECT=pidgeot-agent`.
  - **Degrading.** Without a key the stack sets `LANGSMITH_TRACING=false`. An unreadable secret gives the plain AI SDK.
    Traces are flushed inside the deadline.
- **Memory** (alakazam item 11). None on the server: the page holds the conversation and sends it whole, within the
  pipeline chat's bounds (20 messages, 4,000 characters each, 16,000 in all). Over the bounds is 400, never truncated;
  the page drops the oldest exchanges to stay inside them.
- **The Assistant page** (`/assistant`; §7's chat panel).
  - **Asking.** Example questions, the README's first. The map's pin is sent with every question for "around here".
  - **The answer.** It is plain text with a chip per cited id. A property or permit chip opens the property in the drawer
    on the map.
  - **Under each answer.** The outcome and the center used, the assumptions, the records found with their source
    links and CIDs, the limitations, the tool calls with their parameters, and the request id, model and run.
  - **Leads.** A turn that saved leads makes the Leads store read them again. The conversation survives a visit to the
    map.
- **Dashboard** (item 17, built). It shows both functions, the HTTP API, leads, pipeline calls, chat turns by outcome,
  failures and refusals, tokens and latency, Bedrock invocations and tokens, and every alarm. It has 48 metrics. It is
  the account's third dashboard, inside the free tier of 3 dashboards of 50 metrics; the stack test keeps it at 50 or
  fewer. The F3 entry's reason for deferring it no longer holds.
- **Golden set** (alakazam item 7). `fixtures/agent/golden.json` holds 10 cases and is committed: questions and
  expected tool calls, parameters, outcomes and the miss and save rules, never prose.
  - **The cases.** The README question (`search_permits` with `min_open_years` 5, never `roof_age_min`), aged roofs
    around the pin, permit text, county-wide owner tenure, out of county, off topic, no save without an ask, save on
    ask, the user's leads, and a contractor with its BBB status.
  - **The runner.** `pnpm agent:golden` runs it in-process against the live pipeline and Bedrock, and
    `pnpm agent:golden --url <WebUrl>` against the deployed agent. Results go to the git-ignored `fixtures/agent/results/`.
  - **Before the deploy.** On 2026-10-20, in-process: 10 of 10, p50 7.2 s, slowest 18.7 s (the save case, which reads
    two snapshots).
- **Dependencies.** `ai` 7.0.139, `@ai-sdk/amazon-bedrock` 5.0.115 and `langsmith` 0.10.13: the newest that pass the
  repository's 7-day release-age guard (`minimumReleaseAge`). The pipeline runs 7.0.146, 5.0.120 and 0.11.0.
- **Not done.**
  - **SAM local** (alakazam item 5). There is no container runtime on the builder's machine, as for F3's DynamoDB Local.
    The handler is run in-process by the golden runner and the tests instead.
  - **The recorded-fixture adapter** (item 6). Recorded pipeline answers would be a committed copy of county data
    (§1, §8). The golden set replays live instead, before and after the deploy.
  - **A semantic retrieval leg and contractor search by name.** These stay as recorded on 2026-10-16.
  - **Streaming.** Not built: answers arrive whole, in 7 to 19 s.

## 2026-10-21 — After the alakazam F5 review (`docs/reviews/2026-10-21-alakazam-f5.md`)

The kit's `alakazam` agent reviewed the built agent, read-only: 26 findings, no blocker. The agent checked each finding
against the code. Fixed before the operator's live check:

- **Logged causes (#1).** A failed model call logs its cause (`model_error`: name, HTTP status, message) on the "chat
  turn" line, with the first citation-check reasons.
- **A clear miss (#2).** A 404 on `get_property`, `get_permit` or `get_contractor` is a successful "not found" result
  (`found: false`), so an id outside the dataset ends as `no_matches`. The answer may name that id bare, never as a
  citation token.
- **Contractor names (#3).** The prompt says a question naming a contractor or company is not supported yet (outcome
  `out_of_scope`), as decided on 2026-10-16, and offers an area search.
- **The ask to save (#4).** The rule reads the conversation:
  - a verb of saving pointing at leads or at the results ("save the first two", "add them to my leads");
  - not negated ("don't save" refuses);
  - or a "yes" to the assistant's own offer to save.
- **One call at a time (#5).** The tool calls of a turn run one at a time, in the order made. The AI SDK runs a step's
  calls together, which let parallel saves pass the cap of 5 and send the pipeline several calls at once.
- **No point in the logs (#6).** The "chat tool call" line never logs a point (`lat`, `lon`, `within`'s point). The
  traces replace the map pin's coordinates with "[map pin]", since the pin may be a GPS fix.
- **Smaller fixes:**
  - the current run is citable from the start of the turn (#7);
  - typed coordinates accept a Unicode minus, N/S/E/W and the model's rounding (#8);
  - an earlier message is hashed inside longer trace text only from 40 characters (#9);
  - the pin is its own system message, after the cached run prompt (#10);
  - a non-pipeline error inside a tool is recorded and returned, never thrown (#12);
  - a deadline cut counts against Bedrock only when the model step started with 10 s or more (#13);
  - the center assumption says "(those with coordinates)" (#15);
  - the model takes the AWS SDK's credential chain, so `pnpm agent:golden` works with `AWS_PROFILE` alone (#19);
  - the agent's DynamoDB client has 1 s and 2 s timeouts and 2 attempts (#20).
- **Tests (#11, #18).** Unit tests for the save rule, the citation check, typed coordinates, the sanitizer, the trace
  hiding, the log parameters, the prompt cache and the breaker; turn tests for parallel saves, a missing id and a logged
  model error. The golden set gains a follow-up save, a contractor name and a missing permit: 13 cases, 13 of 13 in-process
  on 2026-10-21.

Accepted as they stand, recorded here:

- **#14.** The daily count misses a step the deadline aborts, a turn that throws after a model call, and up to 5
  concurrent turns past the check. It counts cache reads in full, so it errs high, and the bound holds.
- **#16.** `get_property` takes `property_id` only; a `geo_id` lookup was not built.
- **#17.** A saving turn reads `/v1/meta` twice (the turn, then the lead service): one fast call.
- **#18, the rest.** An ambiguous-place case is not in the golden set. The workspace boundary is tested by the handler
  tests.
- **#21.** SAM local stays undone: there is no container runtime. The live replays stand instead: 10 of 10 against the
  URL on 2026-10-21 (before these fixes) and 13 of 13 in-process after them.
- **#22.** The F5 entry's reason is corrected. The 2026-10-16 entry planned recorded pipeline answers in a git-ignored
  folder. They were not built, for time; the live replay replaces them.
- **#23.** Item 11's `ConversationEventStore` interface was not built: with no login and client-held history it would
  be dead code.
- **#24, the layout half.** One flat `agent/` module mirrors the pipeline's `chat/`, which item 23 asked for. The
  agent's environment is read without a Zod schema; recorded.
- **#25.** The `ToolLoopAgent` is built per turn, because its tools close over the turn. The model and the tracing
  facade are built once per instance.
- **#26.** The response is a TypeScript interface, not a Zod schema; the web tests and the golden runner read it as typed.
