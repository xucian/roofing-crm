import type { Meta, PipelineClient } from '@roofing-crm/pipeline-client';
import { useEffect, useState } from 'react';

export type MetaState =
  | { status: 'waiting' }
  | { status: 'ready'; meta: Meta; requestId: string | undefined }
  | { status: 'failed'; error: unknown };

/**
 * The pipeline's `/v1/meta`, read once `start` turns true. The app starts it after the first search
 * settles, so on a cold pipeline the map's search is first in the one-at-a-time queue.
 */
export function useMeta(client: PipelineClient | null, start: boolean): MetaState {
  const [state, setState] = useState<MetaState>({ status: 'waiting' });
  useEffect(() => {
    if (!client || !start) return undefined;
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
  }, [client, start]);
  return state;
}
