import { useEffect, useState } from 'react';

/** A pipeline call slower than this gets an explanation (pipeline decisions §31). */
export const WAKE_HINT_AFTER_MS = 3000;

/**
 * Why a call is slow: after a quiet period the pipeline starts its data service on the first
 * request, about 5 s and up to about 15 s, and keeps no warm instance, since that would cost money
 * while idle. Shown only while the call is still running, once it has taken longer than about 3 s.
 */
export function WakeHint({ what }: { what: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShown(true);
    }, WAKE_HINT_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  if (!shown) return null;
  return (
    <p className="field-hint">
      The first {what} after a quiet period starts the pipeline&apos;s data service, which takes up
      to about 15 seconds.
    </p>
  );
}
