# Intent — Roofing CRM

**A roofing sales rep can open one public URL, see the roofs in a chosen part of Travis County that are old or carry
long-open roofing permits, with each permit's status, open duration, contractor and BBB status, save the best ones as
CRM leads and work them, and ask in plain English for more, so that outreach starts from verifiable public records
instead of guesswork.**

`README.md` is the assignment and the specification. `docs/decisions.md` records how it is met, `docs/progress.md` how
each piece was verified on the public URL.

## The outcome, in the README's terms

- **Find** (AC 1 to 7). The map opens on Travis County at Austin and runs the default search at once. The center is a
  dropped pin, GPS or a place; the radius and the roof-age threshold are the user's, and so is the open-permit signal.
  Long-open permits come first. A browsable list shows why each property matched. The drawer shows every permit's
  status, open duration, contractor as printed and BBB as the data reports it.
- **Keep** (AC 8). Any property or permit can be saved, one or many at a time, as a lead with a snapshot of the pipeline
  run it came from. Leads take a status and a note, can be deleted, and filter by status, roof age, permit group, years
  open and radius.
- **Ask** (AC 9). The Assistant answers questions such as the README's "open roofing permits older than five years
  within five miles of Austin". It answers from the records its tools returned in that turn, cites every one, and can
  save them as leads when asked.
- **Boundaries** (AC 10, 11). The CRM ingests nothing; every record comes from the pipeline API. Outreach, Campaigns,
  Sequences, Reporting and Billing are shown disabled.

## What "RAG-backed" means here

The agent is grounded generation over operational records. Retrieval is structured: radius, roof age, status and years
open, through the pipeline's search tools. It is also lexical: full-text search over permit descriptions. Generation
only reports rows those tools returned in the turn. The server builds the evidence list from the tool results, and it
withholds any answer that cites an id no tool returned. There is no embedding index, for two reasons. The README's
example question is a spatial and numeric filter, which embeddings cannot evaluate. And the README keeps ingestion out
of scope, so the CRM holds no corpus to embed. The kit's vector step is therefore omitted, and that is recorded
(decisions.md §6 and the alakazam entries).

## Boundaries

```
browser ──HTTPS──▶ CloudFront (stack RoofingCrm, us-east-2)
                     ├─ default ───▶ S3: the app, /config.json
                     ├─ basemap/* ─▶ S3: Protomaps extract of Travis County, glyphs, sprites
                     └─ api/* ─────▶ HTTP API ─┬─▶ leads Lambda (tRPC leads.*) ─▶ DynamoDB (leads, per browser workspace)
                                               │      └─ reads the pipeline for each new lead's snapshot
                                               └─▶ agent Lambda (tRPC agent.chat) ─▶ Bedrock, Claude Sonnet 4.6
                                                      ├─ tools: 8 pipeline API reads, one at a time
                                                      └─ tools: list_leads, create_lead (the same leads service)
browser ──HTTPS──▶ pipeline API v1 (API_BASE): /v1/meta, /v1/search-centers, /v1/properties/*, /v1/permits/*
                   (the separate pipeline story; contract pinned by commit, typed client, 429 back-off)
```

## One input and its output

A pin at 30.2672, −97.7431 with the defaults (5 miles, roofs older than 15 years, open permits on) sends:

```
GET {API_BASE}/v1/properties/search?lat=30.2672&lon=-97.7431&radius_miles=5&roof_age_min=15&open_permits=true&long_open_years=5&limit=500
```

The answer `{items, total: 54173, next_cursor}` becomes 500 clustered markers, "54,173 matches, showing 500", and rows.
The first rows are the longest-open roofing permits, red. **Save lead** on property 103857 sends
`POST /api/trpc/leads.create`. The function reads the pipeline and stores the lead with its snapshot: 802 BARTON BLVD,
roof 18 years old, permit 1981-013092 BP open since 1981-10-23, contractor "Gary Pools", BBB blocked at source, run
`20261018T143520Z-t5-full`. The lead is on the Leads page after a reload.

Asked "Show me open roofing permits older than five years within five miles of Austin", the agent:

- calls `resolve_search_center` for Austin;
- calls `search_permits` with `min_open_years: 5`, `radius_miles: 5`, open and stalled, roofing only;
- reports 139 matches and the five longest open, each a chip that opens the property;
- adds the assumption that "older than five years" means open that long, not the roof's age;
- notes that no BBB rating is available.
