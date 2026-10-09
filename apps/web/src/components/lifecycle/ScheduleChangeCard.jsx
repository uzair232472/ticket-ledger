import React, { useState } from 'react';
import { ArrowRight, Building2, CheckCircle2, Eye, Ticket, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { getEventVisual } from '../../utils/eventMedia';
import { Badge } from '../dash/Studio';
import { useDialog } from '../ui/DialogProvider';

const when = (iso) => new Date(iso).toLocaleString('en-PK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Karachi' });

/** Super Admin: an organizer's request to move an event with ticket holders. */
export default function ScheduleChangeCard({ change, onReviewed }) {
  const dialog = useDialog();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { event } = change;
  const pending = change.status === 'PENDING';
  const holders = event._count?.tickets || 0;
  const venueChanged = change.oldVenue !== change.newVenue || change.oldCity !== change.newCity;

  const decide = async (decision) => {
    if (decision === 'REJECT' && comment.trim().length < 5) {
      setError('Add a comment so the organizer knows why.');
      return;
    }
    if (decision === 'APPROVE') {
      const ok = await dialog.confirm({
        tone: 'warning',
        title: 'Approve the new date?',
        message: `The event moves straight away. ${holders} ticket${holders === 1 ? '' : 's'}’ holders are emailed and can get a full refund for up to 14 days (until 48 hours before the new date). Open resale listings are paused.`,
        confirmLabel: 'Approve and notify',
        cancelLabel: 'Not yet',
      });
      if (!ok) return;
    }
    setBusy(decision);
    setError('');
    try {
      const res = await api.post(`/admin/schedule-changes/${change.id}`, { decision, comment: comment.trim() });
      await dialog.alert({ tone: decision === 'APPROVE' ? 'success' : 'info', title: decision === 'APPROVE' ? 'Date change approved' : 'Date change rejected', message: res.data.message });
      onReviewed(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the decision.');
    } finally {
      setBusy('');
    }
  };

  return (
    <article className="tl-ap-item">
      <div className="tl-ap-media">
        <img src={getEventVisual(event, 0).image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      </div>
      <div className="tl-ap-body">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Badge tone={pending ? 'amber' : change.status === 'APPROVED' ? 'green' : 'rose'}>{pending ? 'Waiting' : change.status === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge>
          {venueChanged && <Badge tone="amber">New venue</Badge>}
        </div>
        <h3>{event.name}</h3>
        <p className="tl-ap-meta">
          <span><Building2 className="w-4 h-4" aria-hidden="true" /> {event.company?.companyName}</span>
          <span><Ticket className="w-4 h-4" aria-hidden="true" /> {holders} valid ticket{holders === 1 ? '' : 's'}</span>
        </p>
        <div className="tl-lc-move">
          <div><small>Now</small><p>{when(change.oldStartsAt || change.oldDate)}<br />{change.oldVenue}, {change.oldCity}</p></div>
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
          <div><small>Requested</small><p><strong>{when(change.newStartsAt)}</strong><br /><strong>{change.newVenue}, {change.newCity}</strong></p></div>
        </div>
        <p className="tl-rv-comment">Reason for attendees: “{change.reason}”</p>
        <p className="tl-ap-meta">Requested {when(change.createdAt)}{change.reviewedBy ? ` · reviewed by ${change.reviewedBy}` : ''}{change.reviewComment ? ` · “${change.reviewComment}”` : ''}</p>
        <div className="tl-ap-actions">
          <a href={`/events/${event.id}`} target="_blank" rel="noreferrer" className="tl-wz-btn"><Eye className="w-4 h-4" /> Event page</a>
        </div>
        {pending && (
          <div className="tl-ap-form">
            <label htmlFor={`sc-comment-${change.id}`} style={{ fontSize: 14, fontWeight: 600 }}>
              Comment for the organizer <span style={{ fontWeight: 400, color: 'var(--st-muted)' }}>(required to reject)</span>
            </label>
            <textarea id={`sc-comment-${change.id}`} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="e.g. The new venue is too small for the tickets sold; choose a bigger one." />
            {error && <p role="alert" style={{ color: 'var(--st-rose)', fontSize: 13.5 }}>{error}</p>}
            <div className="tl-ap-actions">
              <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => decide('APPROVE')} disabled={Boolean(busy)}>
                <CheckCircle2 className="w-4 h-4" /> {busy === 'APPROVE' ? 'Approving…' : 'Approve & notify holders'}
              </button>
              <button type="button" className="tl-wz-btn tl-ap-btn-reject" onClick={() => decide('REJECT')} disabled={Boolean(busy)}>
                <XCircle className="w-4 h-4" /> {busy === 'REJECT' ? 'Sending…' : 'Reject with comment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
