# Metrics — Roofing CRM

Every metric the CRM emits, with its unit, dimensions and alarm (metagross items 16 and 17). It changes in the same
commit as the code that emits a metric. The names live in `apps/api/src/metric-names.ts`, which the function and the
stack's alarms both read.

The `leads` and `agent` functions emit them with Powertools Metrics (CloudWatch embedded metric format) in namespace
`RoofingCrm`. Each metric has the dimension `service` = `roofing-crm-api` plus the dimensions below. They are flushed once
per request: a 25-row save writes a few records, not one per row.

| Metric | Unit | Dimensions | Emitted | Alarm |
| --- | --- | --- | --- | --- |
| `LeadProcessed` | Count | `operation` = `create`, `update` or `delete` | `create`: per row saved or found already saved, by `leads.create` and `leads.createMany`. `update`: per lead edited. `delete`: per delete, including one that found the lead gone | — |
| `LeadFailed` | Count | `operation` = `create`, `reason` = `not_found`, `mismatch`, `pipeline` or `deadline` | Per row not saved | — (a pipeline outage is caught below) |
| `PipelineCallProcessed` | Count | — | Per pipeline call that answered 2xx | — |
| `PipelineCallFailed` | Count | `status` = `429`, `4xx`, `5xx`, `timeout`, `network` or `aborted` | Per pipeline call that failed, after its retries | `PipelineOutage`: `5xx` + `timeout` ≥ 5 in 5 minutes |
| `ProcessingDuration` | Milliseconds | `operation` = `create`, `createMany`, `update`, `delete`, `list` or `chat` | Per procedure call | — |
| `ChatTurn` | Count | `outcome` = `answered`, `no_matches`, `needs_clarification`, `out_of_scope`, `out_of_county`, `limit_reached` or `tool_error` | Per agent turn that reached the model | — |
| `ChatFailed` | Count | `reason` = `tool_error`, `model_unavailable`, `pipeline` or `internal` | Per turn the user got no answer from | `ChatFailed`: ≥ 3 in 5 minutes |
| `ChatRefused` | Count | `reason` = `budget_exhausted` or `circuit_open` | Per turn refused before the model (503) | — |
| `ChatInputTokens`, `ChatOutputTokens` | Count | — | Model tokens per turn (input includes cache reads) | `ChatDailyTokens`: input + output ≥ 1,500,000 in a day |
| `ChatCacheReadTokens` | Count | — | Input tokens read from the Bedrock prompt cache | — |
| `ChatToolCalls` | Count | — | Tool calls per turn | — |
| `ChatTurnLatency` | Milliseconds | — | From API Gateway's receipt to the answer | — |
| `ColdStart` | Count | `function_name` | First request of each execution environment (Powertools) | — |

AWS metrics the stack alarms on:

| Alarm | Metric | Threshold |
| --- | --- | --- |
| `FunctionErrors` | `AWS/Lambda` `Errors` of the `leads` function | ≥ 1 in 5 minutes |
| `FunctionThrottles` | `AWS/Lambda` `Throttles` of the `leads` function, which reserves 10 executions | ≥ 1 in 5 minutes |
| `AgentErrors` | `AWS/Lambda` `Errors` of the `agent` function | ≥ 1 in 5 minutes |
| `AgentThrottles` | `AWS/Lambda` `Throttles` of the `agent` function, which reserves 5 executions | ≥ 1 in 5 minutes |
| `Api5xx` | `AWS/ApiGateway` `5xx` of the CRM HTTP API | ≥ 1 in 5 minutes |
| `TableSystemErrors` | `AWS/DynamoDB` `SystemErrors` on the leads table (GetItem, PutItem, Query, UpdateItem, DeleteItem) | ≥ 1 in 5 minutes |
| `PipelineOutage` | `RoofingCrm` `PipelineCallFailed`, `status` `5xx` plus `timeout`, both functions | ≥ 5 in 5 minutes |

Every alarm treats missing data as not breaching and sends both ALARM and OK to one SNS topic (`AlertsTopicArn` in the
stack outputs), so each one resolves itself. `pnpm deploy:aws` subscribes one email to the topic (docs/runbook.md).
Expected rejections raise nothing: validation errors (400), the route throttles' 429, a pipeline 404, an edit of a lead
that was deleted (404) and a chat turn past the daily cap (503 `budget_exhausted`, counted in `ChatRefused`). Bedrock's
own metrics (`AWS/Bedrock` `Invocations`, `InvocationThrottles`, `InputTokenCount`, `OutputTokenCount` by `ModelId`) are on
the dashboard.

Item 17's dashboard is built (docs/decisions.md, 2026-10-21 F5 entry): stack output `DashboardName`, in CloudWatch →
Dashboards. It shows both functions (invocations, errors, throttles, duration p95), the HTTP API's 4xx and 5xx, leads by
operation and failure reason, procedure duration p95, pipeline calls by status, chat turns by outcome, failures and
refusals, chat tokens and latency p95, Bedrock invocations and tokens, and every alarm. It holds 48 metrics, inside the free
tier's 50; the stack test fails above that. The Lexicon and main-dashboard registration the kit asks for belong to the
SOCAPITAL estate and do not apply here (item 17).
