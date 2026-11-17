import React, { useCallback, useEffect, useState } from 'react';
import { Wallet, RefreshCw, Check, X, PauseCircle, PlayCircle, RotateCcw } from 'lucide-react';
import api from '../utils/api';
import { DashCard, DashHead, DashState, Notice, Segmented, Status } from '../components/dash/DashShell';
import PayoutReviews from '../components/PayoutReviews';

/*
 * Super Admin payouts: what TicketLedger owes organizations per ended event. Make the bank / wallet transfer,
 * then mark it paid with the reference; mark failed with a reason, or hold / release. Payout details waiting
 * for verification are listed first.
 */

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const pkr = (n) => `PKR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const when = (v) => (v ? new Date(v).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
const TONE = { SCHEDULED: 'PENDING', ON_HOLD: 'SUSPENDED', PROCESSING: 'PENDING', PAID: 'APPROVED', FAILED: 'FAILED', CANCELLED: 'INACTIVE' };

export default function AdminPayouts() {
  const [status, setStatus] = useState('PROCESSING');
  const [rows, setRows] = useState(null);
  const [inputs, setInputs] = useState({});
  const [notice, setNotice] = useState(null);
  const load = useCallback(() => api.get('/companies/admin/payouts', { params: { status: status || undefined } }).then((r) => setRows(r.data.data.payouts)).catch((e) => setNotice({ tone: 'bad', text: errText(e) })), [status]);
  useEffect(() => { load(); }, [load]);
  const act = async (p, action) => {
    const v = (inputs[p.id] || '').trim();
    try {
      const r = await api.post(`/companies/admin/payouts/${p.id}/decide`, { action, reference: action === 'PAID' ? v : undefined, reason: ['FAILED', 'HOLD'].includes(action) ? v : undefined });
      setNotice({ tone: 'good', text: r.data.message });
      setInputs({ ...inputs, [p.id]: '' });
      load();
    } catch (e) {
      setNotice({ tone: 'bad', text: errText(e) });
    }
  };
  return (
    <div className="space-y-6">
      <DashHead
        eyebrow="Admin console"
        title="Payouts"
        intro="Money owed to organizers for ended events. Transfer it, then record the reference here; the organizer is told at each step."
        segment={<Segmented label="Status" options={[{ value: 'PROCESSING', label: 'Ready to pay', icon: Wallet }, { value: 'SCHEDULED', label: 'Scheduled' }, { value: 'ON_HOLD', label: 'On hold' }, { value: 'FAILED', label: 'Failed' }, { value: 'PAID', label: 'Paid' }, { value: '', label: 'All' }]} value={status} onChange={setStatus} />}
      />
      <PayoutReviews />
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      <DashCard title="Payouts" icon={Wallet} aside={<button type="button" className="tl-st-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>}>
        {!rows ? <DashState icon={RefreshCw} title="Loading…" /> : !rows.length ? <DashState icon={Wallet} title="Nothing here" /> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Organizer · event</th><th>Breakdown</th><th>Payout</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.company?.companyName}</strong><div className="text-xs text-slate-500">{p.event?.name} · due {when(p.scheduledFor)}</div></td>
                    <td className="text-xs">Sales {pkr(p.grossSales)} · fees {pkr(p.serviceFees)} · tax {pkr(p.taxCollected)}<br />− refunds {pkr(p.refunds)} − platform {pkr(p.platformFee)}</td>
                    <td><strong>{pkr(p.netAmount)}</strong><div className="text-xs text-slate-500">{p.destination || 'No payout details'}</div></td>
                    <td><Status value={TONE[p.status]} label={p.status.replace('_', ' ').toLowerCase()} />{p.reference && <div className="text-xs">Ref {p.reference}</div>}{(p.holdReason || p.failureReason) && <div className="text-xs text-rose-700">{p.holdReason || p.failureReason}</div>}</td>
                    <td>
                      {p.status !== 'PAID' && p.status !== 'CANCELLED' && (
                        <div className="grid gap-2" style={{ minWidth: 220 }}>
                          {p.status !== 'ON_HOLD' && <input className="tl-dash-input" placeholder={['PROCESSING', 'SCHEDULED', 'FAILED'].includes(p.status) ? 'Transfer reference, or reason' : 'Reason'} value={inputs[p.id] || ''} onChange={(e) => setInputs({ ...inputs, [p.id]: e.target.value })} aria-label="Reference or reason" />}
                          <div className="flex flex-wrap gap-2">
                            {['PROCESSING', 'SCHEDULED', 'FAILED'].includes(p.status) && <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" onClick={() => act(p, 'PAID')}><Check className="w-3.5 h-3.5 inline" /> Mark paid</button>}
                            {p.status === 'PROCESSING' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(p, 'FAILED')}><X className="w-3.5 h-3.5 inline" /> Failed</button>}
                            {p.status === 'FAILED' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(p, 'RETRY')}><RotateCcw className="w-3.5 h-3.5 inline" /> Try again</button>}
                            {['SCHEDULED', 'PROCESSING', 'FAILED'].includes(p.status) && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(p, 'HOLD')}><PauseCircle className="w-3.5 h-3.5 inline" /> Hold</button>}
                            {p.status === 'ON_HOLD' && <button type="button" className="tl-st-btn tl-st-btn--sm" onClick={() => act(p, 'RELEASE')}><PlayCircle className="w-3.5 h-3.5 inline" /> Release</button>}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>
    </div>
  );
}
