import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import { Notice } from '../dash/DashShell';
import { Badge } from '../dash/Studio';

const STATES = [
  { value: 'FAILED', label: 'Failed' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SUCCEEDED', label: 'Refunded' },
];
const REASON = { EVENT_CANCELLED: 'Event cancelled', RESCHEDULE_OPT_OUT: 'Can’t make new date', POSTPONED_OPT_OUT: 'Didn’t wait (postponed)', ADMIN: 'Admin' };
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;

/** Super Admin: refunds by state; failed ones can be retried (they are also retried hourly). */
export default function RefundsAdmin({ onCounts }) {
  const [state, setState] = useState('FAILED');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  // The parent's callback changes every render; keep the latest without reloading on each one
  const countsRef = useRef(onCounts);
  countsRef.current = onCounts;
  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/refunds?status=${state}`);
      setData(res.data.data);
      countsRef.current?.(res.data.data.counts || {});
    } catch (err) {
      setNotice({ tone: 'bad', text: err.response?.data?.message || 'Could not load refunds.' });
    }
  }, [state]);
  useEffect(() => {
    load();
  }, [load]);

  const retry = async (ids) => {
    setBusy(true);
    try {
      const res = await api.post('/admin/refunds/retry', ids ? { ids } : {});
      setNotice({ tone: res.data.data.failed ? 'warn' : 'good', text: res.data.message });
      await load();
    } catch (err) {
      setNotice({ tone: 'bad', text: err.response?.data?.message || 'Retry failed.' });
    } finally {
      setBusy(false);
    }
  };

  const counts = data?.counts || {};
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <select className="tl-st-filter" value={state} onChange={(e) => setState(e.target.value)} aria-label="Refund state">
          {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}{counts[s.value] ? ` (${counts[s.value]})` : ''}</option>)}
        </select>
        {['FAILED', 'PENDING'].includes(state) && data?.refunds.length > 0 && (
          <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => retry(null)} disabled={busy}>
            <RotateCcw className="w-4 h-4" /> {busy ? 'Retrying…' : 'Retry all'}
          </button>
        )}
        <button type="button" className="tl-wz-btn" onClick={load} disabled={busy}><RefreshCw className="w-4 h-4" /> Refresh</button>
        <p style={{ color: 'var(--st-muted)', fontSize: 13.5, maxWidth: 560 }}>
          Refunds go back to whoever paid. Failed ones are retried every hour, up to {data?.maxAttempts || 5} times; after that, retry them here.
        </p>
      </div>
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {!data ? (
        <p style={{ color: 'var(--st-muted)' }}>Loading…</p>
      ) : data.refunds.length === 0 ? (
        <div className="tl-wz-card" style={{ textAlign: 'center' }}><h2 style={{ fontSize: 20 }}>No {STATES.find((s) => s.value === state).label.toLowerCase()} refunds</h2></div>
      ) : (
        <div className="tl-wz-card" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="tl-lc-table">
            <thead>
              <tr><th scope="col">Event</th><th scope="col">Paid by</th><th scope="col">Amount</th><th scope="col">Why</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {data.refunds.map((r) => (
                <tr key={r.id}>
                  <td>{r.event?.name}</td>
                  <td>{r.user?.name || r.user?.email}<br /><small>{r.user?.email}</small></td>
                  <td>{pkr(r.amount)}{Number(r.organizerShare) < Number(r.amount) && <><br /><small>Organizer {pkr(r.organizerShare)}</small></>}</td>
                  <td>{REASON[r.reason] || r.reason}</td>
                  <td>{r.method || 'Resale'}{r.providerRef && <><br /><small>{r.providerRef}</small></>}</td>
                  <td>
                    <Badge tone={r.status === 'SUCCEEDED' ? 'green' : r.status === 'FAILED' ? 'rose' : 'amber'}>{r.status.toLowerCase()}</Badge>
                    {r.failureReason && <><br /><small>{r.failureReason} (try {r.attempts})</small></>}
                  </td>
                  <td>{['FAILED', 'PENDING'].includes(r.status) && <button type="button" className="tl-wz-btn" onClick={() => retry([r.id])} disabled={busy}>Retry</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
