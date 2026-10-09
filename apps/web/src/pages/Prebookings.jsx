import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, CalendarRange, Plus } from 'lucide-react';
import api from '../utils/api';
import { StudioHead, Badge } from '../components/dash/Studio';

/** /organizer/prebook: the organizer's prebookings (autosaved drafts and what they reserved). */
export default function Prebookings() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .get('/prebook/drafts')
      .then((res) => setDrafts(res.data.data.drafts))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your prebookings.'));
  }, []);

  const start = async () => {
    setStarting(true);
    try {
      const res = await api.post('/prebook/drafts', { data: {} });
      navigate(`/organizer/prebook/${res.data.data.draft.id}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start a prebooking.');
      setStarting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 16px 64px' }}>
      <StudioHead
        crumbs={['Organizer', 'Prebookings']}
        title="Prebookings"
        intro="Reserve future dates and venue slots. Your progress is saved automatically, so you can come back to a prebooking any time."
        controls={<Link to="/organizer/events/new" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back</Link>}
        actions={
          <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={start} disabled={starting}>
            <Plus className="w-4 h-4" /> {starting ? 'Starting…' : 'New prebooking'}
          </button>
        }
      />
      {error && <div className="tl-wz-alert" role="alert"><AlertCircle className="w-4 h-4" />{error}</div>}
      {drafts && drafts.length === 0 && (
        <div className="tl-wz-card" style={{ textAlign: 'center', marginTop: 24 }}>
          <CalendarRange className="w-8 h-8" style={{ margin: '0 auto 10px', color: 'var(--st-green)' }} aria-hidden="true" />
          <h2>No prebookings yet</h2>
          <p style={{ color: 'var(--st-muted)', margin: '8px 0 18px' }}>Start one to reserve one date, or several dates for the same event.</p>
          <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={start} disabled={starting}>
            <Plus className="w-4 h-4" /> New prebooking
          </button>
        </div>
      )}
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {(drafts || []).map((d) => (
          <Link key={d.id} to={`/organizer/prebook/${d.id}`} className="tl-wz-card" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <h2 style={{ fontSize: 20 }}>{d.title}</h2>
              <p style={{ color: 'var(--st-muted)', fontSize: 14, marginTop: 4 }}>
                {d.dates} date{d.dates === 1 ? '' : 's'} · last edited {new Date(d.updatedAt).toLocaleString()}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {d.reserved > 0 && <Badge tone="green">{d.reserved} reserved</Badge>}
              {d.submitted - d.reserved > 0 && <Badge tone="amber">{d.submitted - d.reserved} submitted</Badge>}
              {d.dates - d.submitted > 0 && <Badge>{d.dates - d.submitted} draft</Badge>}
            </div>
            <ArrowRight className="w-5 h-5" style={{ color: 'var(--st-green)' }} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
