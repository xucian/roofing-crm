import { describe, expect, it } from 'vitest';
import {
  PinSchema,
  assertOpenApi31,
  generatedBanner,
  isPinSet,
  parsePin,
  rawGithubUrl,
  readPin,
  sha256Hex,
  type SetPin,
} from './pin-lib';

const pending = {
  repository: 'https://github.com/xucian/oracle-property-intelligence-platform-pipeline-travis-tx',
  apiBase: 'https://abc123.execute-api.us-east-2.amazonaws.com',
  contractFrozenAt: 'de08901',
  commit: null,
  path: null,
  sha256: null,
};
const set: SetPin = {
  ...pending,
  commit: 'a'.repeat(40),
  path: 'packages/contract/openapi.json',
  sha256: 'b'.repeat(64),
};

describe('PinSchema', () => {
  it('accepts a pending pin and a complete one', () => {
    expect(isPinSet(PinSchema.parse(pending))).toBe(false);
    expect(isPinSet(PinSchema.parse(set))).toBe(true);
  });

  it('rejects a half-set pin, a short commit and an escaping path', () => {
    expect(PinSchema.safeParse({ ...pending, commit: 'a'.repeat(40) }).success).toBe(false);
    expect(PinSchema.safeParse({ ...set, commit: 'abc1234' }).success).toBe(false);
    expect(PinSchema.safeParse({ ...set, path: '../secrets/openapi.json' }).success).toBe(false);
    expect(PinSchema.safeParse({ ...set, path: '/etc/openapi.json' }).success).toBe(false);
  });

  it('requires apiBase as an https URL without a trailing slash', () => {
    const withoutApiBase: Partial<SetPin> = { ...set };
    delete withoutApiBase.apiBase;
    expect(PinSchema.safeParse(withoutApiBase).success).toBe(false);
    expect(PinSchema.safeParse({ ...set, apiBase: 'http://abc123.example.org' }).success).toBe(
      false,
    );
    expect(PinSchema.safeParse({ ...set, apiBase: `${set.apiBase}/` }).success).toBe(false);
    expect(PinSchema.safeParse({ ...set, apiBase: `${set.apiBase}?stage=1` }).success).toBe(false);
  });

  it('parses the committed pin file', () => {
    const pin = readPin();
    expect(pin.contractFrozenAt).toBe('de08901');
    expect(pin.apiBase).toMatch(/^https:\/\/[a-z0-9]+\.execute-api\.us-east-2\.amazonaws\.com$/);
    expect(parsePin(JSON.stringify(pin))).toEqual(pin);
  });
});

describe('helpers', () => {
  it('hashes bytes as hex sha256', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts OpenAPI 3.1 only', () => {
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(assertOpenApi31(encode({ openapi: '3.1.0' })).openapi).toBe('3.1.0');
    expect(() => assertOpenApi31(encode({ openapi: '3.0.3' }))).toThrow(/3\.1/);
    expect(() => assertOpenApi31(encode(['openapi']))).toThrow(/object/);
  });

  it('builds the raw GitHub URL at the commit with each path segment encoded', () => {
    expect(rawGithubUrl(set.repository, set.commit, 'packages/contract/open api.json')).toBe(
      `https://raw.githubusercontent.com/xucian/oracle-property-intelligence-platform-pipeline-travis-tx/${set.commit}/packages/contract/open%20api.json`,
    );
    expect(() => rawGithubUrl('https://gitlab.com/a/b', set.commit, 'x')).toThrow();
  });

  it('traces generated files to the pinned bytes', () => {
    expect(generatedBanner(set)).toContain(
      `at ${set.commit}, packages/contract/openapi.json (sha256 ${set.sha256})`,
    );
  });
});
