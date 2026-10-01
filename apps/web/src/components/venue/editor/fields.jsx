import React, { useEffect, useId, useState } from 'react';

const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs';

export function Field({ label, hint, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] text-slate-500 font-semibold mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

/** Number input that commits on every valid edit and tolerates an empty box while typing. */
export function NumberField({ label, value, onChange, min, max, step = 1, hint, disabled }) {
  const id = useId();
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  return (
    <Field label={label} hint={hint} id={id}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className={`${inputClass} font-mono`}
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(min != null || max != null ? Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)) : v);
        }}
        onBlur={() => setText(String(value ?? ''))}
      />
    </Field>
  );
}

export function TextField({ label, value, onChange, hint, maxLength = 60, placeholder }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <input id={id} className={inputClass} value={value ?? ''} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SelectField({ label, value, onChange, options, hint }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Segmented({ label, value, onChange, options }) {
  return (
    <div>
      <span className="block text-[10px] text-slate-500 font-semibold mb-1">{label}</span>
      <div className="inline-flex p-0.5 rounded-xl bg-slate-100 border border-slate-200" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${value === o.value ? 'bg-white text-[#16a34a] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** In-page confirmation (no browser dialogs). */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'Cancel', tone = 'default', onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-labelledby="tl-confirm-title">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl space-y-4 text-xs text-slate-700">
        <h2 id="tl-confirm-title" className="text-sm font-bold text-slate-900">{title}</h2>
        <div className="space-y-2 leading-relaxed">{body}</div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} autoFocus className="px-4 py-2 rounded-xl border border-slate-200 font-semibold hover:bg-slate-50">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} className={tone === 'danger' ? 'px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold' : 'px-4 py-2 btn-eventfrog text-xs'}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
