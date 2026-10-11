import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { AlertCircle, ArrowUpToLine, CheckCircle2, Clapperboard, Clock, Film, Megaphone, Send, Upload, X, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { useDialog } from '../ui/DialogProvider';
import { HERO_VIDEO_GUIDE, HERO_VIDEO_SPECS, checkHeroVideo } from '../../utils/heroVideoSpecs';
import { resolveMediaUrl } from '../../utils/eventMedia';
import { DEFAULT_PROMOTION_DAYS, PROMOTION_DAY_CHOICES, formatPromoDay, isPromotionActive, isPromotionUpcoming, promoTimeLeft } from '../../utils/promotion';

const STATE = {
  REQUESTED: { icon: Clock, label: 'Waiting for admin review', cls: 'is-wait' },
  APPROVED: { icon: CheckCircle2, label: 'Approved', cls: 'is-ok' },
  REJECTED: { icon: XCircle, label: 'Not approved', cls: 'is-bad' },
};

const OPTIONS = [
  {
    key: 'priority',
    kind: 'PRIORITY',
    statusField: 'priorityStatus',
    icon: ArrowUpToLine,
    title: 'Top of listings',
    text: 'Listed before other events on the home page and the Events page, so attendees see it first.',
  },
  {
    key: 'hero',
    kind: 'HERO',
    statusField: 'heroStatus',
    icon: Clapperboard,
    title: 'Home page hero banner',
    text: 'Your event fills the full-screen banner at the top of the home page, with your promo video or your event banner.',
  },
];

/** One promo video picker: checks the file in the browser before it is sent. */
function VideoField({ kind, file, savedUrl, onChange }) {
  const spec = HERO_VIDEO_SPECS[kind];
  const [problem, setProblem] = useState('');
  const [checking, setChecking] = useState(false);
  const id = `promo-${kind}`;
  const pick = async (e) => {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    setChecking(true);
    const issue = await checkHeroVideo(chosen, kind);
    setChecking(false);
    setProblem(issue || '');
    onChange(issue ? null : chosen);
  };
  return (
    <div className="tl-pr-video">
      <label htmlFor={id}>
        <Film className="w-4 h-4" aria-hidden="true" />
        <span>
          <strong>{spec.label}{kind === 'mobile' ? ' (optional)' : ''}</strong>
          <small>{spec.recommended.join(' × ')} px · {spec.ratioLabel} · up to {spec.maxBytes / (1024 * 1024)} MB</small>
        </span>
      </label>
      {file ? (
        <p className="tl-pr-file">
          {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
          <button type="button" onClick={() => onChange(null)} aria-label={`Remove ${file.name}`}><X className="w-4 h-4" /></button>
        </p>
      ) : savedUrl ? (
        <video className="tl-pr-preview" src={resolveMediaUrl(savedUrl)} muted loop playsInline controls preload="metadata" />
      ) : null}
      <span className="tl-wz-btn tl-pr-pick">
        <Upload className="w-4 h-4" /> {checking ? 'Checking…' : file || savedUrl ? 'Replace video' : 'Choose video'}
        <input id={id} type="file" accept="video/mp4,video/webm" onChange={pick} />
      </span>
      {problem && <p className="tl-wz-error" role="alert"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />{problem}</p>}
    </div>
  );
}

/**
 * Organizer: ask TicketLedger to promote this event (top of listings and/or the home page hero) and see
 * each request's state. An admin approves or rejects each one; they apply while the event is on sale.
 * The ref exposes the ticked-but-unsent request, so "Send to admin for approval" on the review page sends
 * it too instead of dropping it.
 */
const PromotionPanel = forwardRef(function PromotionPanel({ event, onChanged }, ref) {
  const dialog = useDialog();
  const [wanted, setWanted] = useState({ priority: false, hero: false });
  const [videos, setVideos] = useState({ desktop: null, mobile: null });
  const [note, setNote] = useState('');
  const [days, setDays] = useState(DEFAULT_PROMOTION_DAYS);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const status = (opt) => event[opt.statusField] || 'NONE';
  const running = (opt) => isPromotionActive(event, opt.key);
  const endsAt = (opt) => event[`${opt.key}EndsAt`];
  // Anything not already waiting can be asked for, including again while one runs: approved, the new
  // window starts then and moves the event back to the top
  const canPick = (opt) => status(opt) !== 'REQUESTED';
  const heroChosen = wanted.hero;
  const anything = wanted.priority || wanted.hero;

  // `quiet`: sent along with the event submission, which shows its own confirmation
  const send = async ({ quiet = false } = {}) => {
    setSending(true);
    setError('');
    try {
      const form = new FormData();
      form.append('priority', String(wanted.priority));
      form.append('hero', String(wanted.hero));
      form.append('note', note.trim());
      form.append('days', String(days));
      if (wanted.hero && videos.desktop) form.append('heroVideo', videos.desktop);
      if (wanted.hero && videos.mobile) form.append('heroVideoMobile', videos.mobile);
      const res = await api.post(`/events/${event.id}/promotion`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setWanted({ priority: false, hero: false });
      setVideos({ desktop: null, mobile: null });
      setNote('');
      setDays(DEFAULT_PROMOTION_DAYS);
      if (!quiet) dialog.alert({ tone: 'success', title: 'Request sent', message: res.data.message });
      onChanged?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.message || 'Could not send the request.');
      document.getElementById('promote')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return false;
    } finally {
      setSending(false);
    }
  };

  useImperativeHandle(ref, () => ({
    hasPending: () => wanted.priority || wanted.hero,
    sendPending: () => send({ quiet: true }),
  }));

  const withdraw = async (opt) => {
    const stopping = opt.stop || status(opt) !== 'REQUESTED';
    const ok = await dialog.confirm({
      tone: 'warning',
      title: stopping ? `Stop “${opt.title}”?` : `Withdraw “${opt.title}”?`,
      message: stopping
        ? 'Your event stops being promoted this way now, even if time is left. To get it back, you’ll need to request it and be approved again.'
        : running(opt)
          ? `Your new request is removed from the admin queue. The promotion that is running carries on until ${formatPromoDay(endsAt(opt))}.`
          : 'Your request is removed from the admin queue.',
      confirmLabel: stopping ? 'Stop promotion' : 'Withdraw request',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      // Stopping a running promotion that also has a renewal waiting: withdraw the renewal, then stop it
      if (opt.stop && status(opt) === 'REQUESTED') await api.delete(`/events/${event.id}/promotion/${opt.kind.toLowerCase()}`);
      await api.delete(`/events/${event.id}/promotion/${opt.kind.toLowerCase()}`);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not withdraw the request.');
    }
  };

  if (['CANCELLED', 'COMPLETED'].includes(event.status)) return null;

  return (
    <section className="tl-wz-card tl-pr" aria-labelledby="pr-title">
      <div className="tl-pr-head">
        <span aria-hidden="true"><Megaphone className="w-5 h-5" /></span>
        <div>
          <h2 id="pr-title">Promote this event</h2>
          <p>Ask TicketLedger to put your event in front of more people, for as long as you choose. An admin reviews each request and sets the dates; it shows while your event is on sale. The latest promotion is listed first, so you can ask again to move back to the top.</p>
        </div>
      </div>

      <div className="tl-pr-options">
        {OPTIONS.map((opt) => {
          const st = STATE[status(opt)];
          const Icon = opt.icon;
          const pickable = canPick(opt);
          return (
            <div key={opt.key} className={`tl-pr-option${wanted[opt.key] ? ' is-on' : ''}`}>
              <label>
                <input
                  type="checkbox"
                  checked={wanted[opt.key]}
                  disabled={!pickable}
                  onChange={(e) => setWanted((w) => ({ ...w, [opt.key]: e.target.checked }))}
                />
                <span className="tl-pr-icon" aria-hidden="true"><Icon className="w-5 h-5" /></span>
                <span>
                  <strong>{opt.title}</strong>
                  <small>{opt.text}</small>
                </span>
              </label>
              {/* The running window, whatever the latest request's state */}
              {running(opt) && (
                <div className="tl-pr-state is-ok">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {endsAt(opt) ? `Running until ${formatPromoDay(endsAt(opt))} · ${promoTimeLeft(endsAt(opt))}` : 'Running'}
                    {event.status !== 'PUBLISHED' && ' · shows while your event is on sale'}
                  </span>
                  <button type="button" onClick={() => withdraw({ ...opt, stop: true })}>Stop</button>
                </div>
              )}
              {status(opt) === 'APPROVED' && isPromotionUpcoming(event, opt.key) && (
                <div className="tl-pr-state is-wait">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>Scheduled {formatPromoDay(event[`${opt.key}StartsAt`])} to {formatPromoDay(endsAt(opt))}</span>
                  <button type="button" onClick={() => withdraw(opt)}>Cancel</button>
                </div>
              )}
              {status(opt) === 'APPROVED' && !running(opt) && !isPromotionUpcoming(event, opt.key) && endsAt(opt) && (
                <div className="tl-pr-state">
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>Ended {formatPromoDay(endsAt(opt))}. Tick it to ask again.</span>
                </div>
              )}
              {st && status(opt) !== 'APPROVED' && (
                <div className={`tl-pr-state ${st.cls}`}>
                  <st.icon className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {st.label}
                    {status(opt) === 'REQUESTED' && event[`${opt.key}Days`] && ` · ${event[`${opt.key}Days`]} days asked`}
                    {status(opt) === 'REJECTED' && event.promotionComment && <em> “{event.promotionComment}”</em>}
                  </span>
                  {status(opt) === 'REQUESTED' && <button type="button" onClick={() => withdraw(opt)}>Withdraw</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {heroChosen && (
        <div className="tl-pr-hero">
          <h3>Promo video for the hero banner</h3>
          <dl className="tl-pr-guide">
            {HERO_VIDEO_GUIDE.map(([term, text]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <div className="tl-pr-videos">
            <VideoField kind="desktop" file={videos.desktop} savedUrl={event.heroVideoUrl} onChange={(f) => setVideos((v) => ({ ...v, desktop: f }))} />
            <VideoField kind="mobile" file={videos.mobile} savedUrl={event.heroVideoMobileUrl} onChange={(f) => setVideos((v) => ({ ...v, mobile: f }))} />
          </div>
        </div>
      )}

      {anything && (
        <div className="tl-pr-send">
          <label htmlFor="pr-days">How long should it run?</label>
          <select id="pr-days" className="tl-wz-input" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ maxWidth: 220 }}>
            {PROMOTION_DAY_CHOICES.map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
          <p className="tl-wz-hint">The admin confirms the dates when approving and can adjust them.</p>
          <label htmlFor="pr-note">Message for the TicketLedger team <span>(optional)</span></label>
          <textarea id="pr-note" className="tl-wz-input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. We’d like the hero banner for the two weeks before the match." />
          {error && <p className="tl-wz-error" role="alert"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />{error}</p>}
          <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={() => send()} disabled={sending}>
            <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send promotion request'}
          </button>
        </div>
      )}
      {!anything && error && <p className="tl-wz-error" role="alert"><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />{error}</p>}
    </section>
  );
});

export default PromotionPanel;
