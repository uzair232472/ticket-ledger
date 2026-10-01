import React, { useMemo, useState } from 'react';
import { AlertTriangle, Ban, Copy, Lock, Plus, Trash2, Wand2 } from 'lucide-react';
import { DEFAULT_GA, DEFAULT_ROWS, DEFAULT_TABLES, LIMITS, fitRows, maxRows, maxSeatsInRow, rowLabel, seatCountForRow } from '@venue-core';
import { NumberField, Segmented, SelectField, TextField } from './fields';
import { formatPkr, generated } from '../venueTheme';

const Stat = ({ label, value, strong }) => (
  <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
    <div className="text-[10px] text-slate-500">{label}</div>
    <div className={`text-sm font-bold ${strong ? 'text-[#16a34a]' : 'text-slate-900'}`}>{Number(value).toLocaleString('en-PK')}</div>
  </div>
);

function Group({ title, children, action }) {
  return (
    <section className="space-y-2.5 pt-3 border-t border-slate-100">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ShapeFields({ shape, set }) {
  const n = (key, label, extra = {}) => <NumberField key={key} label={label} value={shape[key]} onChange={(v) => set({ ...shape, [key]: v })} {...extra} />;
  if (shape.type === 'rect') {
    return (
      <div className="grid grid-cols-3 gap-2">
        {n('x', 'Centre X')}
        {n('y', 'Centre Y')}
        {n('rotation', 'Facing °', { hint: '0 = faces up' })}
        {n('w', 'Width', { min: 10 })}
        {n('h', 'Depth', { min: 10 })}
      </div>
    );
  }
  if (shape.type === 'arc') {
    return (
      <div className="grid grid-cols-3 gap-2">
        {n('cx', 'Centre X')}
        {n('cy', 'Centre Y')}
        <span />
        {n('r0', 'Inner radius', { min: 0, hint: 'front row side' })}
        {n('r1', 'Outer radius', { min: 1 })}
        <span />
        {n('a0', 'Start °')}
        {n('a1', 'End °')}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="Rows face °" value={shape.facing || 0} onChange={(v) => set({ ...shape, facing: v })} hint="0 = faces up" />
      <p className="text-[10px] text-slate-500 self-end pb-1">{shape.points.length} corner points. Drag them on the plan; “+” adds one, double-click removes one.</p>
    </div>
  );
}

/** Configures the selected section; every change updates the plan preview immediately. */
export default function SectionInspector({ section, tiers, onChange, onDelete, onDuplicate, onAddTier, issues, blocking, onToggleBlocking, protectedCount }) {
  const g = generated(section);
  const rows = { ...DEFAULT_ROWS, ...(section.rows || {}) };
  const tables = { ...DEFAULT_TABLES, ...(section.tables || {}) };
  const ga = { ...DEFAULT_GA, ...(section.ga || {}) };
  const set = (patch, key) => onChange({ ...section, ...patch }, key);
  const setRows = (patch, key) => set({ rows: { ...rows, ...patch } }, key);
  const [newTier, setNewTier] = useState(null);
  const [aisleText, setAisleText] = useState(null);

  const tierOptions = [{ value: '', label: 'Choose a pricing tier…' }, ...tiers.map((t) => ({ value: t.id, label: `${t.name} · ${formatPkr(t.price)}` }))];
  const rowMaxes = useMemo(() => (section.booking === 'seats' ? Array.from({ length: Math.min(rows.count, LIMITS.rows) }, (_, i) => maxSeatsInRow(section, i)) : []), [section, rows.count]);
  const depthMax = useMemo(() => (section.booking === 'seats' ? maxRows(section) : 0), [section]);
  const canTables = section.shape.type !== 'arc';

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2"><TextField label="Section name" value={section.name} onChange={(v) => set({ name: v }, 'name')} /></div>
        <SelectField label="Level" value={String(section.level || 1)} onChange={(v) => set({ level: Number(v) })} options={[1, 2, 3].map((l) => ({ value: String(l), label: l === 1 ? 'Ground / lower' : `Level ${l}` }))} />
        <SelectField
          label="Booking type"
          value={section.booking}
          onChange={(v) => set({ booking: v, ...(v === 'tables' && !section.tables ? { tables: DEFAULT_TABLES } : {}), ...(v === 'ga' && !section.ga ? { ga: DEFAULT_GA } : {}) })}
          options={[
            { value: 'seats', label: 'Assigned seats' },
            { value: 'ga', label: 'General admission' },
            { value: 'tables', label: canTables ? 'Tables' : 'Tables (needs a block or custom shape)', disabled: !canTables },
          ]}
        />
      </div>

      <div>
        <SelectField label="Pricing tier" value={section.tierId || ''} onChange={(v) => set({ tierId: v || null })} options={tierOptions} hint={!section.tierId ? 'Required before publishing.' : undefined} />
        {newTier ? (
          <div className="mt-2 p-2 rounded-xl border border-slate-200 bg-slate-50 grid grid-cols-5 gap-2 items-end">
            <div className="col-span-3"><TextField label="New tier name" value={newTier.name} onChange={(v) => setNewTier({ ...newTier, name: v })} /></div>
            <div className="col-span-2"><NumberField label="Price (PKR)" value={newTier.price} min={1} onChange={(v) => setNewTier({ ...newTier, price: v })} /></div>
            <div className="col-span-5 flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 rounded-xl border border-slate-200 font-semibold" onClick={() => setNewTier(null)}>Cancel</button>
              <button
                type="button"
                className="px-3 py-1.5 btn-eventfrog text-xs"
                disabled={!newTier.name.trim() || !(newTier.price > 0)}
                onClick={async () => {
                  const tier = await onAddTier(newTier);
                  if (tier) {
                    set({ tierId: tier.id });
                    setNewTier(null);
                  }
                }}
              >
                Add tier
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="mt-1 text-[11px] font-semibold text-[#16a34a] hover:underline inline-flex items-center gap-1" onClick={() => setNewTier({ name: '', price: 2000 })}>
            <Plus className="w-3 h-3" /> New pricing tier
          </button>
        )}
      </div>

      {protectedCount > 0 && (
        <p className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex gap-2">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {protectedCount} seat{protectedCount === 1 ? ' is' : 's are'} held or booked here. They keep their section, row, number and tier, so publishing refuses changes that would move, renumber, re-price or remove them.
        </p>
      )}

      <Group title="Shape & position">
        <ShapeFields shape={section.shape} set={(shape) => set({ shape }, 'shape')} />
      </Group>

      {section.booking === 'seats' && (
        <Group
          title="Rows & seats"
          action={
            <button type="button" className="text-[11px] font-semibold text-[#16a34a] hover:underline inline-flex items-center gap-1" onClick={() => onChange(fitRows(section))} title="Set each row to the most seats that fit">
              <Wand2 className="w-3 h-3" /> Fit seats to rows
            </button>
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Rows" value={rows.count} min={1} max={LIMITS.rows} onChange={(v) => setRows({ count: Math.round(v) }, 'rows')} hint={`fits ${depthMax}`} />
            <NumberField label="Seats per row" value={rows.seatsPerRow} min={0} max={LIMITS.seatsPerRow} onChange={(v) => setRows({ seatsPerRow: Math.round(v), perRow: {} }, 'spr')} hint="resets row overrides" />
            <NumberField label="First seat no." value={rows.seatStart} min={0} onChange={(v) => setRows({ seatStart: Math.round(v) }, 'start')} />
            <NumberField label="Seat spacing" value={rows.seatSpacing} min={3} max={40} step={0.5} onChange={(v) => setRows({ seatSpacing: v }, 'ss')} />
            <NumberField label="Row spacing" value={rows.rowSpacing} min={3} max={40} step={0.5} onChange={(v) => setRows({ rowSpacing: v }, 'rs')} />
            <NumberField label="Edge margin" value={rows.inset} min={0} max={40} onChange={(v) => setRows({ inset: v }, 'inset')} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Segmented label="Row labels" value={rows.labelStyle} onChange={(v) => setRows({ labelStyle: v, labelStart: v === 'numbers' ? '1' : 'A' })} options={[{ value: 'letters', label: 'A, B, C' }, { value: 'numbers', label: '1, 2, 3' }]} />
            <TextField label="Front row label" value={rows.labelStart} maxLength={3} onChange={(v) => setRows({ labelStart: v || (rows.labelStyle === 'numbers' ? '1' : 'A') }, 'ls')} />
            <Segmented label="Seat 1 is on the" value={rows.numbering} onChange={(v) => setRows({ numbering: v })} options={[{ value: 'ltr', label: 'Left' }, { value: 'rtl', label: 'Right' }]} />
            {section.shape.type !== 'arc' && <NumberField label="Row curve" value={rows.curve} min={0} max={3} step={0.1} onChange={(v) => setRows({ curve: v }, 'curve')} hint="0 = straight" />}
          </div>
          <p className="text-[10px] text-slate-400">“Left” and “right” are as seen from the seats, facing the stage or pitch. The front row is the side nearest it.</p>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="col-span-2">
              <TextField
                label="Aisles after seat positions"
                placeholder="e.g. 5, 12"
                value={aisleText ?? (rows.aisles || []).join(', ')}
                onChange={(v) => {
                  setAisleText(v);
                  const list = [...new Set(v.split(/[,\s]+/).map(Number).filter((x) => Number.isInteger(x) && x > 0))].sort((a, b) => a - b);
                  setRows({ aisles: list }, 'aisles');
                }}
                hint="Counted from the left; the gap runs through every row."
              />
            </div>
            <NumberField label="Aisle width" value={rows.aisleWidth} min={2} max={60} onChange={(v) => setRows({ aisleWidth: v }, 'aw')} />
          </div>
          <details className="rounded-xl border border-slate-200 bg-slate-50/60">
            <summary className="px-3 py-2 cursor-pointer font-semibold text-slate-700">Seats in each row ({rows.count} rows)</summary>
            <div className="max-h-56 overflow-y-auto px-3 pb-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {rowMaxes.map((max, i) => {
                const label = rowLabel(i, rows.labelStyle, rows.labelStart);
                const count = seatCountForRow(rows, i);
                const over = count > max;
                return (
                  <label key={i} className="flex items-center gap-2">
                    <span className="w-8 font-mono font-bold text-slate-600">{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={LIMITS.seatsPerRow}
                      value={count}
                      onChange={(e) => {
                        const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                        const perRow = { ...(rows.perRow || {}) };
                        perRow[i] = v;
                        setRows({ perRow }, `row${i}`);
                      }}
                      className={`w-16 bg-white border rounded-lg px-2 py-1 font-mono ${over ? 'border-rose-400 text-rose-700' : 'border-slate-200'}`}
                      aria-label={`Seats in row ${label}`}
                    />
                    <span className={`text-[10px] ${over ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>max {max}</span>
                  </label>
                );
              })}
            </div>
          </details>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={onToggleBlocking} aria-pressed={blocking} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-semibold ${blocking ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              <Ban className="w-3.5 h-3.5" /> {blocking ? 'Done blocking seats' : 'Block seats on the plan'}
            </button>
            {(rows.blocked || []).length > 0 && (
              <button type="button" className="text-[11px] font-semibold text-slate-500 hover:text-rose-600" onClick={() => setRows({ blocked: [] })}>
                Unblock all ({rows.blocked.length})
              </button>
            )}
          </div>
        </Group>
      )}

      {section.booking === 'ga' && (
        <Group title="General admission">
          <NumberField label="Sellable capacity" value={ga.capacity} min={1} max={LIMITS.gaCapacity} onChange={(v) => set({ ga: { ...ga, capacity: Math.round(v) } }, 'cap')} hint="Sold by quantity. No seat numbers are assigned." />
        </Group>
      )}

      {section.booking === 'tables' && (
        <Group title="Tables">
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Tables" value={tables.count} min={1} max={LIMITS.tables} onChange={(v) => set({ tables: { ...tables, count: Math.round(v) } }, 'tc')} />
            <NumberField label="Seats per table" value={tables.seatsPerTable} min={2} max={LIMITS.seatsPerTable} onChange={(v) => set({ tables: { ...tables, seatsPerTable: Math.round(v) } }, 'tst')} />
            <NumberField label="Tables per row" value={tables.columns} min={1} max={20} onChange={(v) => set({ tables: { ...tables, columns: Math.round(v) } }, 'tcol')} />
            <NumberField label="Table spacing" value={tables.spacing || 0} min={0} max={400} onChange={(v) => set({ tables: { ...tables, spacing: v } }, 'tsp')} hint="0 = tightest" />
            <NumberField label="Chair spacing" value={tables.seatSpacing} min={4} max={30} step={0.5} onChange={(v) => set({ tables: { ...tables, seatSpacing: v } }, 'tcs')} />
          </div>
          <Segmented
            label="Booked as"
            value={tables.mode}
            onChange={(v) => set({ tables: { ...tables, mode: v } })}
            options={[{ value: 'whole', label: 'Whole table' }, { value: 'seat', label: 'Individual seats' }]}
          />
          <p className="text-[10px] text-slate-500">
            {tables.mode === 'whole'
              ? `Priced per seat: one table = ${tables.seatsPerTable} tickets. Whole tables can have at most ${LIMITS.wholeTableSeats} seats (the per-booking limit).`
              : 'Each chair is sold on its own at the tier price.'}
          </p>
        </Group>
      )}

      <Group title="Capacity">
        <div className="grid grid-cols-3 gap-2">
          {section.booking === 'tables' ? (
            <>
              <Stat label="Tables" value={g.stats.tables} />
              <Stat label="Guest seats" value={g.stats.guests} />
              <Stat label={tables.mode === 'whole' ? 'Sellable tables' : 'Sellable seats'} value={g.stats.sellableUnits} strong />
            </>
          ) : (
            <>
              <Stat label="Positions" value={g.stats.positions} />
              <Stat label="Blocked" value={g.stats.blocked} />
              <Stat label="Sellable" value={g.stats.sellable} strong />
            </>
          )}
        </div>
      </Group>

      {issues.length > 0 && (
        <ul className="space-y-1.5" aria-label="Problems in this section">
          {issues.map((i, k) => (
            <li key={k} className={`p-2 rounded-xl border flex gap-2 ${i.level === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-between pt-3 border-t border-slate-100">
        <button type="button" onClick={onDuplicate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50">
          <Copy className="w-3.5 h-3.5" /> Duplicate
        </button>
        <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 font-semibold text-rose-700 hover:bg-rose-50">
          <Trash2 className="w-3.5 h-3.5" /> Remove section
        </button>
      </div>
    </div>
  );
}
