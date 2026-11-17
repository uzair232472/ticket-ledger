import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Landmark, XCircle } from 'lucide-react';
import api from '../utils/api';
import { DashCard, Notice } from './dash/DashShell';
import { useDialog } from './ui/DialogProvider';

/*
 * Super Admin: organizations' payout details waiting for a check (new or changed). Verify, or reject with a
 * note the owners see. Shown on the Approvals page only when something is waiting.
 */

const METHOD = { BANK_TRANSFER: 'Bank transfer', JAZZCASH: 'JazzCash', EASYPAISA: 'EasyPaisa' };

export default function PayoutReviews() {
  const dialog = useDialog();
  const [reviews, setReviews] = useState([]);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notes, setNotes] = useState({}); // rejection reason per organization

  const load = useCallback(() => api.get('/companies/admin/finance/pending').then((r) => setReviews(r.data.data.reviews)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const decide = async (r, status) => {
    const note = (notes[r.company.id] || '').trim();
    if (status === 'REJECTED') {
      if (!note) return setNotice({ tone: 'bad', text: 'Write what the owners should fix, then press Reject.' });
    } else if (!(await dialog.confirm({ title: `Verify ${r.company.companyName}'s payout details?`, message: 'Check that the account title matches the verified company before confirming.', confirmLabel: 'Verify', tone: 'success' }))) {
      return;
    }
    setBusy(r.company.id);
    try {
      const res = await api.post(`/companies/admin/${r.company.id}/finance/review`, { status, note });
      setNotice({ tone: 'good', text: res.data.message });
      await load();
    } catch (err) {
      setNotice({ tone: 'bad', text: err.response?.data?.message || 'Could not save the review.' });
    } finally {
      setBusy(null);
    }
  };

  if (!reviews.length && !notice) return null;
  return (
    <div className="my-6">
      <DashCard title="Payout details to check" sub="New or changed payout accounts. Payouts are held until verified." icon={Landmark}>
        {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
        {!reviews.length ? <p className="text-sm">Nothing waiting.</p> : (
          <div className="tl-dash-table-wrap">
            <table className="tl-dash-table">
              <thead><tr><th>Organization</th><th>Method</th><th>Account</th><th>Tax</th><th>Changed</th><th /></tr></thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.company.id}>
                    <td><strong>{r.company.companyName}</strong><div className="text-xs text-slate-500">{r.company.city}</div></td>
                    <td className="text-xs">{METHOD[r.payoutMethod]}</td>
                    <td className="text-xs"><div>{r.accountTitle}</div>{r.bankName && <div>{r.bankName}</div>}<div className="font-mono">{r.iban || r.walletNumber}</div></td>
                    <td className="text-xs">{r.taxNtn || '—'}{r.taxFiler ? ' · filer' : ''}</td>
                    <td className="text-xs">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="flex flex-wrap gap-2 items-center">
                        <input className="tl-dash-input" style={{ minWidth: 160 }} placeholder="Reason (to reject)" maxLength={500} value={notes[r.company.id] || ''} onChange={(e) => setNotes({ ...notes, [r.company.id]: e.target.value })} aria-label={`Rejection reason for ${r.company.companyName}`} />
                        <button type="button" className="tl-st-btn tl-st-btn--green tl-st-btn--sm" disabled={busy === r.company.id} onClick={() => decide(r, 'VERIFIED')}><CheckCircle2 className="w-3.5 h-3.5 inline" /> Verify</button>
                        <button type="button" className="tl-st-btn tl-st-btn--sm" disabled={busy === r.company.id} onClick={() => decide(r, 'REJECTED')}><XCircle className="w-3.5 h-3.5 inline" /> Reject</button>
                      </div>
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
