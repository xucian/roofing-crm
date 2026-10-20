import { describe, expect, it } from 'vitest';
import { PipelineError } from './errors';
import { serializeFetch } from './serialize';

/** A fetch whose calls stay open until the test settles them, recording the order they started in. */
function controlledFetch() {
  const started: string[] = [];
  const pending = new Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }>();
  const fetch = (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    started.push(url);
    return new Promise<Response>((resolve, reject) => {
      pending.set(url, { resolve, reject });
    });
  };
  const settle = (url: string, outcome: 'ok' | 'fail'): void => {
    const call = pending.get(url);
    if (!call) throw new Error(`${url} has not started`);
    if (outcome === 'ok') call.resolve(new Response('{}'));
    else call.reject(new Error('boom'));
  };
  return { fetch, started, settle };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('serializeFetch', () => {
  it('runs one call at a time, in order', async () => {
    const { fetch, started, settle } = controlledFetch();
    const serial = serializeFetch(fetch);
    const a = serial('a');
    const b = serial('b');
    const c = serial('c');
    await tick();
    expect(started).toEqual(['a']);
    settle('a', 'ok');
    await a;
    await tick();
    expect(started).toEqual(['a', 'b']);
    settle('b', 'ok');
    await b;
    await tick();
    expect(started).toEqual(['a', 'b', 'c']);
    settle('c', 'ok');
    await expect(c).resolves.toBeInstanceOf(Response);
  });

  it('frees the slot when a call fails', async () => {
    const { fetch, started, settle } = controlledFetch();
    const serial = serializeFetch(fetch);
    const a = serial('a');
    const b = serial('b');
    await tick();
    settle('a', 'fail');
    await expect(a).rejects.toThrow('boom');
    await tick();
    expect(started).toEqual(['a', 'b']);
    settle('b', 'ok');
    await expect(b).resolves.toBeInstanceOf(Response);
  });

  it('drops a waiting call whose signal aborts, without holding up the next', async () => {
    const { fetch, started, settle } = controlledFetch();
    const serial = serializeFetch(fetch);
    const controller = new AbortController();
    const a = serial('a');
    const b = serial('b', { signal: controller.signal });
    const c = serial('c');
    controller.abort();
    const error: unknown = await b.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).kind).toBe('aborted');
    settle('a', 'ok');
    await a;
    await tick();
    expect(started).toEqual(['a', 'c']);
    settle('c', 'ok');
    await expect(c).resolves.toBeInstanceOf(Response);
  });

  it('never starts a call whose signal already aborted', async () => {
    const { fetch, started } = controlledFetch();
    const serial = serializeFetch(fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(serial('a', { signal: controller.signal })).rejects.toBeInstanceOf(PipelineError);
    expect(started).toEqual([]);
  });
});
