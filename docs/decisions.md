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
