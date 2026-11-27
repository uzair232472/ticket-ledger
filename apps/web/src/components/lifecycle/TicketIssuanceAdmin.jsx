import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import api from '../../utils/api';
import { Notice } from '../dash/DashShell';
import { Badge } from '../dash/Studio';

const STATES = [
  { value: 'FAILED', label: 'Needs a decision' },
  { value: 'PENDING', label: 'Retrying' },
  { value: 'MINTING', label: 'Minting now' },
  { value: 'MINTED', label: 'Minted' },
  { value: 'WAIVED', label: 'Waived' },
];
const NFT_TONE = { VERIFIED: 'green', RECORDED: 'amber', SIMULATED: 'amber', PENDING: 'amber', FAILED: 'rose', WAIVED: 'grey' };
const ACTIONS = {
  RETRY: { label: 'Retry', help: 'Fresh attempts with the same seat key. Use when the cause was temporary (RPC, gas, wallet).' },
  REISSUE: { label: 'Reissue', help: 'Invalidate the token holding this seat key on-chain, then mint under a new key. For a seat conflict (e.g. a refunded or abandoned checkout’s token). Refused if that token belongs to a ticket that is still valid.' },
  WAIVE: { label: 'Mark resolved without an NFT', help: 'The ticket stays valid for entry; no NFT will be issued. The customer is told.' },
};
const CODE_TEXT = { SEAT_CONFLICT: 'Seat key already holds another ticket’s token', RETRIES_EXHAUSTED: 'Automatic retries used up' };
const seatText = (s) => (!s ? '—' : s.kind === 'GA_SLOT' ? `${s.section} · General` : `${s.section} · ${s.row}${s.seatNumber}`);
const when = (d) => (d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function ResolveForm({ ticket, minNote, busy, onSubmit, onCancel }) {
  const [action, setAction] = useState(ticket.mintErrorCode === 'SEAT_CONFLICT' ? 'REISSUE' : 'RETRY');
  const [note, setNote] = useState('');
  const short = note.trim().length < minNote;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!short) onSubmit(action, note.trim());
      }}
      style={{ display: 'grid', gap: 10, padding: 14, borderTop: '1px solid var(--st-line, #e5e7eb)' }}
    >
      <fieldset style={{ display: 'grid', gap: 6, border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 4 }}>Decision</legend>
        {Object.entries(ACTIONS).map(([value, a]) => (
          <label key={value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="radio" name={`action-${ticket.id}`} value={value} checked={action === value} onChange={() => setAction(value)} style={{ marginTop: 3 }} />
            <span><strong>{a.label}</strong><br /><small style={{ color: 'var(--st-muted)' }}>{a.help}</small></span>
          </label>
        ))}
      </fieldset>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontWeight: 600 }}>Note (required, kept in the audit log)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why this decision? What did you check?" style={{ width: '100%', padding: 8, font: 'inherit' }} aria-invalid={short && note.length > 0} />
        <small style={{ color: 'var(--st-muted)' }}>{short ? `At least ${minNote} characters.` : 'Ready.'}</small>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="tl-wz-btn tl-wz-btn--green" disabled={busy || short}>{busy ? 'Working…' : `Confirm: ${ACTIONS[action].label}`}</button>
        <button type="button" className="tl-wz-btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Super Admin: paid tickets by NFT issuance state. Payment, entry and NFT are shown as separate facts. Tickets
 * that failed permanently need a decision (retry / reissue / waive) with a note; unfinished reissues can be
 * continued, and minted tickets verified against the chain.
 */
export default function TicketIssuanceAdmin({ onCounts }) {
  const [state, setState] = useState('FAILED');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState(null);

  const countsRef = useRef(onCounts);
  countsRef.current = onCounts;
  const load = useCallback(async () => {
    try {
      const res = await api.get(`/admin/mints?status=${state}`);
      setData(res.data.data);
      countsRef.current?.(res.data.data.counts || {});
    } catch (err) {
      setNotice({ tone: 'bad', text: err.response?.data?.message || 'Could not load ticket issuance.' });
    }
  }, [state]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (request, okTone = 'good') => {
    setBusy(true);
    try {
      const res = await request();
      setNotice({ tone: res.status === 202 ? 'warn' : okTone, text: res.data.message });
      setOpen(null);
      await load();
    } catch (err) {
      setNotice({ tone: 'bad', text: err.response?.data?.message || 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };
  const long = { timeout: 600000 };
  const retryPending = (ids) => run(() => api.post('/admin/mints/retry', ids ? { ids } : {}, long));
  const resolve = (ticketId, action, note) => run(() => api.post(`/admin/mints/${ticketId}/resolve`, { action, note }, long));
  const resume = (id) => run(() => api.post(`/admin/mint-resolutions/${id}/continue`, {}, long));
  const verify = (ticketId) => run(() => api.post(`/admin/mints/${ticketId}/verify`, {}, long));

  const counts = data?.counts || {};
  const minting = data?.minting;
  return (
    <div>
      {minting && minting.mode !== 'live' && (
        <Notice tone={minting.mode === 'disabled' ? 'bad' : 'warn'}>
          Minting is <strong>{minting.mode}</strong>.{' '}
          {minting.mode === 'simulation' ? 'Tokens are simulated and will never show as verified.' : 'No NFTs are issued; paid tickets stay valid and wait.'}
          {minting.problems?.length > 0 && <> {minting.problems.join(' ')}</>}
        </Notice>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <select className="tl-st-filter" value={state} onChange={(e) => setState(e.target.value)} aria-label="Issuance state">
          {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}{counts[s.value] ? ` (${counts[s.value]})` : ''}</option>)}
        </select>
        {state === 'PENDING' && data?.tickets.length > 0 && (
          <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => retryPending(null)} disabled={busy}>
            <RotateCcw className="w-4 h-4" /> {busy ? 'Minting…' : 'Retry all now'}
          </button>
        )}
        <button type="button" className="tl-wz-btn" onClick={load} disabled={busy}><RefreshCw className="w-4 h-4" /> Refresh</button>
        <p style={{ color: 'var(--st-muted)', fontSize: 13.5, maxWidth: 640 }}>
          These tickets are paid and valid at the gate; only the NFT is affected. Failed mints retry automatically (up to {data?.maxAttempts || 8} attempts);
          the ones listed under “Needs a decision” stopped and need an admin decision with a note.
          {data?.openResolutions > 0 && ` ${data.openResolutions} reissue${data.openResolutions === 1 ? '' : 's'} unfinished.`}
        </p>
      </div>
      {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
      {!data ? (
        <p style={{ color: 'var(--st-muted)' }}>Loading…</p>
      ) : data.tickets.length === 0 ? (
        <div className="tl-wz-card" style={{ textAlign: 'center' }}><h2 style={{ fontSize: 20 }}>Nothing under “{STATES.find((s) => s.value === state).label}”</h2></div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {data.tickets.map((t) => {
            const unfinished = t.resolutions?.find((r) => r.action === 'REISSUE' && r.status !== 'COMPLETED');
            return (
              <article key={t.id} className="tl-wz-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', padding: 14 }}>
                  <div style={{ minWidth: 220 }}>
                    <strong>{t.event?.name}</strong>
                    <div><small>Order #{t.orderId.slice(0, 8).toUpperCase()} · {seatText(t.seat)} · {t.user?.name || t.user?.email}</small></div>
                    <div><small>Seat key <code>{t.seatKey}</code></small></div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }} aria-label="Ticket states">
                    <Badge tone={t.states.payment.paid ? 'green' : 'rose'}>{t.states.payment.label}</Badge>
                    <Badge tone={t.states.entry.valid ? 'green' : 'grey'}>{t.states.entry.label}</Badge>
                    <Badge tone={NFT_TONE[t.states.nft.status]}>{t.states.nft.label}{t.tokenId != null ? ` #${t.tokenId}` : ''}</Badge>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    {t.mintStatus === 'FAILED' && !unfinished && <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => setOpen(open === t.id ? null : t.id)} disabled={busy}>Resolve</button>}
                    {t.mintStatus === 'WAIVED' && <button type="button" className="tl-wz-btn" onClick={() => setOpen(open === t.id ? null : t.id)} disabled={busy}>Reopen</button>}
                    {unfinished && <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => resume(unfinished.id)} disabled={busy}>Continue reissue</button>}
                    {t.mintStatus === 'PENDING' && <button type="button" className="tl-wz-btn" onClick={() => retryPending([t.id])} disabled={busy}>Retry now</button>}
                    {t.mintStatus === 'MINTED' && t.states.nft.status === 'RECORDED' && minting?.mode === 'live' && (
                      <button type="button" className="tl-wz-btn" onClick={() => verify(t.id)} disabled={busy}><ShieldCheck className="w-4 h-4" /> Verify on-chain</button>
                    )}
                  </div>
                </div>
                {(t.mintError || t.mintErrorCode) && t.mintStatus !== 'MINTED' && (
                  <p style={{ padding: '0 14px 12px', margin: 0, fontSize: 13.5 }}>
                    {t.mintErrorCode && <strong>{CODE_TEXT[t.mintErrorCode] || t.mintErrorCode}{t.mintConflictTokenId ? ` (token #${t.mintConflictTokenId})` : ''}. </strong>}
                    <span style={{ color: 'var(--st-muted)' }}>{t.mintError} · attempt {t.mintAttempts}{t.mintStatus === 'PENDING' && t.mintNextAttemptAt ? ` · next try ${when(t.mintNextAttemptAt)}` : ''}</span>
                  </p>
                )}
                {t.resolutions?.length > 0 && (
                  <ul style={{ margin: 0, padding: '8px 14px 12px 32px', fontSize: 13.5, borderTop: '1px solid var(--st-line, #e5e7eb)' }} aria-label="Resolution history">
                    {t.resolutions.map((r) => (
                      <li key={r.id}>
                        <strong>{ACTIONS[r.action]?.label || r.action}</strong> · {r.status.toLowerCase().replace('_', ' ')} · {r.admin?.name || r.admin?.email} · {when(r.createdAt)}
                        <br /><span>“{r.note}”</span>
                        {r.action === 'REISSUE' && (
                          <><br /><small>Old token {r.oldTokenId ? `#${r.oldTokenId}` : 'none'}{r.invalidatedAt ? ' invalidated' : r.invalidateTxHash ? ' invalidation sent' : ''}{r.newChainSeatId ? ` · new key ${r.newChainSeatId.split('~').pop()}` : ''}{r.newTokenId ? ` · new token #${r.newTokenId}` : ''}</small></>
                        )}
                        {r.error && <><br /><small style={{ color: 'var(--st-rose, #be123c)' }}>{r.error}</small></>}
                      </li>
                    ))}
                  </ul>
                )}
                {open === t.id && <ResolveForm ticket={t} minNote={data.minNoteLength || 10} busy={busy} onSubmit={(action, note) => resolve(t.id, action, note)} onCancel={() => setOpen(null)} />}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
