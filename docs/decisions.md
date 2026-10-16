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
