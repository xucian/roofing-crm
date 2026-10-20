import type { PipelineClient, SearchCenter } from '@roofing-crm/pipeline-client';
import { useEffect, useRef, useState } from 'react';
import { ErrorDetails } from '../app/ErrorDetails';
import { choosePlace, describePlace } from './place-choice';

type PlaceState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'ask'; centers: SearchCenter[] }
  | { status: 'none'; q: string }
  | { status: 'chosen'; center: SearchCenter }
  | { status: 'failed'; error: unknown };

export interface PlaceBoxProps {
  /** Null when the deployment has no pipeline API. */
  client: PipelineClient | null;
  /** Whether the search is still on the chosen place; a pin or GPS fix since then hides it. */
  centered: boolean;
  onChoose: (center: SearchCenter) => void;
}

/**
 * City or ZIP to search center, through the pipeline's `/v1/search-centers` (docs/decisions.md §7):
 * centers are parcel centroids of the loaded roll, never an outside geocoder.
 */
export function PlaceBox({ client, centered, onChoose }: PlaceBoxProps) {
  const [text, setText] = useState('');
  const [state, setState] = useState<PlaceState>({ status: 'idle' });
  const inFlight = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  const choose = (center: SearchCenter): void => {
    setState({ status: 'chosen', center });
    onChoose(center);
  };

  const lookUp = (q: string): void => {
    if (!client) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setState({ status: 'searching' });
    client.searchCenters(q, { signal: controller.signal }).then(
      ({ data }) => {
        const choice = choosePlace(data.items);
        if (choice.kind === 'go') choose(choice.center);
        else if (choice.kind === 'ask') setState({ status: 'ask', centers: choice.centers });
        else setState({ status: 'none', q });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'failed', error });
      },
    );
  };

  return (
    <div className="place-box">
      <form
        className="field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const q = text.trim();
          if (q) lookUp(q);
        }}
      >
        <label className="field-label" htmlFor="place">
          City or ZIP
        </label>
        <div className="field-row">
          <input
            id="place"
            className="field-input field-input--wide"
            type="search"
            autoComplete="off"
            placeholder="Pflugerville or 78704"
            value={text}
            disabled={!client}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <button
            type="submit"
            className="button"
            disabled={!client || state.status === 'searching' || text.trim() === ''}
          >
            {state.status === 'searching' ? 'Finding…' : 'Go'}
          </button>
        </div>
      </form>

      {state.status === 'chosen' && centered ? (
        <p className="field-hint" role="status">
          Centered on {describePlace(state.center)}.
        </p>
      ) : null}
      {state.status === 'none' ? (
        <p className="field-hint" role="status">
          No city or ZIP in Travis County matches “{state.q}”.
        </p>
      ) : null}
      {state.status === 'failed' ? (
        <div className="field-hint" role="alert">
          <ErrorDetails error={state.error} />
        </div>
      ) : null}
      {state.status === 'ask' ? (
        <fieldset className="place-choices">
          <legend className="field-hint">
            {state.centers.some((center) => center.match_type === 'exact')
              ? 'Several places match. Which did you mean?'
              : 'No exact match. Which place did you mean?'}
          </legend>
          {state.centers.map((center) => (
            <button
              key={`${center.kind}:${center.name}`}
              type="button"
              className="place-choice"
              onClick={() => {
                choose(center);
              }}
            >
              {describePlace(center)}
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
