import type { Contractor } from '@roofing-crm/pipeline-client';
import { fixturePermit } from '@roofing-crm/pipeline-client/testing';
import { describe, expect, it } from 'vitest';
import { applyBedrockPromptCaching } from './bedrock-prompt-cache';
import { checkCitations } from './citations';
import { EvidenceCollector } from './evidence';
import { CircuitBreaker } from './governor';
import { CoordinateGuard, typedNumbers } from './guard';
import { clearHistory, hideForTrace, registerHistory, registerPin } from './langsmith';
import { projectContractor, projectPermitPage } from './projection';
import { parseFinalMessage } from './prompt';
import { sanitizeAnswer } from './sanitize';
import { logParams } from './service';
import { asksToSaveLeads, offeredLeads } from './tools';

// The agent's small rules, one table each (alakazam F5 review item 11, and the probes of items 2 to 9).

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });

describe('the explicit ask to save leads', () => {
  it.each([
    ['save the first two', true],
    ['Yes, save them', true],
    ['Add these to my leads', true],
    ['Save 1981-013092 BP as a lead', true],
    ['save the first two as leads', true],
    ['add them to my list', true],
    ['create leads for both', true],
    ['Bookmark the first one', true],
    ['Put both in the CRM', true],
    ["Don't save any leads, just list them", false],
    ['Which leads should I keep an eye on?', false],
    ['Show me open roofing permits near Austin', false],
    // Add, create, put, store and track save only together with leads, the CRM or "my list".
    ['add 2 miles to the radius', false],
    ['Put it on the map', false],
    ['Track permits open more than 5 years', false],
    ['Create a list of the oldest roofs', false],
  ])('"%s" → %s', (text, expected) => {
    expect(asksToSaveLeads([user(text)])).toBe(expected);
  });

  it('never reads a bare yes as an ask, whatever the answer before it says about saving', () => {
    const mentions = assistant('To save one, say "save … as a lead". Shall I widen the search?');
    expect(asksToSaveLeads([user('Long-open permits?'), mentions, user('yes')])).toBe(false);
  });
});

describe('the SAVE_OFFER line', () => {
  it('goes to the server wherever the model writes it, never into the answer', () => {
    expect(
      parseFinalMessage(
        'OUTCOME: answered\nSAVE_OFFER: [[permit:FX-1 BP]] [[property:fx-2]]\n\nTwo match. Save them?',
      ),
    ).toEqual({
      outcome: 'answered',
      assumptions: [],
      saveOffer: [
        { kind: 'permit', id: 'FX-1 BP' },
        { kind: 'property', id: 'fx-2' },
      ],
      answer: 'Two match. Save them?',
    });
    const trailing = parseFinalMessage(
      'OUTCOME: answered\n\nOne match.\n**SAVE_OFFER:** [[property:fx-1]]',
    );
    expect(trailing).toMatchObject({
      saveOffer: [{ kind: 'property', id: 'fx-1' }],
      answer: 'One match.',
    });
  });

  it('takes tolerant forms of the line, and tells a line without tokens from no line', () => {
    for (const line of [
      'SAVE OFFER: [[property:fx-1]]',
      '- SAVE_OFFER: [[property:fx-1]]',
      '* save_offer: [[property:fx-1]]',
      '__SAVE_OFFER__: [[property:fx-1]]',
    ]) {
      expect(parseFinalMessage(`OUTCOME: answered\n${line}\n\nOne match.`)).toMatchObject({
        saveOffer: [{ kind: 'property', id: 'fx-1' }],
        answer: 'One match.',
      });
    }
    expect(parseFinalMessage('OUTCOME: answered\nSAVE_OFFER: the first one\n\nOne.')).toMatchObject(
      { saveOffer: [], answer: 'One.' },
    );
    expect(parseFinalMessage('OUTCOME: answered\n\nSave offers vary.')).toMatchObject({
      saveOffer: null,
      answer: 'Save offers vary.',
    });
  });

  it('keeps the cited records a tool returned in this turn, each lead once, at most 5', () => {
    const evidence = new EvidenceCollector('run-1');
    evidence.addPermits('t1', [
      fixturePermit(1),
      fixturePermit(2, { property_id: 'fx-2' }),
      ...[3, 4, 5, 6].map((n) => fixturePermit(n, { property_id: `fx-${String(n)}` })),
    ]);
    const lead = (property_id: string, permit_id = '') => ({ property_id, permit_id });
    const cite = (kind: string, id: string) => ({ kind, id });
    expect(
      offeredLeads(
        [
          cite('permit', 'FX-1 BP'),
          cite('permit', 'FX-1 BP'),
          cite('property', 'fx-2'),
          cite('property', 'fx-77'),
          cite('permit', 'FX-99 BP'),
          cite('contractor', 'FX-1 BP'),
          // Returned by the search, but the answer does not cite it.
          cite('permit', 'FX-3 BP'),
        ],
        evidence,
        [cite('permit', 'FX-1 BP'), cite('property', 'fx-2'), cite('property', 'fx-77')],
      ),
    ).toEqual([lead('fx-1', 'FX-1 BP'), lead('fx-2')]);
    const many = [1, 2, 3, 4, 5, 6].map((n) => cite('permit', `FX-${String(n)} BP`));
    expect(offeredLeads(many, evidence, many)).toHaveLength(5);
  });
});

describe('what the model sees of a permit', () => {
  it('flags a permit listed as open with a completed date, and only that one', () => {
    const page = projectPermitPage({
      items: [
        fixturePermit(1, { open_duration_days: 10151, completed_date: '1999-07-04' }),
        fixturePermit(2),
      ],
      total: 2,
      next_cursor: null,
    }) as { items: Record<string, unknown>[] };
    expect(page.items[0]).toMatchObject({
      permit_id: 'FX-1 BP',
      status_group: 'open',
      completed_date: '1999-07-04',
      completion_conflict: true,
    });
    expect(page.items[1]).not.toHaveProperty('completion_conflict');
  });

  it('gives a permit with a completion conflict no open duration, so it cannot read "open 27 years"', () => {
    const page = projectPermitPage({
      items: [
        fixturePermit(1, {
          status_group: 'stalled',
          open_duration_days: 10151,
          days_since_expiry: 9000,
          completed_date: '1999-07-04',
        }),
        fixturePermit(2),
      ],
      total: 2,
      next_cursor: null,
    }) as { items: Record<string, unknown>[] };
    for (const field of [
      'open_duration_days',
      'open_since',
      'open_duration_as_of',
      'days_since_expiry',
    ]) {
      expect(page.items[0]).not.toHaveProperty(field);
    }
    expect(page.items[0]).toMatchObject({ issued_date: '2021-04-01', expires_date: '2022-04-01' });
    expect(page.items[1]).toMatchObject({
      open_duration_days: 2000,
      open_since: '2021-04-01',
      open_duration_as_of: '2026-10-20',
    });
  });

  it('keeps a contractor phone only when it has 10 digits, never an area code alone', () => {
    const contractor = fixturePermit(1).contractor!;
    const page = projectPermitPage({
      items: [
        fixturePermit(1, { contractor: { ...contractor, phone: '512' } }),
        fixturePermit(2, { contractor: { ...contractor, phone: '(000) 000-0000' } }),
      ],
      total: 2,
      next_cursor: null,
    }) as { items: { contractor: { phone: string | null } }[] };
    expect(page.items.map((item) => item.contractor.phone)).toEqual([null, '(000) 000-0000']);
    const grouped: Contractor = {
      contractor_attribution_key: 'fx-key-1',
      identity_status: 'source_name_attribution',
      company_name: 'FIXTURE ROOFING CO',
      printed_names: ['FIXTURE ROOFER'],
      trade: 'General Contractor',
      phone: '512',
      address: null,
      permit_count: 3,
      open_permit_count: 1,
      roofing_permit_count: 2,
      needs_review_permit_count: 0,
      registry_candidates: [],
      license_candidates: null,
      official_identity: null,
      bbb: fixturePermit(1).bbb,
    };
    expect(projectContractor(grouped)).toMatchObject({ phone: null });
  });
});

describe('the citation check', () => {
  it('lets the answer name an id a lookup found missing, never cite it', () => {
    const evidence = new EvidenceCollector('run-1');
    evidence.addMissing('permit', '2019-012345 BP');
    expect(checkCitations('Permit 2019-012345 BP is not in this dataset.', evidence).ok).toBe(true);
    expect(checkCitations('See [[permit:2019-012345 BP]].', evidence).ok).toBe(false);
    expect(checkCitations('Permit 2019-099999 BP is open.', evidence).ok).toBe(false);
  });

  it("cites the turn's run without get_run_summary, and no other run", () => {
    const evidence = new EvidenceCollector('run-1');
    expect(checkCitations('Data from [[run:run-1]].', evidence).ok).toBe(true);
    expect(checkCitations('Data from [[run:run-0]].', evidence).ok).toBe(false);
  });
});

describe('typed coordinates', () => {
  it('reads a Unicode minus and N/S/E/W, and tolerates the model rounding them', () => {
    expect(typedNumbers('30.267183, −97.743100')).toEqual([30.267183, -30.267183, -97.7431]);
    expect(typedNumbers('30.2672 N 97.7431 W')).toEqual([30.2672, -97.7431]);
    const guard = new CoordinateGuard(['around 30.267183, -97.743100'], null);
    expect(guard.check(30.2672, -97.7431)).toMatchObject({ ok: true, pin: false });
    expect(guard.check(30.4, -97.7431)).toMatchObject({ ok: false });
  });
});

describe('the answer sanitizer', () => {
  it('drops HTML, images, link targets and bold, and keeps the text', () => {
    expect(
      sanitizeAnswer(
        '**139** permits <b>open</b> ![x](https://e.example/x.png) see [the list](https://e.example) or https://e.example/a',
      ),
    ).toBe('139 permits open see the list or');
  });
});

describe('what reaches a trace', () => {
  it('hashes earlier messages whole, short ones only as the whole value, and hides the pin', () => {
    registerHistory(['Austin', 'Show me every open roofing permit within five miles of Austin']);
    registerPin({ lat: 30.2672, lon: -97.7431 });
    const traced = hideForTrace({
      input: 'Now open permits in Austin older than 5 years',
      history: ['Austin', 'Show me every open roofing permit within five miles of Austin'],
      prompt: 'The pin is at lat 30.2672, lon -97.7431.',
      args: { lat: 30.2672, lon: -97.7431, radius_miles: 5 },
      owner_name: 'FIXTURE OWNER',
    }) as Record<string, unknown>;
    clearHistory();
    expect(traced.input).toBe('Now open permits in Austin older than 5 years');
    expect(traced.history).toEqual([
      expect.stringMatching(/^\[earlier message sha256:/) as string,
      expect.stringMatching(/^\[earlier message sha256:/) as string,
    ]);
    expect(traced.prompt).toBe('The pin is at lat [map pin], lon [map pin].');
    expect(traced.args).toEqual({ lat: '[map pin]', lon: '[map pin]', radius_miles: 5 });
    expect(traced.owner_name).toBe('[hidden]');
  });
});

describe('the tool-call log line', () => {
  it('never logs a point, hashes free text, keeps ids and numbers', () => {
    expect(
      logParams({
        q: 'hail damage',
        lat: 30.2672,
        lon: -97.7431,
        radius_miles: 2,
        within: { lat: 30.2, lon: -97.7, radius_miles: 1 },
        property_id: '103857',
      }),
    ).toEqual({
      q: expect.stringMatching(/^sha256:[0-9a-f]{16}$/) as string,
      lat: '[point]',
      lon: '[point]',
      radius_miles: 2,
      within: { lat: '[point]', lon: '[point]', radius_miles: 1 },
      property_id: '103857',
    });
  });
});

describe('Bedrock prompt caching', () => {
  it('marks the first system message and the last non-system one, keeping other options', () => {
    const { prompt, cachePointsAdded } = applyBedrockPromptCaching([
      { role: 'system', content: 'run prompt', providerOptions: { other: { x: 1 } } },
      { role: 'system', content: 'pin line' },
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
    ] as never);
    expect(cachePointsAdded).toBe(2);
    expect(prompt[0]?.providerOptions).toEqual({
      other: { x: 1 },
      bedrock: { cachePoint: { type: 'default' } },
    });
    expect(prompt[1]?.providerOptions).toBeUndefined();
    expect(prompt[2]?.providerOptions).toEqual({ bedrock: { cachePoint: { type: 'default' } } });
  });
});

describe('the circuit breaker', () => {
  it('opens after 3 failed turns, lets one probe through after 30 s, closes on success', () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 30_000, () => now);
    for (let n = 0; n < 3; n += 1) breaker.failure();
    expect(breaker.allow()).toBe(false);
    now = 30_001;
    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(false);
    breaker.success();
    expect(breaker.state).toBe('closed');
    expect(breaker.allow()).toBe(true);
  });
});
