import type { Meta, PipelineClient } from '@roofing-crm/pipeline-client';
import { useEffect, useState } from 'react';

export type MetaState =
  | { status: 'waiting' }
  | { status: 'ready'; meta: Meta; requestId: string | undefined }
  | { status: 'failed'; error: unknown };

/**
 * The pipeline's `/v1/meta`, read as soon as the page opens. It is the pipeline's cheapest call, so
 * on an idle pipeline it pays the cold start, and the first search, queued behind it in the
 * one-at-a-time queue, lands on the warm instance (pipeline decisions §31).
 */
export function useMeta(client: PipelineClient | null): MetaState {
  const [state, setState] = useState<MetaState>({ status: 'waiting' });
  useEffect(() => {
    if (!client) return undefined;
    const controller = new AbortController();
    client.getMeta({ signal: controller.signal }).then(
      ({ data, requestId }) => {
        setState({ status: 'ready', meta: data, requestId });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'failed', error });
      },
    );
    return () => {
      controller.abort();
    };
  }, [client]);
  return state;
}
