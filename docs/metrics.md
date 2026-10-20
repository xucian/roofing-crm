# Metrics — Roofing CRM

Every metric the CRM emits, with its unit, dimensions and alarm (metagross items 16 and 17). It changes in the same
commit as the code that emits a metric. The names live in `apps/api/src/metric-names.ts`, which the function and the
stack's alarms both read.

The `leads` function emits them with Powertools Metrics (CloudWatch embedded metric format) in namespace `RoofingCrm`.
Each metric has the dimension `service` = `roofing-crm-api` plus the dimensions below. They are flushed once per
request: a 25-row save writes a few records, not one per row.

| Metric | Unit | Dimensions | Emitted | Alarm |
| --- | --- | --- | --- | --- |
| `LeadProcessed` | Count | `operation` = `create` | Per row saved or found already saved, by `leads.create` and `leads.createMany` | — |
| `LeadFailed` | Count | `operation` = `create`, `reason` = `not_found`, `mismatch`, `pipeline` or `deadline` | Per row not saved | — (a pipeline outage is caught below) |
| `PipelineCallProcessed` | Count | — | Per pipeline call that answered 2xx | — |
| `PipelineCallFailed` | Count | `status` = `429`, `4xx`, `5xx`, `timeout`, `network` or `aborted` | Per pipeline call that failed, after its retries | `PipelineOutage`: `5xx` + `timeout` ≥ 5 in 5 minutes |
| `ProcessingDuration` | Milliseconds | `operation` = `create`, `createMany` or `list` | Per procedure call | — |
| `ColdStart` | Count | `function_name` | First request of each execution environment (Powertools) | — |

AWS metrics the stack alarms on:

| Alarm | Metric | Threshold |
| --- | --- | --- |
| `FunctionErrors` | `AWS/Lambda` `Errors` of the `leads` function | ≥ 1 in 5 minutes |
| `FunctionThrottles` | `AWS/Lambda` `Throttles` of the `leads` function | ≥ 1 in 5 minutes |
| `Api5xx` | `AWS/ApiGateway` `5xx` of the CRM HTTP API | ≥ 1 in 5 minutes |
| `TableSystemErrors` | `AWS/DynamoDB` `SystemErrors` on the leads table (GetItem, PutItem, Query) | ≥ 1 in 5 minutes |
| `PipelineOutage` | `RoofingCrm` `PipelineCallFailed`, `status` `5xx` plus `timeout` | ≥ 5 in 5 minutes |

Every alarm treats missing data as not breaching and sends both ALARM and OK to one SNS topic (`AlertsTopicArn` in the
stack outputs), so each one resolves itself. `pnpm deploy:aws` subscribes one email to the topic (docs/runbook.md).
Expected rejections raise nothing: validation errors (400), the route throttles' 429 and a pipeline 404.

Item 17's dashboard is not built yet (docs/decisions.md, 2026-10-20 F3 entry). These metrics can be graphed from
CloudWatch, under Metrics → All metrics → `RoofingCrm`. The Lexicon and main-dashboard registration that the kit asks for belong to
the SOCAPITAL estate and do not apply here (item 17).
