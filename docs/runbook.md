# Runbook — Roofing CRM

Deploy from a clean clone, local preview, and the facts the kit cannot put in `README.md` (that file is read-only).

## Pipeline API (`API_BASE`)

- `API_BASE`: **https://733jzm4xv4.execute-api.us-east-2.amazonaws.com** (pipeline account 561303652468, us-east-2;
  from the pipeline's handoff of 2026-10-20, stable across its T7 storage correction). It is in the operator's `.env` as
  `PIPELINE_API_BASE`. Still to do by the operator: the GitHub repository variable of the same name, for CI's
  served-contract check:
  `gh variable set PIPELINE_API_BASE --repo xucian/roofing-crm --body https://733jzm4xv4.execute-api.us-east-2.amazonaws.com`.
- Contract pin: `packages/contract/openapi.json` at pipeline commit `56b020c483d8197b15570275399e51ba512fca1d`, sha256
  `7d8ece6832aa5f618c2d2bff0b68edad139700fbe37c8c1b58e7b9be75db48bc` (`packages/pipeline-client/openapi.pin.json`). The
  served `GET {API_BASE}/v1/openapi.json` had the same bytes on 2026-10-20. To re-pin after a contract change, run
  `pnpm --filter @roofing-crm/pipeline-client pin <commit> packages/contract/openapi.json`. It reads the file at that
  commit from the local clone `../oracle-property-intelligence-platform-pipeline-travis-tx` (or from GitHub), never
  writes there, and generates the client types. Commit `openapi.pin.json`, `openapi/openapi.json` and
  `src/generated/pipeline-api.ts` together. `pnpm --filter @roofing-crm/pipeline-client check:served` (with
  `PIPELINE_API_BASE` set) compares the pin with the served contract.
- The pipeline's account (pipeline handoff, 2026-10-20): it runs 10 Lambda executions at once in total, shared by the
  pipeline API, the pipeline chat and this CRM's own functions, and caps functions at 3008 MB. A cold search takes
  about 7 to 8 s once the pipeline's T7 correction is live. The CRM therefore keeps one pipeline call in flight per
  page, waits up to 29 s per attempt, and shows a loading state on the default search.

## Prerequisites (operator machine)

- Node.js 22.13 or later (`.nvmrc`) and git.
- pnpm 10.34.6 through corepack: run `corepack enable` once. The repository's `packageManager` pins the version, and
  scripts call `pnpm` themselves.
- AWS CLI v2 with a profile for the target account (`export AWS_PROFILE=<profile>`). The region is always `us-east-2`.
- For the basemap: the `pmtiles` CLI (`brew install pmtiles`) or Docker, in which case the script runs the pinned
  `protomaps/go-pmtiles:v1.31.2` image.

## Deploy from a clean clone (F1)

```sh
git clone https://github.com/xucian/roofing-crm.git && cd roofing-crm && git checkout assignment
corepack enable
pnpm install --frozen-lockfile
pnpm check          # format, lint, typecheck, tests, build, cdk synth, contract pin: what CI runs
pnpm basemap        # basemap/: Travis extract, glyphs, sprites, SOURCE.json (about 85 MB, a minute or two)
cp .env.example .env   # then set PIPELINE_API_BASE to API_BASE (above)
export AWS_PROFILE=<profile>
pnpm deploy:aws     # checks, shows the account and region, asks, builds, deploys, prints the URL
```

`pnpm deploy:aws` stops, before any AWS call, if the contract pin is pending. It also stops when the served
`/v1/openapi.json` differs from the pin, when no credentials are found, or when the account has no CDK bootstrap in
`us-east-2`; then it prints the one-time command `pnpm --filter @roofing-crm/api exec cdk bootstrap aws://<account>/us-east-2`.
CDK asks before IAM changes (`--require-approval broadening`). The script writes `cdk-outputs.json` (git-ignored) and
prints `WebUrl` and the F1 link. Redeploying updates the same stack, `RoofingCrm`. From `.env` it reads only
`PIPELINE_API_BASE`.

The stack creates one private S3 bucket (build output and basemap, retained if the stack is deleted), one CloudFront
distribution with an SPA-routing function and a security-headers policy, and CDK's bucket-deployment Lambda with a
90-day log group, all tagged `project_name=roofing-crm`.

## Deployed basemap

- Built on 2026-10-17 into the git-ignored `basemap/` of the working tree, not deployed yet: Protomaps build 20261016
  (tileset 4.15.2), box -98.2,29.99,-97.34,30.66, z0-15, sha256
  9e5238651b55e1b7517c60f8ea3defe95aed4cbb81c2923bcfe7607cd8e348c8; glyphs and sprites from
  protomaps/basemaps-assets@028c18f. `pnpm basemap --force` rebuilds from the newest daily build; replace this line
  with the one it prints. After a deploy the same record is served at `<WebUrl>/basemap/SOURCE.json`.

## Local preview (no AWS)

- `pnpm dev` serves the app at http://localhost:5173 with `/config.json` and `/basemap/*` from the working tree.
  `PIPELINE_API_BASE` in the shell points it at the pipeline; without it the app says "Pipeline API not configured".
- `pnpm build && pnpm --filter @roofing-crm/web preview` serves the production bundle at http://localhost:4173 under the
  same CSP and headers as CloudFront.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main` and `assignment`: format, lint, typecheck,
tests, build, `cdk synth` (no credentials, no deploy inputs) and the contract pin check. A second job compares the
served `/v1/openapi.json` with the pin once the repository variable `PIPELINE_API_BASE` is set. CI never deploys and
holds no AWS credentials.

## Teardown (only after the evaluation)

The stack has termination protection and the bucket is retained:

```sh
aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name RoofingCrm --region us-east-2
pnpm --filter @roofing-crm/api exec cdk destroy RoofingCrm
aws s3 rb s3://<WebBucketName> --force --region us-east-2
```

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

**Deploy (F5, not yet).** The deploy script writes `LANGSMITH_API_KEY` from `.env` to Secrets Manager with the AWS CLI, outside CloudFormation; CDK only references that secret and sets the agent Lambda to `LANGSMITH_PROJECT=pidgeot-agent` plus `LANGSMITH_API_KEY_SECRET_ARN`. Passing the key through CDK would print it in the synthesized template, so it never goes there, nor in git, logs or the frontend bundle. If the secret is missing at runtime, tracing degrades; chat still answers.
