# Alakazam review, 2026-10-21 — the slowking review fixes in `apps/api` (uncommitted batch)

Read-only review by the kit's `alakazam` agent of the batch that answers a slowking self-assessment of PR #14 at
`15015e6` (kept outside the repository): the typed tool registry (B1), the replacement of the save-intent pattern (B2), the
leads reservation (B3), the stack tests (B4) and the raised chat caps. It judged a diff snapshot of `apps/api` against
`skills/build-ai-agents/`, `skills/build-rag-systems/` and `skills/apply-engineering-guidelines/` (kit 0.99.1) and its
earlier reviews (`2026-10-16-alakazam.md`, `2026-10-21-alakazam-f5.md`).

**Verification, offline:** `tsc` clean and 83 of 83 agent, handler and stack tests on a tree identical to the snapshot;
a throwaway script outside the repository ran the real `saidYesTo`, `asksToSaveLeads` and `parseFinalMessage`. No AWS,
Bedrock or network calls; `pnpm agent:golden` not run.

**Score: 78/100, no blockers.** B1, B3, B4 and the caps are sound and tested. B2 holds on security but infers consent
from chat text.

## Should-fix

1. **A follow-up counts as a yes, and the model is told to save** (`tools.ts:222,246-251`, `turn.ts:174-182,204-206`,
   `prompt.ts:43-45`). The yes pattern is anchored only at the start: "Please show me open permits in Manor instead",
   "OK, now show me Pflugerville" and "go ahead and search Manor" load the recorded offer, and the turn adds "The user
   said yes to your offer… Save them with create_lead". Before B2 a false yes still needed a new search.
2. **A missing or malformed `SAVE_OFFER` line fails silently** (`prompt.ts:97`, `turn.ts:375-385`, `tools.ts:556-558`).
   "SAVE OFFER:" and "- SAVE_OFFER: [[…]]" stay in the answer as text; a line without citation tokens records nothing; a
   failed write only sets `offer_error`. The answer still asks "Save it?" and the yes is refused: F5 item 4's dead end.
3. **The explicit-ask pattern opens too easily** (`tools.ts:216-221,234-239`, unchanged since F5). "add 2 miles to the
   radius", "Put it on the map" and "Track permits open more than 5 years" pass, so the model is the only gate. Count
   add, create, put, store and track only together with "lead(s)", "CRM" or "my list".
4. **The golden set needs cases** for an offer, a yes after it, a yes with no offer, and an ordinary follow-up after an
   offer; prompt `.3` has not run against it.

## Recommended design

The confirmation is a pattern over free text plus a hash of echoed prose. The routing rule
(`build-ai-agents`, `implementation-request-contracts-and-routing`) asks for a typed contract, and the review rule in
`build-rag-systems` for an explicit accept control. Simpler and safer: return the offer as a `save_offer` field of the
chat response (the same filter: ids a tool returned this turn, at most 5, cited in the answer) and show a "Save N as
leads" button on the Assistant page that calls the existing `leads.createMany` route. That removes the `#agent-offer`
items, the TTL, `offerKey`, `saidYesTo`, the extra system message and a 7–19 s model turn per save; a bad `SAVE_OFFER`
line then means no button instead of a dead-end yes. In scope: the README asks that matches convert to leads and that
the agent answers queries.

Security of the reviewed design, for the record: the key includes the ULID-checked workspace (a yes from another
workspace saves nothing, tested); the echoed answer is only hashed, and the system message is built from stored ids;
ids are filtered against the offering turn's tool results and checked again at save; a replay within 60 minutes only
re-saves the same leads.

## Nits

- `offers.ts:45-47`: raw workspace ids sit in one shared partition; key by a hash of workspace and text.
- `leads-api.ts:94,136`: the generic TTL attribute name `expires_at` on the user-data table could delete a future lead
  field of that name.
- `turn.ts:378`: the offer write has no deadline after a loop that can end at 23 s.
- `turn.ts:375`: keep only offered records the answer cites.
- `tools.ts:302`: `tools: ToolSet` widens the typed registry back to the generic type; export the inferred type.
- `leads-api.ts:91`: an `AGENT_DAILY_TOKENS` override leaves the alarm at 3.75M; derive both from one value.

## Notes

- B1: each tool's `execute` gets its own input type through mapped types and one generic `register`; the literal
  registry is checked with `satisfies`; no casts and no change in behaviour.
- B3: 2 + ⌈0.5 × 29⌉ = 17 concurrent calls, so 25 leaves 8; the account reserves 35. The 8 assume a warm pipeline.
- B4: four syntheses in `beforeAll` with a 60 s timeout; the tests only read the templates.
- Caps: the alarm is three quarters of the cap; about $25 a day holds (0.75M output tokens at $15/M plus 4.25M input at
  $3/M). The budget is global: one caller at 0.5 a second uses 500 turns in about 17 minutes; a per-IP sub-cap is the
  next step.

## Resolution

Accepted on 2026-10-21: the recommended design (a `save_offer` field and a "Save N as leads" button over
`leads.createMany`) replaces the recorded offers, so findings 1 and 2 and the first three nits fall away with them;
finding 3, finding 4 (for the button design) and the last three nits are fixed in the same increment. Recorded in
`docs/decisions.md`.
