import { useState } from 'react';

export interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
  /** Called with every in-range value while typing, and with whatever was typed on blur (the caller clamps). */
  onCommit: (value: number) => void;
}

/** A number input that lets the user type freely ("0." on the way to "0.5") and commits valid values. */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onCommit,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-row">
        <input
          id={id}
          className="field-input"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          aria-describedby={hintId}
          onFocus={() => {
            setDraft(String(value));
          }}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const parsed = Number(text);
            if (text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
              onCommit(parsed);
            }
          }}
          onBlur={() => {
            if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) {
              onCommit(Number(draft));
            }
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span className="field-unit">{unit}</span>
      </div>
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
