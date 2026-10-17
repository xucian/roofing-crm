import { describe, expect, it } from 'vitest';
import { PERMISSIONS_POLICY, contentSecurityPolicy, normalizePipelineApiBase } from './hosting';

describe('normalizePipelineApiBase', () => {
  it('keeps an https execute-api URL and strips the trailing slash', () => {
    expect(normalizePipelineApiBase(' https://abc123.execute-api.us-east-2.amazonaws.com/ ')).toBe(
      'https://abc123.execute-api.us-east-2.amazonaws.com',
    );
  });

  it('accepts http for localhost only', () => {
    expect(normalizePipelineApiBase('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(() => normalizePipelineApiBase('http://api.example.com')).toThrow(/https/);
  });

  it('rejects relative URLs, queries, fragments and credentials', () => {
    expect(() => normalizePipelineApiBase('/v1')).toThrow(/absolute/);
    expect(() => normalizePipelineApiBase('https://api.example.com/?x=1')).toThrow(/query/);
    expect(() => normalizePipelineApiBase('https://api.example.com/#x')).toThrow(/fragment/);
    expect(() => normalizePipelineApiBase('https://user:pw@api.example.com')).toThrow(
      /credentials/,
    );
  });
});

describe('contentSecurityPolicy', () => {
  it('allows only the own origin and the pipeline API, with no unsafe sources', () => {
    const policy = contentSecurityPolicy({
      connectOrigins: ['https://abc123.execute-api.us-east-2.amazonaws.com'],
      upgradeInsecureRequests: true,
    });
    expect(policy).toContain(
      "connect-src 'self' https://abc123.execute-api.us-east-2.amazonaws.com",
    );
    expect(policy).toContain("worker-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('upgrade-insecure-requests');
    expect(policy).not.toMatch(/unsafe-/);
  });

  it('omits the upgrade directive for a local http preview and dedupes origins', () => {
    const policy = contentSecurityPolicy({
      connectOrigins: ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
      upgradeInsecureRequests: false,
    });
    expect(policy).not.toContain('upgrade-insecure-requests');
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:3000;");
  });

  it('allows geolocation for the page itself only', () => {
    expect(PERMISSIONS_POLICY).toContain('geolocation=(self)');
  });
});
