import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Gift, Ticket } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import './legal.css';
import './info.css';

/** A ticket someone sent (/gifts/:token): what it is, and claiming it with the account it was sent to. */
export default function GiftClaim() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [gift, setGift] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Your ticket · TicketLedger';
    api.get(`/gifts/${token}`).then((r) => setGift(r.data.data)).catch((e) => setError(e.response?.data?.message || 'This gift link is not valid.'));
  }, [token]);

  const claim = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/gifts/${token}/claim`);
      navigate('/wallet', { replace: true });
    } catch (e) {
      setError(e.response?.data?.message || 'The ticket could not be claimed.');
    } finally {
      setBusy(false);
    }
  };

  const e = gift?.event;
  const wrongAccount = user && gift && user.email.toLowerCase() !== gift.recipientEmail;
  return (
    <main className="tl-legal tl-info">
      <header className="tl-legal-head tl-info-head">
        <p className="tl-legal-eyebrow">{gift?.kind === 'GROUP' ? 'Group ticket' : 'A gift for you'}</p>
        <h1>{gift ? `${gift.sender} sent you a ticket` : 'Your ticket'}</h1>
        {gift?.message && <p className="tl-legal-intro">“{gift.message}”</p>}
      </header>
      <section className="tl-info-formcard" style={{ marginTop: 32, maxWidth: 560 }}>
        {error && !gift && <p className="tl-info-error" role="alert">{error}</p>}
        {gift && (
          <div style={{ display: 'grid', gap: 14 }}>
            <h2><Ticket className="w-5 h-5 inline -mt-1" aria-hidden="true" /> {e?.name}</h2>
            <p>{gift.ticketType} · {[gift.seat?.section, gift.seat?.row && `Row ${gift.seat.row}`, gift.seat?.seatNumber && `Seat ${gift.seat.seatNumber}`].filter(Boolean).join(' · ')}</p>
            <p>{e?.venue}, {e?.city} · {e && new Date(e.startsAt || e.date).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</p>
            {gift.status === 'CLAIMED' && <p className="tl-info-error">This ticket was already claimed.</p>}
            {gift.status === 'CANCELLED' && <p className="tl-info-error">{gift.sender} cancelled this gift.</p>}
            {gift.status === 'PENDING' && (
              !isAuthenticated ? (
                <>
                  <p>Sign in or create a TicketLedger account with <b>{gift.recipientEmail}</b> to claim it.</p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Link to="/login" state={{ from: `/gifts/${token}` }} className="tl-info-btn is-primary">Sign in</Link>
                    <Link to="/signup" state={{ from: `/gifts/${token}`, email: gift.recipientEmail }} className="tl-info-btn">Create an account</Link>
                  </div>
                </>
              ) : wrongAccount ? (
                <p className="tl-info-error">This ticket was sent to {gift.recipientEmail}. You're signed in as {user.email}; sign in with that email to claim it.</p>
              ) : (
                <button type="button" className="tl-info-btn is-primary" onClick={claim} disabled={busy}><Gift className="w-4 h-4" aria-hidden="true" /> {busy ? 'Claiming…' : 'Claim my ticket'}</button>
              )
            )}
            {error && <p className="tl-info-error" role="alert">{error}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
