# Runbook — Roofing CRM

Deploy from a clean clone, local preview, and the facts the kit cannot put in `README.md` (that file is read-only).

## Pipeline API (`API_BASE`)

- `API_BASE`: **https://733jzm4xv4.execute-api.us-east-2.amazonaws.com** (pipeline account 561303652468, us-east-2;
  from the pipeline's handoff of 2026-10-20, unchanged by its T7 storage correction). It is committed configuration, not
  a secret: `apiBase` in `packages/pipeline-client/openapi.pin.json`, next to the contract it must serve. CI's
  served-contract check, `pnpm deploy:aws` and `pnpm dev` read it there, so nothing is set in `.env` or on GitHub.
  `PIPELINE_API_BASE` in the shell overrides it for one run, for example to point `pnpm dev` at a local pipeline.
- Contract pin: `packages/contract/openapi.json` at pipeline commit `56b020c483d8197b15570275399e51ba512fca1d`, sha256
  `7d8ece6832aa5f618c2d2bff0b68edad139700fbe37c8c1b58e7b9be75db48bc` (`packages/pipeline-client/openapi.pin.json`). The
  served `GET {API_BASE}/v1/openapi.json` had the same bytes on 2026-10-20. To re-pin after a contract change, run
  `pnpm --filter @roofing-crm/pipeline-client pin <commit> packages/contract/openapi.json`. It reads the file at that
  commit from the local clone `../oracle-property-intelligence-platform-pipeline-travis-tx` (or from GitHub), never
  writes there, and generates the client types. Commit `openapi.pin.json`, `openapi/openapi.json` and
  `src/generated/pipeline-api.ts` together. `pnpm --filter @roofing-crm/pipeline-client check:served` compares the pin
  with the contract served at `apiBase`.
- The pipeline's account (pipeline handoff, 2026-10-20): it runs 10 Lambda executions at once in total, shared by the
  pipeline API, the pipeline chat and this CRM's own functions, and caps functions at 3008 MB. The pipeline keeps no
  warm instance. Measured after its T7 correction: on an idle API the first call takes about 3 to 5 s, and 8 to 9 s
  right after a pipeline deploy or a long idle; warm, F1's default search takes 1.6 to 1.7 s end to end (0.3 s in the
  function, the rest is the 500-item response) and a text search 1 to 1.5 s. The pipeline warms three instances after
  each of its deploys, and before a demo on request. The CRM keeps one pipeline call in flight per page, sends
  `/v1/meta` first so the search lands warm, waits up to 29 s per attempt without retrying a timeout, and says why a
  call is slow after 3 s.

## Prerequisites (operator machine)

- Node.js 22.13 or later (`.nvmrc`) and git.
- pnpm 10.34.6 through corepack: run `corepack enable` once. The repository's `packageManager` pins the version, and
  scripts call `pnpm` themselves.
- AWS CLI v2 with a profile for the target account (`export AWS_PROFILE=<profile>`). The region is always `us-east-2`.
  The evaluated deployment uses the pipeline's account, 561303652468, profile `cdk-lab` (decisions.md, 2026-10-20).
- For the basemap: the `pmtiles` CLI (`brew install pmtiles`) or Docker, in which case the script runs the pinned
  `protomaps/go-pmtiles:v1.31.2` image.

## Deploy from a clean clone

```sh
git clone https://github.com/xucian/roofing-crm.git && cd roofing-crm && git checkout assignment
corepack enable
pnpm install --frozen-lockfile
pnpm check          # format, lint, typecheck, tests, build, cdk synth, contract pin: what CI runs
pnpm basemap        # basemap/: Travis extract, glyphs, sprites, SOURCE.json (about 85 MB, a minute or two)
export AWS_PROFILE=<profile>
pnpm deploy:aws     # checks, shows the account and region, asks, builds, deploys, prints the URL and resources
```

`pnpm deploy:aws` stops, before any AWS call, if the contract pin is pending. It also stops when the served
`/v1/openapi.json` differs from the pin, when no credentials are found, or when the account has no CDK bootstrap in
`us-east-2`; then it prints the one-time command `pnpm --filter @roofing-crm/api exec cdk bootstrap aws://<account>/us-east-2`.
CDK asks before IAM changes (`--require-approval broadening`). The script writes `cdk-outputs.json` (git-ignored) and
prints `WebUrl` and the F1 link. Redeploying updates the same stack, `RoofingCrm`. It reads nothing from `.env`: the
pipeline API base is `apiBase` in `openapi.pin.json`, and the script says so when `PIPELINE_API_BASE` overrides it.

The stack, all tagged `project_name=roofing-crm`, creates:

- **Web.** One private S3 bucket for the build output and the basemap, retained if the stack is deleted. One CloudFront
  distribution with an SPA-routing function and a security-headers policy. CDK's bucket-deployment Lambda with a
  90-day log group.
- **CRM API (F3).** An HTTP API that CloudFront serves under `/api/*` (tRPC at `/api/trpc`), with route throttles and a
  90-day access log. The `leads` Lambda, with a 90-day log group. The DynamoDB table of leads, on demand with
  point-in-time recovery, retained if the stack is deleted.
- **Alarms (F3, F5).** One SNS topic and nine alarms (`docs/metrics.md`).

On the first deploy that adds IAM resources (F3: the function's role, its table grant and API Gateway's permission to
invoke it), CDK lists them and asks: answer `y`.

**Alarm email.** After `cdk deploy`, the script looks at the alarm topic. If no email is subscribed, it subscribes
`ALERT_EMAIL`, or asks for an address (blank skips; `--yes` skips the question). AWS then sends a confirmation email,
whose "Confirm subscription" link starts the notifications. The address goes to SNS with the AWS CLI: never in git, the
template or the logs. Later deploys find the subscription and leave it alone.

## Deployed basemap

- Built on 2026-10-17 into the git-ignored `basemap/` of the working tree and deployed with the app: Protomaps build
  20261016 (tileset 4.15.2), box -98.2,29.99,-97.34,30.66, z0-15, sha256
  9e5238651b55e1b7517c60f8ea3defe95aed4cbb81c2923bcfe7607cd8e348c8; glyphs and sprites from
  protomaps/basemaps-assets@028c18f. The same record is served at
  https://d2ymfvxnntp0j0.cloudfront.net/basemap/SOURCE.json (checked 2026-10-21). `pnpm basemap --force` rebuilds from
  the newest daily build; replace this line with the one it prints.

## Local preview (no AWS)

- `pnpm dev` serves the app at http://localhost:5173 with `/config.json` and `/basemap/*` from the working tree. It
  calls the pipeline at `apiBase` (the pipeline allows any origin), or at `PIPELINE_API_BASE` when that is set.
- `pnpm build && pnpm --filter @roofing-crm/web preview` serves the production bundle at http://localhost:4173 under the
  same CSP and headers as CloudFront.
- The CRM API (leads) is same-origin in AWS and has no local server. To save and list leads from `pnpm dev` or the
  preview, proxy `/api` to a deployment: `CRM_API_ORIGIN=https://<distribution>.cloudfront.net pnpm dev`. Without it,
  lead calls fail and the page says so. The leads land in that deployment's table, in this browser's workspace.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main` and `assignment`: format, lint, typecheck,
tests, build, `cdk synth` (no credentials, no deploy inputs) and the contract pin check; locally, `pnpm check` runs the
same. A second job, "Served pipeline contract matches the pin", fetches `/v1/openapi.json` from `apiBase` and compares
it with the pin; locally, `pnpm --filter @roofing-crm/pipeline-client check:served`. Neither needs a repository
variable or secret. CI never deploys and holds no AWS credentials.

## Teardown (only after the evaluation)

The stack has termination protection and the bucket is retained:

```sh
aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name RoofingCrm --region us-east-2
pnpm --filter @roofing-crm/api exec cdk destroy RoofingCrm
aws s3 rb s3://<WebBucketName> --force --region us-east-2
aws dynamodb delete-table --table-name <LeadsTableName> --region us-east-2
```

`<WebBucketName>` and `<LeadsTableName>` are stack outputs (`cdk-outputs.json`). The alarm topic, and with it the email
subscription, goes with the stack.

## Agent identity

Named after Pidgeot — surveys a wide territory from the air and spots targets far below, fitting a radius lead scout over properties and permits.

- Runtime identifier: `pidgeot-agent` (`LANGSMITH_PROJECT`, env prefix, F5 module folder).
- UI label: **Assistant**. Visitors never see the Pokémon name.
- Picked by the kit's `ash` agent, confirmed by the operator on 2026-10-16 (recorded in `docs/decisions.md`).

## LangSmith

Traces are live CRM chats (questions typed on the public URL), grouped by `session_id`. They are not Claude Code sessions. Traces hold message text; CloudWatch logs must not. Retention is whatever the LangSmith project is set to; this repo does not copy traces into git.

**Local (already on this machine).** Copy `.env.example` to `.env` if starting from a clone. Required:

| Variable | Value |
| --- | --- |
| `LANGSMITH_PROJECT` | `pidgeot-agent` (fixed; not a secret) |
| `LANGSMITH_API_KEY` | from the LangSmith workspace; never commit |

Optional kit defaults, used at F5 if omitted: `LANGSMITH_TRACING=true`, `LANGSMITH_ENDPOINT=https://api.smith.langchain.com`.

**Deploy (F5).** `pnpm deploy:aws` reads only `LANGSMITH_API_KEY` from `.env` and writes it to the Secrets Manager
secret `pidgeot-agent/langsmith-api-key` with the AWS CLI, through a file only this user can read: never on a command
line, in the template, in git, in logs or in the frontend bundle. It writes a new version only when the key changed. CDK
grants the `agent` function `GetSecretValue` on that secret and sets `LANGSMITH_PROJECT=pidgeot-agent` and
`LANGSMITH_API_KEY_SECRET_ID` (its name). Without a key in `.env` the stack sets `LANGSMITH_TRACING=false`; an unreadable
secret also leaves the agent untraced. Chat answers either way.

## Agent

- **Model.** `us.anthropic.claude-sonnet-4-6` (US cross-region profile; the account denies newer Claude models). Another
  enabled profile: `-c bedrockModelId=<profile id>` on the deploy's `cdk deploy` (scripts/deploy.ts).
- **Daily budget.** 200 turns and 2,000,000 tokens per UTC day, then 503 `budget_exhausted` until 00:00 UTC. The count is
  the leads table item with `workspace_id` `#agent-usage` and `lead_key` the UTC date; deleting that item resets the day.
  The function's environment `AGENT_DAILY_TURNS` and `AGENT_DAILY_TOKENS` override the caps.
- **Golden set.** `fixtures/agent/golden.json`, 13 cases (questions and expected tool calls, never prose). In-process, with
  the live pipeline and Bedrock (about $0.20 a run): the Bedrock provider reads the standard credential variables, so
  export the profile's first:

  ```sh
  eval "$(aws configure export-credentials --profile cdk-lab --format env)"
  AWS_REGION=us-east-2 POWERTOOLS_LOG_LEVEL=ERROR pnpm agent:golden
  ```

  Against the deployed agent: `pnpm agent:golden --url <WebUrl>`. Each run uses a fresh workspace and saves 2 leads in it;
  results go to `fixtures/agent/results/` (git-ignored).
