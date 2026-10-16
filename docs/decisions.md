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
