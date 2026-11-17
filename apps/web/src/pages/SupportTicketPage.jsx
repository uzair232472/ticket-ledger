import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import api from '../utils/api';
import { useDialog } from '../components/ui/DialogProvider';
import { ReplyBox, StatusPill, Thread } from '../components/support/SupportThread';
import './legal.css';
import './info.css';
import '../components/support/support.css';

/** One support request for the customer (/support/:reference): status, the conversation and a reply box. */
export default function SupportTicketPage() {
  const { reference } = useParams();
  const location = useLocation();
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.created ? 'Request sent. We usually answer within one working day.' : '');

  const load = useCallback(() => api.get(`/support/tickets/${reference}`).then((r) => { setData(r.data.data); setError(''); }).catch((e) => setError(e.response?.data?.message || 'This request could not be loaded.')), [reference]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    document.title = `${reference} · Support · TicketLedger`;
  }, [reference]);

  const send = async (fd) => {
    try {
      const r = await api.post(`/support/tickets/${reference}/replies`, fd);
      setData(r.data.data);
      setNotice('Reply sent.');
      return true;
    } catch (e) {
      setNotice('');
      setError(e.response?.data?.message || 'Your reply could not be sent.');
      return false;
    }
  };
  const close = async () => {
    if (!(await dialog.confirm({ title: 'Close this request?', message: 'Close it if your problem is solved. You can open a new request any time.', confirmLabel: 'Close request' }))) return;
    try {
      const r = await api.post(`/support/tickets/${reference}/close`);
      setData(r.data.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not close the request.');
    }
  };

  const t = data?.ticket;
  const closed = t?.status === 'CLOSED';
  const resolvedTooLong = t?.status === 'RESOLVED' && !t.canReopen;
  return (
    <main className="tl-legal tl-info tl-sp">
      <Link to="/support" className="tl-legal-switch"><ArrowLeft className="w-4 h-4 inline -mt-0.5" aria-hidden="true" /> All requests</Link>
      {error && !t && <p className="tl-sp-empty" style={{ marginTop: 24 }}>{error}</p>}
      {t && (
        <>
          <header className="tl-legal-head">
            <p className="tl-sp-ref">{t.reference}</p>
            <h1 className="text-3xl font-extrabold mt-2">{t.subject}</h1>
            <p className="mt-3 flex flex-wrap gap-3 items-center"><StatusPill status={t.status} label={t.statusLabel} /> <span className="text-sm">{t.categoryLabel}</span></p>
          </header>
          <div className="tl-sp-grid">
            <section aria-label="Conversation">
              {notice && <p className="tl-sp-notice mb-4" role="status">{notice}</p>}
              {error && <p className="tl-sp-notice is-bad mb-4" role="alert">{error}</p>}
              <Thread messages={data.messages} viewer="customer" />
              <ReplyBox
                disabled={closed || resolvedTooLong}
                disabledText={closed ? 'This request is closed. Open a new request if you still need help.' : 'This request was resolved a while ago. Open a new request if you still need help.'}
                onSend={send}
              />
            </section>
            <aside className="tl-sp-facts" aria-label="Request details">
              <dl className="grid gap-3">
                <div><dt>Reference</dt><dd className="tl-sp-ref">{t.reference}</dd></div>
                <div><dt>Status</dt><dd>{t.statusLabel}</dd></div>
                <div><dt>Handled by</dt><dd>{t.assignee?.name || 'Waiting for an agent'}</dd></div>
                <div><dt>Opened</dt><dd>{new Date(t.createdAt).toLocaleString()}</dd></div>
                {t.resolvedAt && <div><dt>Resolved</dt><dd>{new Date(t.resolvedAt).toLocaleString()}</dd></div>}
              </dl>
              {t.status === 'RESOLVED' && t.canReopen && <p className="text-sm">Not solved? Reply and the request reopens.</p>}
              {!closed && <button type="button" className="tl-info-btn" onClick={close}><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> My problem is solved</button>}
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
