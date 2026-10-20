import { useEffect, useState } from 'react';
import { WakeHint } from './WakeHint';

export interface PipelineWaitProps {
  /** "Searching the pipeline…" */
  title: string;
  /** What the wake hint calls the call: "search", "property lookup". */
  what: string;
  /** False while the call waits in the queue behind another; the clock starts when it is sent. */
  started: boolean;
}

/** A pipeline call in progress: a cold pipeline can take several seconds, so the wait is counted and explained. */
export function PipelineWait({ title, what, started }: PipelineWaitProps) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!started) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [started]);
  return (
    <div className="results-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <p className="results-loading-title">
          {title}
          {seconds > 0 ? ` ${String(seconds)} s` : null}
        </p>
        {started ? <WakeHint what={what} /> : null}
      </div>
    </div>
  );
}
