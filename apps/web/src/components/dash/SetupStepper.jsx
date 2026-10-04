import React from 'react';
import { Check } from 'lucide-react';

// The five steps of setting up a new event. Steps 1–3 are the create form, 4 is the venue editor,
// 5 is Review & submit (preview and send to admins for approval).
export const SETUP_STEPS = [
  { label: 'Event details' },
  { label: 'Event images' },
  { label: 'Tickets & pricing' },
  { label: 'Seating plan' },
  { label: 'Review & submit' },
];

/**
 * Wizard stepper. `current` is the 0-based active step. `onSelect(i)` makes a step clickable;
 * `isSelectable(i)` limits which ones (default: any step other than the current one).
 */
export default function SetupStepper({ steps = SETUP_STEPS, current, onSelect, isSelectable = (i) => i !== current }) {
  return (
    <ol className="tl-wz-steps" aria-label="Steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, maxWidth: steps.length > 3 ? 820 : 640 }}>
      {steps.map((s, i) => {
        const clickable = Boolean(onSelect) && isSelectable(i);
        return (
          <li key={s.label} style={{ display: 'grid' }}>
            <button
              type="button"
              className={`tl-wz-step${i === current ? ' is-current' : i < current ? ' is-done' : ''}`}
              onClick={clickable ? () => onSelect(i) : undefined}
              disabled={!clickable}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="tl-wz-dot">{i < current ? <Check className="w-4 h-4" /> : i + 1}</span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
