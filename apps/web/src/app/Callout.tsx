import type { ReactNode } from 'react';

export type CalloutTone = 'info' | 'warning' | 'error';

export interface CalloutProps {
  tone: CalloutTone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}

export function Callout({ tone, title, children, onDismiss }: CalloutProps) {
  return (
    <div className={`callout callout--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="callout-content">
        {title ? <p className="callout-title">{title}</p> : null}
        <div className="callout-body">{children}</div>
      </div>
      {onDismiss ? (
        <button type="button" className="callout-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </div>
  );
}
