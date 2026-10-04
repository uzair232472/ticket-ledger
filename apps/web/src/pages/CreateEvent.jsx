import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';
import ImageField, { emptyImageValue, imageValueSrc } from '../components/event-form/ImageField';
import GalleryField, { galleryItemsFromSaved } from '../components/event-form/GalleryField';
import SetupStepper, { SETUP_STEPS } from '../components/dash/SetupStepper';
import LocationPicker, { googleMapsUrl } from '../components/event-form/LocationPicker';
import { useDialog } from '../components/ui/DialogProvider';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  CalendarDays,
  FileText,
  MapPin,
  Lightbulb,
  Monitor,
  Image as ImageIcon,
  LayoutGrid,
  Info,
  PlusCircle,
  Trash2,
  Layers,
  Tag,
  Tags,
  Armchair,
  BarChart3,
  Send,
  Sparkles,
  Save,
  MapPinned,
  Eye,
  ArrowUpRight,
  HelpCircle,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta'];
const CATEGORIES = [
  ['CRICKET_MATCH', ' Cricket Match (PSL)'],
  ['MUSIC_CONCERT', ' Music Concert'],
  ['MUSIC_FESTIVAL', ' Music Festival'],
  ['KABADDI', ' Kabaddi Match'],
  ['FOOTBALL_MATCH', ' Football Match'],
  ['BOXING', ' Boxing Match'],
  ['HOCKEY_MATCH', ' Hockey Match'],
  ['QAWWALI', ' Qawwali Night'],
  ['THEATRE', ' Theatre'],
  ['CONFERENCE', ' Conference'],
  ['GENERAL_ADMISSION', ' General Admission'],
];

const emptyImages = (event) => ({
  banner: emptyImageValue(event?.bannerUrl || null),
  cardImage: emptyImageValue(event?.cardImageUrl || null),
  galleryWide: emptyImageValue(event?.galleryWideUrl || null),
});

// Event times are stored as wall-clock text in Pakistan time ("7:00 PM PKT"; older data says "PST").
// The form uses a native time picker ("19:00") and converts both ways.
function toTimeInput(text = '') {
  const m = String(text).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
function fromTimeInput(value = '') {
  if (!value) return '';
  const [hh, mm] = value.split(':').map(Number);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${suffix} PKT`;
}
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Field({ id, label, error, wide, children }) {
  return (
    <div className={`tl-wz-field${wide ? ' is-wide' : ''}${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p className="tl-wz-error" id={`${id}-error`}><AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />{error}</p>}
    </div>
  );
}

function Tips({ title, intro, items, note }) {
  return (
    <aside className="tl-wz-tips" aria-label={title}>
      <div className="tl-wz-tips-head">
        <Lightbulb className="w-9 h-9" aria-hidden="true" />
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      {items.map(({ icon: Icon, title: t, text }) => (
        <div key={t} className="tl-wz-tip">
          <span aria-hidden="true"><Icon className="w-5 h-5" /></span>
          <strong>{t}</strong>
          <p>{text}</p>
        </div>
      ))}
      {note && <p className="tl-wz-tips-note"><Info className="w-4 h-4" aria-hidden="true" />{note}</p>}
    </aside>
  );
}

/**
 * Create a new event: details → images → tickets & pricing here, then the seating plan (venue editor) and
 * Review & submit (sent to admins for approval). Or edit one at /organizer/events/:id/edit. Every step stays mounted, so going back shows exactly what was entered;
 * "Next" only moves on once the current step is valid.
 */
export default function CreateEvent() {
  const dialog = useDialog();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(null); // 'PRELAUNCH_ANALYSIS' | 'DRAFT' | 'SAVE' | null
  const [eventStatus, setEventStatus] = useState(null); // edit mode: the saved event's status
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [step, setStep] = useState(0);

  const [eventData, setEventData] = useState({
    name: '',
    description: '',
    type: 'CRICKET_MATCH',
    date: '',
    time: '7:00 PM PKT',
    city: 'Lahore',
    venue: '',
    bannerUrl: '',
  });

  // Organizer images: nothing is uploaded until the form is saved, so cancelling leaves the event as it was
  const [images, setImages] = useState(() => emptyImages(null));
  const [gallery, setGallery] = useState([]);
  const [savedGallery, setSavedGallery] = useState([]);
  const [loadError, setLoadError] = useState('');

  // Exact venue location (map pin); optional, the event falls back to its city centre
  const [location, setLocation] = useState({ latitude: null, longitude: null, locationAddress: null });

  const [tiers, setTiers] = useState([
    { name: 'General Enclosure', price: 1500, totalQuantity: 500 },
    { name: 'VIP Pavilion', price: 5000, totalQuantity: 100 },
  ]);

  // Company approval status
  useEffect(() => {
    async function checkCompanyStatus() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/companies/my-company`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok) setCompany(data.data.company);
      } catch (err) {
        console.error('Failed to check company:', err);
      } finally {
        setLoading(false);
      }
    }
    if (token) checkCompanyStatus();
  }, [token]);

  // Edit mode: load the saved event (ownership is checked by the API)
  useEffect(() => {
    if (!isEdit || !token) return undefined;
    let alive = true;
    api
      .get(`/events/${editId}/manage`)
      .then((res) => {
        if (!alive) return;
        const ev = res.data.data.event;
        setEventStatus(ev.status);
        setEventData({
          name: ev.name,
          description: ev.description,
          type: ev.type,
          date: new Date(ev.date).toISOString().slice(0, 10),
          time: ev.time,
          city: ev.city,
          venue: ev.venue,
          bannerUrl: ev.bannerUrl || '',
        });
        setTiers(ev.tiers.map((t) => ({ name: t.name, price: Number(t.price), totalQuantity: t.totalQuantity })));
        setLocation({ latitude: ev.latitude ?? null, longitude: ev.longitude ?? null, locationAddress: ev.locationAddress ?? null });
        setImages(emptyImages(ev));
        const saved = galleryItemsFromSaved(ev.galleryImages);
        setGallery(saved);
        setSavedGallery(saved);
      })
      .catch((err) => alive && setLoadError(err.response?.data?.message || 'Could not load this event.'));
    return () => {
      alive = false;
    };
  }, [isEdit, editId, token]);

  const update = (key) => (e) => {
    const value = key === 'time' ? fromTimeInput(e.target.value) : e.target.value;
    setEventData((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const setImage = (field) => (value) => setImages((prev) => ({ ...prev, [field]: value }));

  // What the event page falls back to when a field is empty (same logic as the attendee pages)
  const artwork = getEventVisual({ type: eventData.type, name: eventData.name }, 0).bannerImage;
  const bannerSrc = imageValueSrc(images.banner);
  const bannerFallbackLabel = bannerSrc ? 'the event banner' : 'the category artwork shown here';

  // ---------- Tiers ----------
  const handleAddTier = () => setTiers((prev) => [...prev, { name: '', price: 2000, totalQuantity: 100 }]);
  const handleRemoveTier = (index) => {
    if (tiers.length <= 1) return;
    setTiers((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors({});
  };
  const handleTierChange = (index, field, value) => {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: field === 'name' ? value : Number(value) } : t)));
    const key = `tier-${index}-${field}`;
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  };
  const totalCapacity = tiers.reduce((n, t) => n + (Number(t.totalQuantity) || 0), 0);

  // ---------- Validation per step ----------
  const validateStep = (index) => {
    const errs = {};
    if (index === 0) {
      if (eventData.name.trim().length < 3) errs.name = 'Enter the event name or match title.';
      if (!eventData.venue.trim()) errs.venue = 'Enter the venue or stadium.';
      if (!eventData.date) errs.date = 'Choose the event date.';
      else if (!isEdit && eventData.date < todayIso()) errs.date = 'The date can’t be in the past.';
      if (!toTimeInput(eventData.time)) errs.time = 'Choose the start time.';
      if (eventData.description.trim().length < 10) errs.description = 'Add a short description (at least 10 characters).';
    }
    if (index === 2 && !isEdit) {
      tiers.forEach((t, i) => {
        if (!t.name.trim()) errs[`tier-${i}-name`] = 'Enter a tier name.';
        if (!(t.price > 0)) errs[`tier-${i}-price`] = 'Enter a price above 0.';
        if (!(t.totalQuantity > 0)) errs[`tier-${i}-totalQuantity`] = 'Enter at least 1 ticket.';
      });
    }
    return errs;
  };

  // Moves to `target`, checking every step before it; stops (and shows the problems) at the first invalid one
  const goTo = (target) => {
    setError('');
    if (target <= step) {
      setStep(target);
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    for (let i = step; i < target; i += 1) {
      const errs = validateStep(i);
      if (Object.keys(errs).length) {
        setStep(i);
        setFieldErrors(errs);
        requestAnimationFrame(() => document.getElementById(`ev-${Object.keys(errs)[0]}`)?.focus());
        return;
      }
    }
    setFieldErrors({});
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  // ---------- Save ----------
  const createEvent = async (status) => {
    if (submitting) return;
    for (let i = 0; i < 3; i += 1) {
      const errs = validateStep(i);
      if (Object.keys(errs).length) {
        setStep(i);
        setFieldErrors(errs);
        return;
      }
    }
    setError('');
    setSubmitting(status);
    try {
      const formData = new FormData();
      ['name', 'description', 'type', 'date', 'time', 'city', 'venue'].forEach((key) => formData.append(key, eventData[key]));
      formData.append('status', status);
      formData.append('tiers', JSON.stringify(tiers));
      if (location.latitude != null) {
        formData.append('latitude', String(location.latitude));
        formData.append('longitude', String(location.longitude));
        if (location.locationAddress) formData.append('locationAddress', location.locationAddress);
      }
      if (images.banner.file) formData.append('banner', images.banner.file);
      if (images.cardImage.file) formData.append('cardImage', images.cardImage.file);
      if (images.galleryWide.file) formData.append('galleryWide', images.galleryWide.file);
      gallery.forEach((item) => formData.append('galleryImages', item.file));

      const res = await fetch(`${API_URL}/api/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create event');

      // The event is saved unpublished. With a forecast: adjust prices first; either way step 4 is seating.
      if (status === 'PRELAUNCH_ANALYSIS') navigate(`/demand-forecast?eventId=${data.data.event.id}&setup=1`);
      else navigate(`/organizer/events/${data.data.event.id}/venue?setup=1`);
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } finally {
      setSubmitting(null);
    }
  };

  // Details and images in one request; the API swaps images only after every upload succeeds
  const saveEdits = async () => {
    if (submitting) return;
    const errs = validateStep(0);
    if (Object.keys(errs).length) {
      setStep(0);
      setFieldErrors(errs);
      return;
    }
    setError('');
    setSubmitting('SAVE');
    try {
      const formData = new FormData();
      ['name', 'description', 'type', 'date', 'time', 'city', 'venue'].forEach((key) => formData.append(key, eventData[key]));
      if (location.latitude != null) {
        formData.append('latitude', String(location.latitude));
        formData.append('longitude', String(location.longitude));
        if (location.locationAddress) formData.append('locationAddress', location.locationAddress);
      }
      Object.entries(images).forEach(([field, value]) => {
        if (value.file) formData.append(field, value.file);
        else if (value.removed) formData.append(`${field}Action`, 'remove');
      });
      let upload = 0;
      const order = gallery.map((item) => {
        if (item.id) return { id: item.id };
        formData.append('galleryImages', item.file);
        return { upload: upload++ };
      });
      formData.append('galleryOrder', JSON.stringify(order));

      await api.put(`/events/${editId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await dialog.alert({ tone: 'success', title: 'Changes saved', message: `“${eventData.name}” has been updated.` });
      navigate(`/events/${editId}`);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save changes');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } finally {
      setSubmitting(null);
    }
  };

  // ---------- States ----------
  if (isEdit && loadError) {
    return (
      <div className="tl-wz-card" style={{ maxWidth: 640, margin: '48px auto', textAlign: 'center' }}>
        <AlertCircle className="w-7 h-7" style={{ margin: '0 auto 12px', color: 'var(--st-rose)' }} />
        <h2>Can’t edit this event</h2>
        <p style={{ margin: '8px 0 20px', color: 'var(--st-muted)' }}>{loadError}</p>
        <Link to="/organizer/dashboard" className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> Back to dashboard</Link>
      </div>
    );
  }

  if (loading || (isEdit && !eventData.name)) {
    return <div className="tl-dash-state"><div className="tl-acct-spinner" style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid var(--st-green)', borderTopColor: 'transparent', animation: 'tl-dash-spin 0.9s linear infinite' }} /></div>;
  }

  if (!company || company.status !== 'APPROVED') {
    return (
      <div className="tl-wz-card" style={{ maxWidth: 640, margin: '48px auto', textAlign: 'center' }}>
        <AlertCircle className="w-7 h-7" style={{ margin: '0 auto 12px', color: 'var(--st-amber)' }} />
        <h2>Organizer verification required</h2>
        <p style={{ margin: '8px 0 16px', color: 'var(--st-muted)' }}>
          Only organizers with an approved company registration can create and publish events.
          Current status: <strong>{company?.status || 'Not registered'}</strong>.
        </p>
        <Link to="/company" className="tl-wz-btn tl-wz-btn--green"><Building2 className="w-4 h-4" /> Go to company verification</Link>
      </div>
    );
  }

  const STEP_TEXT = [
    'Tell attendees about your event.',
    'Add images for your event.',
    isEdit ? 'Review ticket tiers and save your changes.' : 'Set ticket tiers, then continue with or without a demand forecast.',
  ];
  // New events show all five setup steps (seating and review come after the event is created)
  const STEPS = isEdit ? SETUP_STEPS.slice(0, 3) : SETUP_STEPS;
  const err = (key) => fieldErrors[key];
  const backHref = isEdit ? `/events/${editId}` : '/organizer/dashboard';

  return (
    <div>
      <nav className="tl-wz-crumbs" aria-label="Breadcrumb">
        <Link to="/organizer/dashboard">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        {isEdit ? <Link to={`/events/${editId}`}>{eventData.name}</Link> : <span style={{ color: 'var(--st-green)' }}>Create event</span>}
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        <span aria-current="page">{isEdit ? 'Edit event' : STEPS[step].label}</span>
      </nav>

      {isEdit ? (
        <>
          {/* Edit: title, event name and a way to the live page; the stepper sits in a mint band */}
          <header className="tl-ed-head">
            <div>
              <h1 className="tl-wz-title">Edit event</h1>
              <p className="tl-ed-sub">{eventData.name}</p>
            </div>
            <Link to={`/events/${editId}`} className="tl-ed-view">
              <span className="tl-ed-view-eye"><Eye className="w-4 h-4" /></span> View event <ArrowUpRight className="w-4 h-4" />
            </Link>
          </header>
          <div className="tl-ed-band">
            <SetupStepper steps={STEPS} current={step} onSelect={goTo} isSelectable={(i) => i !== step && i < 3} />
          </div>
        </>
      ) : (
        <header className="tl-wz-head">
          <div>
            <h1 className="tl-wz-title">Create event</h1>
            <p className="tl-wz-step-text">Step {step + 1} of {STEPS.length} · {STEP_TEXT[step]}</p>
          </div>
          <SetupStepper steps={STEPS} current={step} onSelect={goTo} isSelectable={(i) => i !== step && i < 3} />
        </header>
      )}

      {error && <div className="tl-wz-alert" role="alert"><AlertCircle className="w-4 h-4" />{error}</div>}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 2) goTo(step + 1);
        }}
      >
        {/* ---------- Step 1: details ---------- */}
        <div className="tl-wz-body" hidden={step !== 0}>
          <div className="tl-wz-main">
            <section className="tl-wz-card">
              <div className="tl-wz-card-head">
                <div>
                  <h2>Event details</h2>
                  <p>Provide the key details about your event. This information will be visible to attendees.</p>
                </div>
              </div>
              <div className="tl-wz-grid">
                <Field id="ev-name" label="Event name / Match title" error={err('name')} wide>
                  <input id="ev-name" className="tl-wz-input" type="text" value={eventData.name} onChange={update('name')} placeholder="e.g. Lahore Qalandars vs Islamabad United – PSL 2026" aria-invalid={Boolean(err('name'))} />
                </Field>
                <Field id="ev-type" label="Event category">
                  <select id="ev-type" className="tl-wz-input" value={eventData.type} onChange={update('type')}>
                    {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field id="ev-city" label="City in Pakistan">
                  <select id="ev-city" className="tl-wz-input" value={eventData.city} onChange={update('city')}>
                    {(CITIES.includes(eventData.city) ? CITIES : [eventData.city, ...CITIES]).map((city) => <option key={city} value={city}>{city}</option>)}
                  </select>
                </Field>
                <Field id="ev-venue" label="Venue / Stadium" error={err('venue')} wide>
                  <input id="ev-venue" className="tl-wz-input" type="text" value={eventData.venue} onChange={update('venue')} placeholder="e.g. Gaddafi Stadium" aria-invalid={Boolean(err('venue'))} />
                  {eventData.venue.trim() && (
                    <p className="tl-lp-typed">
                      <a href={googleMapsUrl({ ...location, venue: eventData.venue, city: eventData.city })} target="_blank" rel="noreferrer" aria-label="Open the venue in Google Maps" title="Open in Google Maps">
                        <MapPinned className="w-4 h-4" />
                      </a>
                      <span>{eventData.venue}, {eventData.city}{location.latitude != null ? ' · pinned' : ''}</span>
                    </p>
                  )}
                </Field>
                <div className="tl-wz-field is-wide">
                  <LocationPicker
                    value={location}
                    onChange={setLocation}
                    venue={eventData.venue.trim()}
                    city={eventData.city}
                  />
                </div>
                <Field id="ev-date" label="Date" error={err('date')}>
                  <input id="ev-date" className="tl-wz-input" type="date" value={eventData.date} min={isEdit ? undefined : todayIso()} onChange={update('date')} aria-invalid={Boolean(err('date'))} />
                </Field>
                <Field id="ev-time" label="Time (PKT)" error={err('time')}>
                  <input id="ev-time" className="tl-wz-input" type="time" value={toTimeInput(eventData.time)} onChange={update('time')} aria-invalid={Boolean(err('time'))} />
                </Field>
                <Field id="ev-description" label="Event description & lineup" error={err('description')} wide>
                  <textarea id="ev-description" className="tl-wz-input" rows={3} value={eventData.description} onChange={update('description')} placeholder="Provide event overview, team rosters, or musical schedule…" aria-invalid={Boolean(err('description'))} />
                </Field>
              </div>
            </section>
          </div>
          <Tips
            title="Event setup tips"
            intro="A few quick tips to help you create a great event listing."
            items={[
              { icon: FileText, title: 'Clear and specific title', text: 'Include team names, match type and season (e.g. Lahore Qalandars vs Islamabad United – PSL 2026).' },
              { icon: MapPin, title: 'Accurate venue and city', text: 'Choose the correct stadium and city so attendees can easily find your event.' },
              { icon: CalendarDays, title: 'Set the right date and time', text: 'Use the official schedule and local time (PKT) to avoid confusion.' },
            ]}
          />
        </div>

        {/* ---------- Step 2: images ---------- */}
        <div className="tl-wz-body" hidden={step !== 1}>
          <div className="tl-wz-main">
            <section className="tl-wz-card">
              <div className="tl-wz-card-head is-plain">
                <div>
                  <h2>Event images</h2>
                  <p>All images are optional. If you don’t add your own, we’ll use category artwork or photos as fallbacks.</p>
                </div>
              </div>
              <div className="tl-imf-grid">
                <ImageField kind="banner" value={images.banner} onChange={setImage('banner')} fallbackSrc={artwork} fallbackLabel="the category artwork shown here" />
                <ImageField kind="card" value={images.cardImage} onChange={setImage('cardImage')} fallbackSrc={bannerSrc || artwork} fallbackLabel={bannerFallbackLabel} />
                <ImageField kind="galleryWide" value={images.galleryWide} onChange={setImage('galleryWide')} fallbackSrc={bannerSrc || artwork} fallbackLabel={bannerFallbackLabel} />
                <GalleryField items={gallery} onChange={setGallery} savedItems={savedGallery} />
              </div>
            </section>
          </div>
          <Tips
            title="Event image tips"
            intro="A few quick tips to help you create a great event listing."
            items={[
              { icon: Monitor, title: 'Event banner', text: 'Use a wide, eye-catching image. Recommended size: 2400 × 1080 px (20:9), max 8 MB. Formats: JPG, PNG, WebP.' },
              { icon: ImageIcon, title: 'Event card image', text: 'Shown in listings. Recommended size: 1600 × 1200 px (4:3), max 5 MB. Formats: JPG, PNG, WebP.' },
              { icon: ImageIcon, title: 'Gallery wide image', text: 'Wide image for the event gallery. Recommended size: 2400 × 1200 px (2:1), max 8 MB.' },
              { icon: LayoutGrid, title: 'Scrolling gallery', text: 'Add up to 12 square images. Recommended size: 1200 × 1200 px (1:1), max 5 MB each.' },
            ]}
            note="If you don’t add images, the banner falls back to category artwork, and the card and gallery images fall back to the banner. The scrolling gallery uses category photos when empty."
          />
        </div>

        {/* ---------- Step 3: tickets & pricing ---------- */}
        <div className="tl-wz-body" hidden={step !== 2}>
          <div className="tl-wz-main">
            {isEdit ? (
              <section className="tl-wz-card">
                <div className="tl-wz-card-head is-plain">
                  <div>
                    <h2>Tickets &amp; pricing</h2>
                    <p>Review your ticket setup before saving.</p>
                  </div>
                </div>
                <table className="tl-ed-table">
                  <thead>
                    <tr><th scope="col">Ticket tier</th><th scope="col">Price</th><th scope="col">Capacity</th></tr>
                  </thead>
                  <tbody>
                    {tiers.map((tier) => (
                      <tr key={tier.name}>
                        <td><span className="tl-ed-tier-icon" aria-hidden="true"><Tag className="w-4 h-4" /></span>{tier.name}</td>
                        <td>PKR {Number(tier.price).toLocaleString('en-PK')}</td>
                        <td>{Number(tier.totalQuantity).toLocaleString('en-PK')} seats</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{tiers.length} ticket tier{tiers.length === 1 ? '' : 's'}</td>
                      <td colSpan={2}>Total capacity <strong>{totalCapacity.toLocaleString('en-PK')}</strong></td>
                    </tr>
                  </tfoot>
                </table>
                <p className="tl-ed-info"><Info className="w-5 h-5" aria-hidden="true" /> Ticket tiers are managed separately. Use the tools below to update seating or pricing.</p>
                <div className="tl-ed-tools">
                  <Link to={`/organizer/events/${editId}/venue`} className="tl-ed-tool is-seating">
                    <svg className="tl-ed-art" viewBox="0 0 200 120" aria-hidden="true">
                      <ellipse cx="120" cy="62" rx="74" ry="50" />
                      <ellipse cx="120" cy="62" rx="56" ry="36" />
                      <rect x="96" y="44" width="48" height="36" rx="3" />
                      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => (
                        <line key={a} x1={120 + 56 * Math.cos((a * Math.PI) / 180)} y1={62 + 36 * Math.sin((a * Math.PI) / 180)} x2={120 + 74 * Math.cos((a * Math.PI) / 180)} y2={62 + 50 * Math.sin((a * Math.PI) / 180)} />
                      ))}
                    </svg>
                    <span className="tl-ed-tool-icon"><Armchair className="w-6 h-6" /></span>
                    <strong>Venue &amp; seating</strong>
                    <span>Edit sections and ticket quantities</span>
                    <span className="tl-ed-tool-go" aria-hidden="true"><ArrowRight className="w-4 h-4" /></span>
                  </Link>
                  <Link to={`/demand-forecast?eventId=${editId}`} className="tl-ed-tool is-forecast">
                    <svg className="tl-ed-art" viewBox="0 0 200 120" aria-hidden="true">
                      <polyline points="20,100 60,88 95,70 130,78 165,40 190,22" />
                      {[[60, 88], [95, 70], [130, 78], [165, 40]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="5" />)}
                      <polyline points="178,20 190,22 186,34" />
                    </svg>
                    <span className="tl-ed-tool-icon"><BarChart3 className="w-6 h-6" /></span>
                    <strong>Demand forecast</strong>
                    <span>Review and adjust ticket prices</span>
                    <span className="tl-ed-tool-go" aria-hidden="true"><ArrowRight className="w-4 h-4" /></span>
                  </Link>
                </div>
              </section>
            ) : (
              <>
                <section className="tl-wz-card">
                  <div className="tl-wz-card-head is-plain">
                    <div>
                      <h2>Ticket tiers &amp; capacity</h2>
                      <p>Create ticket tiers for your event. You can add multiple tiers with different prices and quantities.</p>
                    </div>
                    <button type="button" className="tl-wz-btn" style={{ minHeight: 46, padding: '0 20px' }} onClick={handleAddTier}>
                      <PlusCircle className="w-5 h-5" /> Add tier
                    </button>
                  </div>
                  <div className="tl-tier-list">
                    {tiers.map((tier, idx) => (
                      <div key={idx} className="tl-tier-row">
                        <Field id={`ev-tier-${idx}-name`} label="Tier name" error={err(`tier-${idx}-name`)}>
                          <input id={`ev-tier-${idx}-name`} className="tl-wz-input" type="text" value={tier.name} onChange={(e) => handleTierChange(idx, 'name', e.target.value)} placeholder="e.g. General Enclosure" />
                        </Field>
                        <Field id={`ev-tier-${idx}-price`} label="Price (PKR)" error={err(`tier-${idx}-price`)}>
                          <input id={`ev-tier-${idx}-price`} className="tl-wz-input" type="number" min={100} value={tier.price} onChange={(e) => handleTierChange(idx, 'price', e.target.value)} />
                        </Field>
                        <Field id={`ev-tier-${idx}-totalQuantity`} label="Total quantity" error={err(`tier-${idx}-totalQuantity`)}>
                          <input id={`ev-tier-${idx}-totalQuantity`} className="tl-wz-input" type="number" min={1} value={tier.totalQuantity} onChange={(e) => handleTierChange(idx, 'totalQuantity', e.target.value)} />
                        </Field>
                        <button type="button" className="tl-tier-del" onClick={() => handleRemoveTier(idx)} disabled={tiers.length <= 1} aria-label={`Remove ${tier.name || 'this tier'}`} title={tiers.length <= 1 ? 'An event needs at least one tier' : 'Remove tier'}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="tl-tier-total">
                    <Layers className="w-5 h-5" aria-hidden="true" />
                    Total tiers: <b>{tiers.length}</b> <i>•</i> Total capacity: <b>{totalCapacity.toLocaleString()} tickets</b>
                  </p>
                </section>

                <section className="tl-wz-card">
                  <div className="tl-wz-card-head is-plain">
                    <div>
                      <h2>Ready for the next step?</h2>
                      <p>Your event is saved privately. Preview demand and adjust prices first, or go straight to the seating plan. It goes on sale once a TicketLedger admin approves it.</p>
                    </div>
                  </div>
                  <div className="tl-next-options">
                    <button type="button" className="tl-next-option is-recommended" onClick={() => createEvent('PRELAUNCH_ANALYSIS')} disabled={Boolean(submitting)}>
                      <span aria-hidden="true"><BarChart3 className="w-6 h-6" /></span>
                      <strong>{submitting === 'PRELAUNCH_ANALYSIS' ? 'Saving event…' : 'With demand forecast'}</strong>
                      <p>Preview expected demand and adjust prices, then set up seating.</p>
                    </button>
                    <button type="button" className="tl-next-option" onClick={() => createEvent('DRAFT')} disabled={Boolean(submitting)}>
                      <span aria-hidden="true"><Send className="w-6 h-6" /></span>
                      <strong>{submitting === 'DRAFT' ? 'Saving event…' : 'Without forecast'}</strong>
                      <p>Keep the tier prices above and go straight to the seating plan.</p>
                    </button>
                  </div>
                </section>
              </>
            )}
          </div>
          {isEdit ? (
            <aside className="tl-ed-side" aria-label="Before you save">
              <section className="tl-wz-card">
                <h2>Before you save</h2>
                <p className="tl-ed-side-intro">Take a moment to review the key details for your event.</p>
                <ul className="tl-ed-checks">
                  <li>
                    <button type="button" onClick={() => goTo(0)}>
                      <span className="tl-ed-check-icon"><FileText className="w-5 h-5" /></span>
                      <span><strong>Review event details</strong><small>Make sure your event information is correct.</small></span>
                    </button>
                  </li>
                  <li>
                    <button type="button" onClick={() => goTo(1)}>
                      <span className="tl-ed-check-icon"><ImageIcon className="w-5 h-5" /></span>
                      <span><strong>Check event images</strong><small>Confirm your event images look good.</small></span>
                    </button>
                  </li>
                  <li>
                    <div>
                      <span className="tl-ed-check-icon"><Tag className="w-5 h-5" /></span>
                      <span><strong>Confirm price and capacity</strong><small>Verify ticket prices and total capacity.</small></span>
                    </div>
                  </li>
                </ul>
                <p className="tl-ed-fine">Saving updates your existing event.</p>
              </section>
              <section className="tl-ed-help">
                <span aria-hidden="true"><HelpCircle className="w-6 h-6" /></span>
                <div>
                  <strong>Need to change a tier?</strong>
                  <p>Manage capacity in Venue &amp; seating and prices in Demand forecast.</p>
                </div>
              </section>
            </aside>
          ) : (
          <Tips
            title="Ticket setup tips"
            intro="A few quick tips to help you set up your ticket tiers and move forward."
            items={[
              { icon: Tag, title: 'Set clear tier names', text: 'Use simple, descriptive names such as General Enclosure, VIP Pavilion or Early Bird so attendees understand their options.' },
              { icon: Tags, title: 'Check prices and quantities', text: 'Double-check ticket prices and total quantities. Make sure they match your event plan and venue capacity.' },
              { icon: Armchair, title: 'Seating comes next', text: 'After this step you set up the seating plan, then review your event and send it to TicketLedger for approval.' },
            ]}
          />
          )}
        </div>

        {/* ---------- Footer: back / next ---------- */}
        <div className="tl-wz-foot">
          {step === 0 ? (
            <Link to={backHref} className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> {isEdit ? 'Back to event page' : 'Back to dashboard'}</Link>
          ) : (
            <button type="button" className="tl-wz-btn" onClick={() => goTo(step - 1)}>
              <ArrowLeft className="w-4 h-4" /> Back: {STEPS[step - 1].label}
            </button>
          )}

          <div className="tl-wz-foot-right">
            {isEdit && ['DRAFT', 'PRELAUNCH_ANALYSIS', 'REJECTED'].includes(eventStatus) && (
              <Link to={`/organizer/events/${editId}/submit`} className="tl-wz-btn">
                <Send className="w-4 h-4" /> Review &amp; submit
              </Link>
            )}
            {step < 2 && (
              <button type="submit" className="tl-wz-btn tl-wz-btn--green">
                Next: {STEPS[step + 1].label} <ArrowRight className="w-4 h-4" />
              </button>
            )}
            {step === 2 && isEdit && (
              <button type="button" className="tl-wz-btn tl-wz-btn--green" onClick={saveEdits} disabled={Boolean(submitting)}>
                <Save className="w-4 h-4" /> {submitting ? 'Saving changes…' : 'Save changes'}
              </button>
            )}
            {step === 2 && !isEdit && (
              <>
                <button type="button" className="tl-wz-btn tl-wz-btn--forecast" onClick={() => createEvent('PRELAUNCH_ANALYSIS')} disabled={Boolean(submitting)}>
                  <Sparkles className="w-4 h-4" /> {submitting === 'PRELAUNCH_ANALYSIS' ? 'Saving event…' : 'Continue with demand forecast'}
                </button>
                <button type="button" className="tl-wz-btn tl-wz-btn--publish" onClick={() => createEvent('DRAFT')} disabled={Boolean(submitting)}>
                  <Armchair className="w-4 h-4" /> {submitting === 'DRAFT' ? 'Saving event…' : 'Next: Seating plan (no forecast)'}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
