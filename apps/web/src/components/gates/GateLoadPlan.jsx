import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Check, DoorOpen, Lightbulb, RefreshCw, Route, Users } from 'lucide-react';
import api from '../../utils/api';
import { DashCard, DashState, Notice } from '../dash/DashShell';
import './gateLoadPlan.css';

/*
 * Gate load plan (rules, no model): before the event, which gate gets the most people at the peak hour and
 * which sections (or seat rows) to send to which gate so no gate is overloaded; on the day, the live load per
 * gate and where to divert arrivals. Admission is never affected: any gate that accepts a ticket type admits it.
 */
const pct = (u) => `${Math.round((u || 0) * 100)}%`;
const n = (x) => Math.round(x || 0).toLocaleString();
const TONE = { OK: 'ok', BUSY: 'busy', OVERLOADED: 'over' };
const LABEL = { OK: 'OK', BUSY: 'Busy', OVERLOADED: 'Overloaded' };

function LoadBar({ g }) {
  return (
    <div className="tl-glp-bar" data-tone={TONE[g.status]}>
      <i style={{ width: `${Math.min(100, (g.utilisation || 0) * 100)}%` }} />
      {g.utilisation > 1 && <b style={{ left: '100%' }} />}
    </div>
  );
}

function GateTable({ title, rows, note }) {
  return (
    <div className="tl-glp-col">
      <h4>{title}</h4>
      {note && <p className="tl-glp-note">{note}</p>}
      <table className="tl-dash-table">
        <thead><tr><th>Gate</th><th>People</th><th>Peak / hour</th><th>Load at peak</th></tr></thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.gateId}>
              <td><strong>{g.name}</strong><div className="text-xs text-slate-500">capacity {n(g.capacityPerHour)}/h</div></td>
              <td>{n(g.expectedPeople)}</td>
              <td>{n(g.peakPerHour)}</td>
              <td style={{ minWidth: 150 }}>
                <LoadBar g={g} />
                <span className={`tl-glp-st tl-glp-st--${TONE[g.status]}`}>{pct(g.utilisation)} · {LABEL[g.status]}{g.waitMinutes ? ` · queue ~${g.waitMinutes} min` : ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Result line for a finished gate advice run (sent in the background, services/gateAdviceJob.js)
const runText = (r) => {
  if (r.status === 'FAILED') return { tone: 'bad', text: r.error || 'The gate advice could not be sent.' };
  const extra = [r.failed ? `${n(r.failed)} failed` : '', r.skipped ? `${n(r.skipped)} already had this advice` : ''].filter(Boolean).join(', ');
  return { tone: r.failed ? 'warn' : 'good', text: `Gate advice sent to ${n(r.sent)} ticket holder${r.sent === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}.` };
};
export default function GateLoadPlan({ eventId, onTab }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get(`/checkin/manage/events/${eventId}/gate-plan`);
      setPlan(r.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'The gate plan could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);
  useEffect(() => { setPlan(null); setSent(null); setConfirm(false); load(); }, [load]);
  // Refresh every minute while the event is live
  useEffect(() => {
    if (!plan?.live) return undefined;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [plan?.live, load]);

  const watch = useCallback(async () => {
    for (let i = 0; i < 150; i += 1) {
      await new Promise((ok) => { setTimeout(ok, 2000); });
      try {
        const r = (await api.get(`/checkin/manage/events/${eventId}/gate-plan/notify`)).data.data;
        if (r && (r.status === 'DONE' || r.status === 'FAILED')) return setSent(runText(r));
      } catch { /* keep waiting */ }
    }
    return setSent({ tone: 'warn', text: 'Still sending. Refresh the page later to see the result.' });
  }, [eventId]);
  const notify = async () => {
    setSending(true);
    try {
      const r = await api.post(`/checkin/manage/events/${eventId}/gate-plan/notify`);
      setSent({ tone: 'good', text: r.data.message });
      setConfirm(false);
      await watch();
    } catch (e) {
      setSent({ tone: 'bad', text: e.response?.data?.message || 'The gate advice could not be sent.' });
    } finally {
      setSending(false);
      setConfirm(false);
    }
  };

  const refresh = <button type="button" className="tl-st-btn tl-st-btn--light tl-st-btn--xs" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'tl-dash-spin' : ''}`} /> Refresh</button>;

  if (error) return <DashCard title="Gate load plan" icon={Route}><Notice tone="bad" icon={AlertTriangle}>{error}</Notice></DashCard>;
  if (!plan) return <DashCard title="Gate load plan" icon={Route}><DashState icon={RefreshCw} title="Building the plan…" /></DashCard>;
  if (!plan.ready) {
    return (
      <DashCard title="Gate load plan" icon={Route} aside={refresh}>
        <Notice tone="warn" icon={AlertTriangle}>{plan.message}</Notice>
        {onTab && <button type="button" className="tl-st-btn tl-st-btn--light tl-st-btn--xs" style={{ marginTop: 10 }} onClick={() => onTab('gates')}><DoorOpen className="w-4 h-4" /> Open Gates & re-entry</button>}
      </DashCard>
    );
  }

  const worstBefore = [...plan.asThingsAre].sort((a, b) => b.utilisation - a.utilisation)[0];
  const worstAfter = [...plan.balanced].sort((a, b) => b.utilisation - a.utilisation)[0];
  const holders = plan.toNotify.reduce((a, g) => a + g.ticketHolders, 0);

  return (
    <div className="space-y-6">
      {plan.live && (
        <DashCard title="Right now: divert arrivals" sub="Real entries per gate in the last 15 minutes, as a rate per hour. Refreshes every minute." icon={Users} aside={refresh}>
          <div className="tl-glp-live">
            {plan.live.gates.map((g) => (
              <div key={g.gateId} className="tl-glp-live-gate" data-tone={TONE[g.status]}>
                <strong>{g.name}</strong>
                <span>{n(g.perHour)}/h · {pct(g.utilisation)}</span>
                <LoadBar g={g} />
              </div>
            ))}
          </div>
          {plan.live.divert.length ? (
            <ul className="tl-glp-advice">
              {plan.live.divert.map((d) => <li key={d.from} data-kind="divert"><ArrowRight className="w-4 h-4" aria-hidden="true" />{d.text}</li>)}
            </ul>
          ) : <p className="tl-glp-note" style={{ marginTop: 10 }}>No gate is over capacity right now.</p>}
          <p className="tl-glp-note">{n(plan.live.admitted)} admitted so far · about {n(plan.live.stillExpected)} still expected.</p>
        </DashCard>
      )}

      <DashCard
        title="Gate load plan"
        sub="Which gate gets the most people at the busiest hour, and how to spread them so no gate is overloaded. Fixed rules, no AI model. Admission is not affected."
        icon={Route}
        aside={!plan.live && refresh}
      >
        <div className="tl-glp-facts">
          <span><b>{n(plan.tickets)}</b> tickets</span>
          <span><b>{n(plan.expectedPeople)}</b> expected ({plan.showRate.percent}% show rate)</span>
          <span><b>{Math.round(plan.arrival.peakHourShare * 100)}%</b> of them arrive in the busiest hour</span>
        </div>
        <p className="tl-glp-note">{plan.arrival.note} {plan.showRate.note || ''}</p>

        {worstBefore && (
          <div className={`tl-glp-headline tl-glp-headline--${TONE[worstBefore.status]}`}>
            <strong>Busiest gate: {worstBefore.name}</strong> at {pct(worstBefore.utilisation)} of its capacity at the peak
            {worstBefore.waitMinutes ? `, a queue of about ${worstBefore.waitMinutes} minutes` : ''}.
            {worstAfter && worstAfter.utilisation < worstBefore.utilisation - 0.005 && <> With the plan below, the fullest gate drops to <strong>{pct(worstAfter.utilisation)}</strong> ({worstAfter.name}).</>}
          </div>
        )}

        <div className="tl-glp-cols">
          <GateTable title="As things are" note="People spread evenly over the gates their ticket allows." rows={plan.asThingsAre} />
          <GateTable title="With the plan" note="Each section (or block of seat rows) gets one gate." rows={plan.balanced} />
        </div>

        <h4 className="tl-glp-h">Which section uses which gate</h4>
        <div className="tl-dash-table-wrap">
          <table className="tl-dash-table">
            <thead><tr><th>Ticket type</th><th>Section</th><th>Seat rows</th><th>Tickets</th><th>Expected</th><th>Use gate</th></tr></thead>
            <tbody>
              {plan.sections.map((s, i) => (
                <tr key={`${s.tierId}-${s.section}-${s.rows}-${i}`}>
                  <td>{s.tierName}</td>
                  <td><strong>{s.section}</strong></td>
                  <td>{s.rows}</td>
                  <td>{n(s.tickets)}</td>
                  <td>{n(s.expected)}</td>
                  <td><strong>{s.gateName}</strong>{s.choices === 1 && <div className="text-xs text-slate-500">only gate for this ticket type</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {plan.advice.length > 0 && (
          <>
            <h4 className="tl-glp-h">Still to do</h4>
            <ul className="tl-glp-advice">
              {plan.advice.map((a, i) => <li key={i} data-kind={a.kind}><Lightbulb className="w-4 h-4" aria-hidden="true" />{a.text}</li>)}
            </ul>
          </>
        )}

        <div className="tl-glp-notify">
          <div>
            <strong>Tell ticket holders their gate</strong>
            <p>Sends each of the {n(holders)} ticket holders not yet inside an in-app message and email with the gate for their section and rows.</p>
          </div>
          {!confirm ? (
            <button type="button" className="tl-st-btn tl-st-btn--green" onClick={() => setConfirm(true)} disabled={!holders || sending}><Bell className="w-4 h-4" /> Send gate advice</button>
          ) : (
            <div className="tl-glp-confirm" role="alert">
              <span>Send to {n(holders)} people now?</span>
              <button type="button" className="tl-st-btn tl-st-btn--light tl-st-btn--xs" onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--xs" onClick={notify} disabled={sending}>{sending ? <RefreshCw className="w-4 h-4 tl-dash-spin" /> : <Check className="w-4 h-4" />} Yes, send</button>
            </div>
          )}
        </div>
        {sent && <div style={{ marginTop: 10 }}><Notice tone={sent.tone} onDismiss={() => setSent(null)}>{sent.text}</Notice></div>}
      </DashCard>
    </div>
  );
}
