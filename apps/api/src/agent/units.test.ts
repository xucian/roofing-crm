import { describe, expect, it } from 'vitest';
import { applyBedrockPromptCaching } from './bedrock-prompt-cache';
import { checkCitations } from './citations';
import { EvidenceCollector } from './evidence';
import { CircuitBreaker } from './governor';
import { CoordinateGuard, typedNumbers } from './guard';
import { clearHistory, hideForTrace, registerHistory, registerPin } from './langsmith';
import { sanitizeAnswer } from './sanitize';
import { logParams } from './service';
import { asksToSaveLeads } from './tools';

// The agent's small rules, one table each (alakazam F5 review item 11, and the probes of items 2 to 9).

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string) => ({ role: 'assistant', content });

describe('the explicit ask to save leads', () => {
  it.each([
    ['save the first two', true],
    ['Yes, save them', true],
    ['Add these to my leads', true],
    ['Save 1981-013092 BP as a lead', true],
    ["Don't save any leads, just list them", false],
    ['Which leads should I keep an eye on?', false],
    ['Show me open roofing permits near Austin', false],
  ])('"%s" → %s', (text, expected) => {
    expect(asksToSaveLeads([user(text)])).toBe(expected);
  });

  it("takes a yes to the assistant's own offer to save", () => {
    const offer = assistant('Two permits match. Shall I save them as leads?');
    expect(asksToSaveLeads([user('Long-open permits?'), offer, user('yes please')])).toBe(true);
    expect(
      asksToSaveLeads([user('Long-open permits?'), assistant('Two match.'), user('yes')]),
    ).toBe(false);
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
