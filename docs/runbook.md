# Runbook — Roofing CRM

Deploy-from-clone steps land with F1. This file starts with the facts the kit cannot put in `README.md` (that file is read-only).

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
