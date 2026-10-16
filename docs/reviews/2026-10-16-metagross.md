# Metagross kit-conformance review, 2026-10-16 — hosting, monorepo, API layer, infrastructure, increments

Read-only review of `docs/decisions.md` by the kit's `metagross` agent (fullstack monorepo architect) before any
code exists. `README.md` is the assignment's problem statement and was not edited or questioned; where a kit rule
and the README would conflict, the README wins. `docs/decisions.md` was not edited either: accepted findings enter
it as dated entries that link this file, rejected ones stay here (per its 2026-10-16 entry).

**Status:** proposed, not applied. **Summary:** 28 items — 20 Fix, 0 README override, 3 Justified deviation,
5 Not applicable. Nothing in the plan contradicts the README; every deviation found is README-silent.

## Scope and method

- Reviewed: `README.md` (spec), `docs/decisions.md` in full, including the dated entry at the end (working-tree
  version of 2026-10-16: commit `c25a6ce` plus the uncommitted dated entry; line numbers below refer to that
  version), and, for context, the pipeline repository's `docs/api-contract.md` (v1 after its oracle review) and
  `docs/decisions.md` §8 (the hosted layer the CRM mirrors).
- Checked against the kit the plugin installs (`soofi-xyz-team-kit` v0.99.1, commit `99c7bff`):
  `skills/apply-engineering-guidelines/SKILL.md` and all ten `rules/*.md`;
  `skills/build-frontend-backends/SKILL.md` and its five `rules/*.md`;
  `skills/guide-product-work/SKILL.md`, `reference/aws-inspection.md`, `reference/shared-api-domain.md`,
  `reference/product-catalog.json`, and `skills/build-product-deployer/reference/stack-identity.md` (which
  `guide-product-work` loads for deployment identity); `agents/metagross.md`. Kit paths below are relative to the
  kit root.
- Constraints respected: no code, no scaffold, no AWS or remote commands, no ssh, no commits, no edits outside this
  file. The three `evaluate-candidate-*` skills §2 names were confirmed to exist in v0.99.1.
- Left to the parallel `alakazam` review (`2026-10-16-alakazam.md`): the §3 Agent bullet and §6. Cross-cutting
  points are listed in their own section; the two asides alakazam addressed to this review are answered under
  "Open questions".
- Classes: **Fix** = a kit rule applies and the README is silent; **README override** = README text requires the
  deviation (both quoted); **Justified deviation** = README silent, the plan's reason is sound (stated);
  **Not applicable** = the rule targets something this repository is not.

## Findings, one line per item

Each row carries the proposed wording for a dated `decisions.md` entry. Ordered by skill: `build-frontend-backends`
(1–9), `apply-engineering-guidelines` (10–22), `guide-product-work` (23–28).

| # | § (decisions.md) | Skill / rule file | Class | Proposed wording for a dated decisions.md entry |
| --- | --- | --- | --- | --- |
| 1 | §3 l. 26-28 (frontend hosting) | `build-frontend-backends/SKILL.md` "Architecture Overview", "Phase 4"; `rules/amplify-frontend.md` (HIGH) | Justified deviation | 2026-10-16 — Frontend hosting. The web app is served from S3 behind CloudFront by the same CDK stack as the API, not from an AWS Amplify app as `build-frontend-backends` describes. Reasons: (1) §10 requires a redeploy from a clean clone, and one `cdk deploy` reproduces the whole runtime, whereas Amplify needs a GitHub connection to `prismteam-ai/roofing-crm` (an organization-level GitHub App install the candidate does not control) or a long-lived GitHub token in Secrets Manager, plus console-held environment variables outside CDK; (2) the basemap tiles (item 11) and the SPA share one bucket and one distribution, which Amplify cannot host; (3) the API can be same-origin behind the same distribution (item 2), removing CORS and build-time API URLs; (4) the sibling pipeline explorer is hosted the same way, so one runbook pattern serves both repositories; (5) Amplify is not among the skill's five non-negotiables (TypeScript, Turborepo, shared packages, tRPC, CDK), all of which are kept. Both options are AWS-native at near-zero standing cost. If a reviewer prefers literal conformance, switching is an `amplify.yml` plus a CDK `CfnApp` with the GitHub token; recorded so the choice is explicit rather than silent. |
| 2 | §3 l. 26-31, §10 (`API_BASE`) | `rules/amplify-frontend.md` "Environment Variables" (no hardcoded URLs); `rules/cdk-api-infrastructure.md` (CORS template); `agents/metagross.md` steps 5-6 | Fix | 2026-10-16 — Web and API coordination. One CloudFront distribution: default behaviour to the S3 bucket (origin access control, SPA fallback 403/404 → `/index.html` 200, hashed assets immutable, `index.html` and `config.json` no-cache, a security-headers response policy) and an `/api/*` behaviour to the HTTP API origin (caching disabled, all viewer headers except Host forwarded). The CRM API is therefore same-origin: no CORS, no API URL in the bundle. The pipeline `API_BASE` is the single environment input, passed once as CDK context (`-c pipelineApiBase=...`, documented in `.env.example` and the runbook) and written by the stack both into `config.json` in the bucket (read by the SPA at start) and into the Lambda environment. Nothing is hardcoded. Alternative if the builder prefers the kit's literal mechanism: `VITE_API_URL` and `VITE_PIPELINE_API_BASE` at build time with CORS restricted to the distribution domain. |
| 3 | §3 l. 29-31 ("HTTP API: leads CRUD ... and `/agent/chat`") | `build-frontend-backends/SKILL.md` non-negotiable 4, "Phase 2"; `rules/trpc-backend.md` (CRITICAL) | Fix | 2026-10-16 — API layer. The CRM API is tRPC, not ad-hoc REST routes: `@trpc/server` v11 with `awsLambdaRequestHandler` (API Gateway payload v2), routers by domain (`leads`: `create`, `createMany`, `list`, `update`, `delete`; `agent`: `chat`), Zod on every input, Powertools logger/tracer/metrics, the DynamoDB document client, the pipeline client and the API Gateway request id in `createContext`, `AppRouter` exported to `packages/api-client`, an `errorFormatter` that puts `requestId` in `error.data` so the §4 error state can show it. `agent.chat` keeps the pipeline contract's response shape (`answer`, `tool_calls`, `evidence`, `limitations`) so the two agents read alike. The §3 paths `/agent/chat` and the lead routes become procedures under `/api/trpc`. |
| 4 | §3 l. 37-38 (route throttles on `/agent/chat` and lead writes) | `rules/trpc-backend.md`; `rules/cdk-api-infrastructure.md` (HTTP API v2 routes) | Fix | 2026-10-16 — Route throttles under tRPC. The client uses `httpLink` (no batching) so every procedure keeps its own path; the HTTP API defines explicit routes `POST /api/trpc/agent.chat` (1 request/s, burst 3), `POST /api/trpc/leads.create`, `leads.createMany`, `leads.update`, `leads.delete` (write throttle, for example 5 request/s, burst 10) and a catch-all `ANY /api/trpc/{proxy+}` for queries, with the stage default throttle (for example 20 request/s, burst 40) shared by all clients, all as `RouteSettings` on the `$default` stage in CDK. Batching is the kit's example, not a rule; it is given up because a batched request would bypass the per-procedure throttles. |
| 5 | §3, §8 (no repository layout stated) | `build-frontend-backends/SKILL.md` non-negotiable 2, "Repository Layout"; `rules/monorepo-turborepo.md` (CRITICAL) | Fix | 2026-10-16 — Repository layout. pnpm workspaces plus Turborepo: `apps/web` (React + Vite + MapLibre), `apps/api` (tRPC Lambda with `cdk/` inside it), `packages/api-client`, `packages/pipeline-client`, `packages/shared`, `packages/tsconfig`; `pnpm-workspace.yaml`, `turbo.json` (`build` depends on `^build`; `lint`, `typecheck`, `test` depend on `^build`; `dev` persistent, uncached), `workspace:*` for internal dependencies, `packageManager` pinned, root scripts `turbo run build lint test typecheck`. Every source file is `.ts` or `.tsx`. The tree is in `docs/reviews/2026-10-16-metagross.md`, appendix. |
| 6 | §3 l. 30 ("a typed client of API v1") | `build-frontend-backends/SKILL.md` non-negotiable 3, "Phase 3"; `rules/shared-packages.md` (CRITICAL) | Fix | 2026-10-16 — Shared packages. `packages/api-client`: `createTRPCReact<AppRouter>()`, `httpLink`, the `AppRouter` type, React Query defaults (`retry: 0` for mutations and for pipeline-backed queries, so retries happen in one place). `packages/pipeline-client`: the typed client of pipeline API v1, used by `apps/web` (search, detail, meta, search centers) and by `apps/api` (agent tools), so the 429 backoff, timeouts and types exist once. `packages/shared`: lead Zod schemas (also the tRPC inputs), the status enum (`new`, `working`, `closed`), defaults (Austin center, radius 5 within 0.1–25, age 15, long-open 5), formatters for roof-age basis and open duration, the disabled-section list. `packages/tsconfig`: `base.json`, `react.json`, `node.json`. |
| 7 | §3 l. 29-31, §7 (who calls the pipeline is implicit) | `rules/shared-packages.md` ("Does more than one app need this?"); `apply-engineering-guidelines/rules/external-dependency-boundaries.md`; `agents/metagross.md` step 6 | Fix | 2026-10-16 — Who calls the pipeline. The browser calls pipeline API v1 directly for `/v1/meta`, `/v1/search-centers`, `/v1/properties/search`, `/v1/properties/{id}`, `/v1/permits/search`, `/v1/permits/{id}` and `/v1/contractors/{key}` (the contract serves CORS `*` for this); the CRM Lambda calls the pipeline only from the agent's tools; the CRM API never proxies pipeline reads and never stores pipeline rows except the labelled lead `snapshot`. Both callers use `packages/pipeline-client`. Consequence for throttles: browser traffic from all users and the agent's tool calls share the pipeline's 20 request/s stage limit, which is why the UI shows a "pipeline busy, retrying" state on 429 instead of failing. |
| 8 | §7 l. 97 (`/v1/places`), §6 l. 82 (`resolve_place`) | pipeline `api-contract.md` "Change control" (names renamed 2026-10-16 after the oracle review); `rules/shared-packages.md` (one typed client) | Fix | 2026-10-16 — Contract names. `/v1/places` → `/v1/search-centers` and `resolve_place` → `resolve_search_center`, as renamed in the pipeline contract on 2026-10-16; the CRM uses only names that appear in `api-contract.md` v1, and they live in `packages/pipeline-client` alone. CI compares the client's operation list with the served `GET /v1/openapi.json` when `API_BASE` is set, so a contract drift fails the build rather than the demo. (Also raised as item 18 of the alakazam review.) |
| 9 | §3 l. 29-31, 37-39 (Lambda and stack details) | `rules/cdk-api-infrastructure.md` "Key Requirements"; `apply-engineering-guidelines/rules/stack-typescript-for-apis.md` (esbuild) | Fix | 2026-10-16 — CDK shape. `apps/api/cdk/` per the kit: `bin/app.ts` and `lib/roofing-crm-stack.ts` composed of `api.ts` (HTTP API, routes, throttles, Lambda), `web-hosting.ts` (bucket, distribution, `BucketDeployment` of `apps/web/dist`, `config.json`, PMTiles) and `observability.ts` (log groups, alarms, topic, dashboard). The Lambda is a `NodejsFunction` (esbuild, `minify`, `sourceMap`, `NODE_OPTIONS=--enable-source-maps`, `target: node22`), `NODEJS_22_X`, `tracing: ACTIVE`, 1024 MB, timeout 29 s (item 13), reserved concurrency, Powertools environment variables (`POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_METRICS_NAMESPACE`, `POWERTOOLS_LOG_LEVEL`), IAM scoped to the table and its index, the Bedrock inference-profile and foundation-model ARNs and, in the contingency, the exact secret ARN. The deploy script runs `turbo run build` first so `apps/web/dist` exists at synth. |
| 10 | §3 (no cost tag) | `apply-engineering-guidelines/rules/cloud-aws-primary.md` "Tag all resources with `project_name`"; `rules/cdk-api-infrastructure.md` "Tags" | Fix | 2026-10-16 — Cost tag. The stack is created with `tags: { project_name: 'roofing-crm' }` so every resource carries it; the §10 monthly-cost table is read from that tag in Cost Explorer. |
| 11 | §3 l. 26-27 (CARTO tiles or PMTiles) | `apply-engineering-guidelines/rules/cloud-aws-primary.md` "AWS-first. Adopt third-party only when AWS cannot meet requirements" | Fix | 2026-10-16 — Basemap. Default: a Protomaps PMTiles extract of the Travis County bounding box (tens of MB) uploaded to the web bucket and served by the same CloudFront distribution (HTTP Range requests, same origin, no key, OSM and Protomaps attribution in the map corner), rendered by MapLibre through the `pmtiles` protocol. CARTO raster tiles are the recorded fallback only if the extract cannot be produced inside F1, because they are a third-party runtime dependency without an SLA for a URL that must stay up after submission. Amazon Location Service was considered and rejected: it needs a browser-held API key (§3 excludes browser-held keys) and bills per tile. |
| 12 | §3 l. 40 ("the chat call is synchronous because the user waits") | `apply-engineering-guidelines/SKILL.md` non-negotiable 8; `rules/external-dependency-boundaries.md` (queued default; sync exception; 5 s default timeout) | Justified deviation | 2026-10-16 — Synchronous chat. The Bedrock call is synchronous and its timeout exceeds the rule's 5 s default. Basis: the README asks for an interactive natural-language query ("Users should also be able to query the platform in natural language through a RAG-backed agent"; demo step "Ask the RAG agent a natural-language query for roofing opportunities in the area and show relevant results"), which is the rule's own exception: the caller waits for the payload; volume is bounded by the `agent.chat` route throttle (1 request/s, burst 3), the reserved concurrency (the bulkhead) and the per-request output cap; timeout and recovery are documented in item 13; failures surface to the user with the request id. A queue plus polling was considered and rejected: it adds a second deployment surface for a demo while an LLM tool loop still cannot answer in 5 s. Revisit if streaming or long tasks are ever needed. |
| 13 | §3 l. 40-41 ("a 30-second timeout and two retries with backoff") | `rules/external-dependency-boundaries.md` §2 (documented timeout and recovery); `rules/cdk-api-infrastructure.md` (HTTP API) | Fix | 2026-10-16 — Chat time budget. API Gateway HTTP APIs cap the integration at 30 s and CloudFront waits at most 30–60 s, so "a 30-second timeout and two retries" cannot complete; replaced by: handler deadline 25 s (Lambda timeout 29 s), one `AbortSignal` passed to every model call and every pipeline call, per-model-call timeout 15 s, at most one retry and only on 429/5xx/timeout within the remaining budget (the 1 s, 2 s, 4 s pipeline backoff also counts against it), tool steps bounded, and on budget exhaustion a partial answer that reports the tool results gathered so far and says the time ran out (the recovery behaviour). The browser never retries `agent.chat`. Alakazam owns the loop internals (its item 13); this entry fixes the envelope. |
| 14 | §3 l. 30-31 (backoff documented, no timeout) | `rules/external-dependency-boundaries.md` §2 (strict client timeout; never retry non-retriable errors) | Fix | 2026-10-16 — Pipeline client behaviour. Every pipeline call carries a timeout: 15 s in the browser, 8 s in the Lambda (the pipeline's first request after idle can take several seconds, its `decisions.md` §5), both overridable by the caller's `AbortSignal`; 429 backs off 1 s, 2 s, 4 s then fails, as the contract specifies (`Retry-After` may be absent); 5xx and timeouts retry once with jitter; 400 and 404 are never retried; every failure returns the pipeline `request_id` when present. The deviation from the 5 s default on the Lambda path is recorded because of the pipeline's cold start. |
| 15 | §3 l. 37, §8 l. 107 (Powertools named; retention, tracing detail and PII rules absent) | `apply-engineering-guidelines/rules/observability-logging-tracing.md` (90-day retention, active tracing, never log PII); `SKILL.md` non-negotiable 5 | Fix | 2026-10-16 — Logging and tracing. Every log group (Lambda, HTTP API access log) has 90-day retention set in CDK; `tracing: ACTIVE`; `tracer.captureAWSv3Client` on the DynamoDB and Bedrock clients and a subsegment around each pipeline call (fetch is not auto-captured); `POWERTOOLS_LOGGER_LOG_EVENT` stays false; the API Gateway `requestId` is appended to every log line and returned in every tRPC error, which is the correlation id the §4 error state shows and the inspection step (item 27) queries. Never logged: lead `note`, `snapshot` contents, owner fields, chat message text. Logged instead: `lead_id`, property and permit ids, status, tool names, token counts, durations. |
| 16 | §3 l. 37 ("metrics" without names) | `apply-engineering-guidelines/rules/observability-metrics.md` "Required Metrics Per Service" | Fix | 2026-10-16 — Business metrics. Powertools Metrics, namespace `RoofingCrm`, service `roofing-crm-api`: `LeadProcessed` and `LeadFailed` (dimension `operation`: create, update, delete), `ChatProcessed` and `ChatFailed` (dimension `reason` on failure: model, budget, tool), `PipelineCallProcessed` and `PipelineCallFailed` (dimension `status`: 429, 5xx, timeout), `ProcessingDuration` in milliseconds (dimension `operation`), flushed once per invocation; no raw CloudWatch SDK calls. |
| 17 | §3 (metric registration) | `rules/observability-metrics.md` "Non-Negotiable: Lexicon Registration + Dashboard"; `SKILL.md` non-negotiable 6 | Not applicable | 2026-10-16 — Metric registration. The kit requires every metric in `Spring-Oaks-Capital-LLC/lexicon` (`cloudwatch-metrics.json`) and on `Spring-Oaks-Capital-LLC/main-dashboard`; both belong to the SOCAPITAL estate and a candidate repository has no write access, so the rule does not reach this repository. Its purpose is met locally: a `cloudwatch.Dashboard` in the same stack with one widget per metric in item 16 plus Lambda errors, duration and throttles, HTTP API 4xx/5xx, DynamoDB errors and Bedrock invocations and tokens; `docs/metrics.md` lists every metric with unit and dimensions and changes in the same PR as the code. |
| 18 | §3 l. 38-41 (only the daily chat-usage alarm is named) | `apply-engineering-guidelines/rules/observability-pagerduty-alerting.md` "What counts as critical"; `SKILL.md` non-negotiable 7 | Fix | 2026-10-16 — Alarm set. Besides the daily chat-usage alarm: Lambda `Errors` > 0 and `Throttles` > 0 (5 min), HTTP API `5xx` > 0 (5 min), DynamoDB `SystemErrors` > 0, `PipelineCallFailed` with status 5xx or timeout ≥ 5 in 5 min (the CRM's only data source is unreachable), `ChatFailed` ≥ 3 in 5 min; every alarm `treatMissingData: NOT_BREACHING` with both ALARM and OK actions on one SNS topic `roofing-crm-alerts`, so each resolves itself. Expected rejections never page: 4xx, 429 from the throttles, Zod validation errors. |
| 19 | §3 l. 41 ("PagerDuty free-tier ... when it can be wired, otherwise to email, recorded") | `apply-engineering-guidelines/SKILL.md` non-negotiable 7; `rules/observability-pagerduty-alerting.md` "How To Integrate"; `rules/observability-dlq-alarms.md` (channel pattern) | Justified deviation | 2026-10-16 — Paging channel. The kit's integration contract (a per-service routing key from the company's PagerDuty, the SOCAPITAL-internal `integrating-pagerduty` skill, production-account gating) presupposes the company estate, which a candidate assignment does not have. What is wired is the kit's own channel pattern: the alarms fan out through one SNS topic, and a PagerDuty free-tier service is subscribed through its CloudWatch integration URL (`ALARM` triggers, `OK` resolves) as soon as that service exists, with email as the always-present channel; no Events API trigger code is written because a synchronous API has no terminal batch failure outside the alarms. If the PagerDuty subscription cannot be added by the increment that creates the alarms, email is the only channel and this entry is amended with the date and reason. |
| 20 | §3 (no queues anywhere) | `rules/observability-dlq-alarms.md`; `rules/external-dependency-boundaries.md` "Mandatory Queue-Based Recommendations" | Not applicable | 2026-10-16 — Queues. The CRM has no queued boundary: every path is a synchronous request whose failure is returned to the caller with a request id; no SQS, no asynchronous Lambda destinations, no Step Functions, so no DLQ alarm exists to build. The rules apply the day a queue is added (for example deferred outreach, which the README keeps out of scope). |
| 21 | §8 l. 107 (tools named; layers, mocks and CI contents absent) | `apply-engineering-guidelines/rules/testing-strategy.md` (pyramid, CI contents, approved mocks) | Fix | 2026-10-16 — Tests and CI. Unit (Vitest, about 70 %): lead Zod schemas, the repository's conditional-put and filter logic with `aws-sdk-client-mock`, the pipeline client's 429 backoff, timeout and non-retry behaviour against a local fake server, formatters (roof-age basis, open duration), React components with Testing Library. Integration (about 30 %): the `leads` router against DynamoDB Local in a container (create → list → update → delete, idempotent re-create, oversized note rejected). Contract: the pipeline client's operation and field list against a committed snapshot of `GET /v1/openapi.json`, refreshed when `API_BASE` is set. GitHub Actions on every PR: `pnpm install --frozen-lockfile`, `turbo run lint typecheck test build`, `prettier --check .`, `cdk synth`; no deploy from CI. Deploy is the operator's `cdk deploy` from the runbook. |
| 22 | §5 l. 69-70, 76-78 (ULID key plus "the pair is unique → create is an upsert") | `rules/trpc-backend.md` (Zod-validated procedures); `rules/external-dependency-boundaries.md` "Atomic Idempotency" (conditional writes); plan-internal | Fix | 2026-10-16 — Lead key. "The pair is unique → create is an upsert" is not realizable on a ULID partition key without a scan. The table key is the natural key `pk = <property_id>#<permit_id>` (empty string for the missing side); `lead_id` (ULID) is minted on first create; create is `PutItem` with `attribute_not_exists(pk)` and a repeated create returns the existing lead, which also makes the agent's `create_lead` and `createMany` (bounded parallel conditional puts reporting created versus existing) idempotent; GSI `by_status` (`status`, `created_at`) serves the list; roof-age, permit-group, open-years and radius filters are applied in the Lambda over the status-filtered page with a stated bound (the table is demo-scale); Zod bounds `note` to 2,000 characters and every snapshot field; status and note updates are last-write-wins, stated in the UI. |
| 23 | §2 l. 18-20 (agents and skills) | `guide-product-work/SKILL.md` "product catalog", "Choose the role"; `reference/product-catalog.json` | Not applicable | 2026-10-16 — Product catalog. The roofing CRM is not a catalog product and no catalog product owns it; `metagross` is a retained specialist whose scope (fullstack web applications) fits, which the skill permits ("reuse shared engineering skills and retained specialists when their scope fits"). The role is Build. The skill's increment loop, four-piece floor, AWS inspection and progress record apply in full (items 26-27). |
| 24 | §3 l. 24 ("one CDK stack") | `guide-product-work/SKILL.md` "Deployment identity"; `build-product-deployer/reference/stack-identity.md` | Not applicable | 2026-10-16 — Stack identity contract. It governs products delivered through Build, Marketplace review, Environment and Deploy/Puller as bundles; the CRM is deployed directly with `cdk deploy` and has none of those. Its one cost-free convention is adopted: one stack `RoofingCrm` with explicit account and region, no `dev`/`prod`/stage suffix in stack, construct or resource names, no hard-coded physical names, so repeated deploys update the same stack. |
| 25 | §3 l. 29, §1 l. 9 (public URL, API endpoint) | `guide-product-work/SKILL.md` "Shared API domain"; `reference/shared-api-domain.md`; `build-frontend-backends/rules/cdk-api-infrastructure.md` "Custom Domain Mapping" | Not applicable | 2026-10-16 — Custom domains. Both rules target the Prism/SOCAPITAL estate: an Environment-owned custom domain read from SSM `/account/env-parameters`, and `api.springoakscapital.com` / `api-dev.ai.springoakscapital.com` mappings keyed by the two SOCAPITAL account IDs. The CRM deploys to the candidate's account, where the kit's own template falls back to the execute-api endpoint, and a required `SharedApiDomainName` parameter would make `cdk deploy` from a clean clone impossible. v1 has no custom domain: the public URL is the CloudFront distribution domain and the API is reached through it (item 2). The base-path stability rule is kept in spirit: `/api/trpc` is fixed and never changes after the first deploy. |
| 26 | §2 l. 21-22 ("Three guided increments") | `guide-product-work/SKILL.md` "Derive pieces from product features" (floor of four, never a target; split what one sitting cannot inspect) | Fix | 2026-10-16 — Increments. Five pieces derived from the README acceptance criteria, stable IDs, `Piece i/5`: F1 find aged roofs on the map (hosted URL, default county and center, default search on load, pin and GPS, radius, age threshold, clustered markers, list with total and match reasons, freshness footer from `/v1/meta`, disabled navigation sections; AC 1-4, 7, 11); F2 permit signal and detail (open/stalled toggle, long-open ordering, detail drawer with status, open duration, contractor attribution and BBB status, owner public fields, sources and CIDs; AC 5-6); F3 save leads (tRPC API, DynamoDB, create one or many, leads page, persistence across reloads; AC 8 "creating"); F4 manage leads (status and note editing, delete, list filters by status, roof age, permit group, open years and radius; AC 8 "managing" and the demo's filter step); F5 ask in natural language (AC 9). Reasons: F1/F2 split because one sitting cannot inspect both the search semantics and the permit-detail semantics; F3/F4 split because saving is useful without editing and the README names creating and managing separately; alarms, dashboard, tests and CDK live inside the piece that first needs them and are not pieces. Later pieces are not prebuilt, in any branch or subagent. |
| 27 | §2 l. 21-22 ("deployed and clicked through on the public URL before the next") | `guide-product-work/SKILL.md` "Repeat this loop", "Keep progress visible"; `reference/aws-inspection.md` | Fix | 2026-10-16 — Verification loop. `docs/progress.md` keeps one row per piece: iteration, feature ID, increment, dependencies, configuration/version, status (`pending`, `prepared`, `observed`, `verified`), automated checks, the operator's request id, AWS resource or log reference, expected versus actual, the observation, cleanup, next step. Each handoff gives one copyable invocation (a URL with query parameters, or `curl` on a tRPC procedure), the expected result, at most three AWS steps using the surface that exists (F1-F2: the CloudFormation stack, the bucket's object list and the distribution's invalidation, plus the browser's pipeline calls; F3-F4: the Lambda log group filtered by `requestId` in Logs Insights and the DynamoDB item; F5: the same plus Bedrock metrics and the chat throttle's expected 429), and a "Reply with". `verified` only after the operator's run, inspection and comparison; no secrets or payloads in the record. |
| 28 | §10 l. 116-118; §6 l. 92 ("the intent file") | `guide-product-work/SKILL.md` "Keep progress visible", "Derive pieces" (one input/output example and a small diagram); plan-internal consistency | Fix | 2026-10-16 — Deliverables. §10 also lists `docs/intent.md` (the one-paragraph intent §6 refers to, plus the boundary diagram and one input/output example the skill asks for), `docs/progress.md`, `docs/metrics.md` and `docs/reviews/` (this review and alakazam's), beside `docs/runbook.md`, `.env.example` and `docs/slowking-self-assessment.md`. |

## Summary by class

- **Fix (20):** items 2-11, 13-16, 18, 21, 22, 26-28. Before F1 starts: 2, 3, 5, 6, 7, 8, 9, 10, 11, 26, 27, 28
  (they shape the first deploy). Inside the piece that first needs them: 4, 15, 16, 17, 18 (F3, when the first
  Lambda exists), 13, 14 (F5, with item 14's browser timeout already in F1), 21 (F1 for CI, F3 for the DynamoDB
  Local integration tests), 22 (F3).
- **README override (0):** none. Every rule the plan deviates from is README-silent. The choices decisions.md makes
  on its own (Travis County, no login, Austin center, the default search on load) are not README text and do not
  override any kit rule in the three skills reviewed; "no login" meets no kit rule either way, since none of the
  three skills requires authentication on this kind of API (the `x-api-key` gate in `shared-api-domain.md` is for
  catalog products, item 25).
- **Justified deviation (3):** item 1 (S3 + CloudFront instead of Amplify), item 12 (synchronous chat beyond the
  5 s default), item 19 (email as the fallback paging channel). All three currently lack a stated reason in
  decisions.md; the proposed wording supplies it.
- **Not applicable (5):** item 17 (Lexicon and Main Dashboard registration), item 20 (DLQ alarms), item 23 (product
  catalog ownership), item 24 (stack identity contract), item 25 (shared API domain and the SOCAPITAL custom
  domains). On the two catalog-only sections the task asked about: **shared API domain does not apply** (no
  Environment-owned domain, no Deploy, and a required `SharedApiDomainName` would break the clean-clone deploy the
  §10 deliverable demands); **stack identity does not apply as a contract** (no Build, Marketplace, Deploy or
  Puller), while its no-stage naming is adopted because it costs nothing and keeps repeated deploys idempotent.

## What already conforms

- TypeScript everywhere; no Python (`stack-typescript-for-apis`, `stack-python-for-data`, non-negotiable 1).
- LLM calls through the Vercel AI SDK with Zod on Bedrock, and the contingency stays inside the same SDK
  (`stack-ai-sdk-for-llm`, non-negotiable 2) as written; `ToolLoopAgent` and the loop internals are alakazam's.
- AWS, `us-east-2`; CDK as the only IaC, with SAM-as-IaC, Terraform and Cloudflare excluded (`cloud-aws-primary`,
  non-negotiables 3-4). `sam local` against the synthesized template, if used for emulation, is not IaC.
- No secrets in git, logs or video (non-negotiable 5); no browser-held keys; no second copy of Travis data.
- HTTP API v2, Node 22, one Lambda, reserved concurrency, stage and route throttles, per-request output cap, a
  usage alarm (`cdk-api-infrastructure` key requirements; bounded volume for the sync exception).
- DynamoDB on-demand with point-in-time recovery for a public write API.
- Pipeline calls back off on 429 as the contract specifies; failures show an error state with the request id and
  nothing is cached or faked (no silent failure).
- Vitest, ESLint, Prettier, `tsc`, GitHub Actions on the PR (`testing-strategy` tooling).
- Powertools Logger, Tracer and Metrics on the Lambda (`observability-logging-tracing`).
- React + Vite, a frontend the kit's Amplify rule itself names (`VITE_*`).
- `README.md` treated as read-only, findings routed to `docs/reviews/`, deviations recorded as dated entries (the
  kit's "deviation requires justification in peer review").
- The kit is used as a plugin at a pinned version and commit; the agents and skills §2 names exist in v0.99.1.

## Cross-cutting notes for the alakazam review (not classified here)

- Item 13 fixes the chat envelope (25 s handler deadline under the HTTP API's 30 s integration cap, one
  `AbortSignal`, one retry at most); alakazam's item 13 (the 1 s/2 s/4 s backoff inside the loop) must fit inside
  that budget, which rules out two 30-second retries.
- Item 8 and alakazam's item 18 agree on the renamed names (`/v1/search-centers`, `resolve_search_center`); the
  single home for them is `packages/pipeline-client` (item 6), which alakazam's item 22 (wrap REST through the
  typed client, not MCP) also assumes.
- Alakazam's "already conforms" list relies on `create_lead` being an idempotent upsert; with §5's ULID key that
  is not true. Item 22 makes it true (natural-key conditional put), so the agent's write tool is safe to retry.
- Item 15's PII rule covers the agent path: chat message text is never logged; tool names, ids, token counts and
  durations are.
- Item 28 adds `docs/intent.md`, which §6 refers to and §10 omits; alakazam's wording for the retrieval taxonomy
  belongs in that file.
- The README's "Keep data gathering, ingestion ... out of scope; consume pre-existing/available datasets" is the
  README basis for building no knowledge base or embedding index in this repository; classifying that against
  `build-rag-systems` is alakazam's.

## Open questions

1. **Amplify versus S3 + CloudFront (item 1).** The deviation is justified on reproducibility and the org-level
   GitHub App install; if the graders weigh literal conformance higher, switching costs an `amplify.yml` and a
   `CfnApp`, and the same-origin API (item 2) would be replaced by `VITE_API_URL` plus CORS. Decide before F1.
2. **One Lambda or two (alakazam's aside, handed to this review).** Recommendation: two `NodejsFunction`s from the
   same codebase, `handler-leads.ts` serving `router({ leads })` and `handler-agent.ts` serving `router({ agent })`,
   with the merged `AppRouter` type exported for the client (procedure paths are unchanged, so the API Gateway
   routes of item 4 decide which function answers). Each gets its own memory, timeout and reserved concurrency, the
   AI SDK bundle leaves the CRUD function's cold start, and a chat burst cannot starve lead writes. This deviates
   from the kit's "single Lambda" overview sentence (not a non-negotiable) and from the plan's §3; if adopted,
   record it as a justified deviation with that reason. If one function is kept, state the shared reserved
   concurrency and accept the starvation risk explicitly.
3. **Default model (alakazam's second aside).** Seconded as a cost choice only: default the CRM's `BEDROCK_MODEL_ID`
   to the Sonnet profile and keep Opus as the parameter flip; the daily usage alarm then watches a smaller spend.
   Not a rule in the three skills reviewed; the operator decides.
4. **Public, unauthenticated write API.** Anyone can create, edit or delete leads on the shared list. A cheap
   alternative that needs no login: a per-browser `workspace_id` (ULID in `localStorage`, sent with every lead
   procedure, prefixed into `pk`) so visitors see their own leads and the demo stays deterministic. A WAF rate rule
   on the distribution would bound abuse further but conflicts with near-zero standing cost. Decide before F3.
5. **Lead snapshot provenance (§5).** The browser already holds the row, so the client supplies the snapshot and the
   Lambda only validates its shape and bounds; the alternative (the Lambda re-fetches the property and permit from
   the pipeline at create time) couples lead creation to pipeline availability and doubles latency. Confirm the
   client-supplied snapshot, labelled as such, is acceptable for the demo.
6. **Pipeline cold start versus the 5 s default (item 14).** The 8 s Lambda-side timeout assumes the pipeline's
   "several seconds" after idle; if the pipeline adds provisioned concurrency or a warmer, lower it to 5 s.
7. **PMTiles extract production (item 11).** Who produces the Travis bounding-box extract (Protomaps `pmtiles
   extract` from the current daily build) and in which increment it is uploaded; the fallback to CARTO is recorded
   only if that cannot happen inside F1.
8. **Deploy from the operator's machine (item 21).** CI runs checks only; a CI deploy would need an OIDC role in the
   candidate's account and is not needed for the assignment. Confirm.

## Appendix A — proposed monorepo layout (items 5, 6, 9)

```
roofing-crm/
├── apps/
│   ├── web/                               # React + Vite + MapLibre; S3 + CloudFront (items 1, 2)
│   │   ├── src/
│   │   │   ├── app/                       # routes: map, leads, chat; disabled sections
│   │   │   ├── map/                       # pin, GPS, radius, clusters, legend, PMTiles source
│   │   │   ├── leads/                     # list, filters, status and note editing
│   │   │   ├── chat/                      # agent panel (UI only)
│   │   │   └── config.ts                  # reads /config.json at start (pipelineApiBase, apiPath)
│   │   ├── index.html, vite.config.ts, package.json, tsconfig.json
│   └── api/                               # tRPC on Lambda + CDK
│       ├── src/
│       │   ├── routers/
│       │   │   ├── index.ts               # appRouter = router({ leads, agent }); export type AppRouter
│       │   │   ├── leads.ts               # create, createMany, list, update, delete
│       │   │   └── agent.ts               # chat (loop internals per the alakazam review)
│       │   ├── leads/repository.ts        # DynamoDB conditional puts, GSI by_status (item 22)
│       │   ├── agent/                     # tools wrapping packages/pipeline-client; alakazam's scope
│       │   ├── context.ts                 # logger, tracer, metrics, ddb, pipeline client, requestId
│       │   ├── trpc.ts                    # initTRPC, errorFormatter with requestId
│       │   └── handler.ts                 # awsLambdaRequestHandler (or handler-leads.ts / handler-agent.ts, open question 2)
│       ├── cdk/
│       │   ├── bin/app.ts                 # new RoofingCrmStack(app, 'RoofingCrm', { env: { account, region: 'us-east-2' } })
│       │   └── lib/
│       │       ├── roofing-crm-stack.ts   # tags: { project_name: 'roofing-crm' }
│       │       ├── api.ts                 # HTTP API, routes and RouteSettings throttles, Lambda(s), table
│       │       ├── web-hosting.ts         # bucket, OAC, distribution (+ /api/* behaviour), BucketDeployment, config.json, PMTiles
│       │       └── observability.ts       # log groups (90 d), alarms, SNS topic, dashboard
│       ├── cdk.json, package.json, tsconfig.json
├── packages/
│   ├── api-client/                        # createTRPCReact<AppRouter>, httpLink, AppRouter type
│   ├── pipeline-client/                   # typed v1 client: types, Zod, 429 backoff, timeouts, request_id (items 6-8, 14)
│   ├── shared/                            # lead schemas, status enum, defaults, formatters, disabled-section list
│   └── tsconfig/                          # base.json, react.json, node.json
├── docs/
│   ├── decisions.md, intent.md, progress.md, metrics.md, runbook.md, slowking-self-assessment.md
│   └── reviews/                           # 2026-10-16-alakazam.md, 2026-10-16-metagross.md
├── .github/workflows/ci.yml               # install, turbo lint typecheck test build, prettier --check, cdk synth
├── package.json, pnpm-workspace.yaml, turbo.json, tsconfig.json, .env.example
```

## Appendix B — boundary diagram (items 2, 7; for `docs/intent.md`)

```
browser ──HTTPS──▶ CloudFront ─┬─ default ──▶ S3: SPA, config.json, PMTiles (Range)
                               └─ /api/* ───▶ HTTP API ──▶ Lambda (tRPC: leads.*, agent.chat)
                                                              ├──▶ DynamoDB (leads, GSI by_status)
                                                              ├──▶ Bedrock via Vercel AI SDK (agent.chat only)
                                                              └──▶ pipeline API v1 (agent tools, packages/pipeline-client)
browser ──HTTPS──▶ pipeline API v1 directly: /v1/meta, /v1/search-centers, /v1/properties/*, /v1/permits/*, /v1/contractors/*
                   (contract CORS *, packages/pipeline-client, 429 backoff 1 s / 2 s / 4 s, 15 s timeout)
```

Example input/output for the intent file: a pin at 30.2672, −97.7431 with radius 5 miles and age threshold 15 →
`GET {API_BASE}/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&limit=500` →
`{ items: PropertySummary[500], total: 12431, next_cursor }` → 500 clustered markers, "12,431 matches, showing
500", each row with `match_reasons`; "save" on one row → `POST /api/trpc/leads.create` with the labelled snapshot →
`{ lead_id, status: "new", created: true }` and a row on the Leads page after reload.
