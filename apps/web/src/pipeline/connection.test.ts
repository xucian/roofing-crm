import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPipelineConnection, describeRetry } from './connection';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createPipelineConnection', () => {
  it('announces a throttle for its back-off only', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? Response.json({ message: 'Too Many Requests' }, { status: 429 })
          : Response.json({ items: [] }),
      );
    });
    const connection = createPipelineConnection('https://pipeline.example.org');
    const seen: (string | null)[] = [];
    connection.retries.subscribe(() => {
      seen.push(connection.retries.current()?.reason ?? null);
    });

    const pending = connection.client.searchCenters('fixture');
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.retries.current()).toMatchObject({ reason: 'throttled', delayMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ data: { items: [] } });
    expect(connection.retries.current()).toBeNull();
    expect(seen).toEqual(['throttled', null]);
    expect(calls).toBe(2);
  });

  it('runs one call at a time', async () => {
    const started: string[] = [];
    const answers: (() => void)[] = [];
    vi.stubGlobal('fetch', (request: Request) => {
      started.push(new URL(request.url).pathname);
      return new Promise<Response>((resolve) => {
        answers.push(() => {
          resolve(Response.json({ items: [] }));
        });
      });
    });
    const { client } = createPipelineConnection('https://pipeline.example.org');
    const first = client.searchCenters('a');
    const second = client.searchCenters('b');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(1);
    answers[0]?.();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toHaveLength(2);
    answers[1]?.();
    await second;
  });
});

describe('describeRetry', () => {
  it('says what happened and how long until the next attempt', () => {
    const base = { url: 'u', attempt: 1 };
    expect(describeRetry({ ...base, reason: 'throttled', delayMs: 2000, status: 429 })).toBe(
      'The pipeline API is busy (HTTP 429). Retrying in 2 s…',
    );
    expect(describeRetry({ ...base, reason: 'server_error', delayMs: 300, status: 503 })).toBe(
      'The pipeline API answered HTTP 503. Retrying in 0.3 s…',
    );
    expect(describeRetry({ ...base, reason: 'network', delayMs: 1000 })).toBe(
      'The pipeline API could not be reached. Retrying in 1 s…',
    );
  });
});
