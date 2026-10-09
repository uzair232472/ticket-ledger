import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';
import ImageField, { emptyImageValue, imageValueSrc } from '../components/event-form/ImageField';
import GalleryField, { galleryItemsFromSaved } from '../components/event-form/GalleryField';
import SetupStepper, { SETUP_STEPS } from '../components/dash/SetupStepper';
import LocationPicker, { googleMapsUrl } from '../components/event-form/LocationPicker';
import CategoryField from '../components/event-form/CategoryField';
import { categoryProfile } from '../components/event-form/categoryProfiles';
import { formatEventDate, formatEventTime } from '../utils/eventTime';
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
  CheckCircle2,
  Loader2,
  Copy,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta'];

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

// End must come after the start; events that run past midnight end on the next day. Same wording as the API.
function scheduleOrderError({ date, time, endDate, endTime }) {
  const start = toTimeInput(time);
  const end = toTimeInput(endTime);
  if (!date || !start || !endDate || !end) return null;
  if (`${endDate}T${end}` > `${date}T${start}`) return null;
  return endDate === date
    ? { endTime: 'The end time must be after the start time. If the event runs past midnight, set the end date to the next day.' }
    : { endDate: 'The event must end after it starts.' };
}

const SCHEDULE_FIELDS = ['date', 'time', 'endDate', 'endTime', 'city', 'venue'];

const STATUS_LABEL = {
  DRAFT: 'Draft',
  PRELAUNCH_ANALYSIS: 'Pre-launch',
  PENDING_APPROVAL: 'Awaiting approval',
  PUBLISHED: 'On sale',
  PAUSED: 'Paused',
};
// "Wed, 21 Oct 2026 · 7:00 PM · Air University C-Block (Draft)": one existing event in duplicate warnings
const describeEvent = (e) =>
  `${formatEventDate(e.date)}${e.time ? ` · ${formatEventTime(e.time)}` : ''} · ${e.venue} (${STATUS_LABEL[e.status] || e.status.replace(/_/g, ' ').toLowerCase()})`;

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
  // Edit mode: with tickets sold, the date, time and venue change through "Cancel or change date"
  const [ticketsHeld, setTicketsHeld] = useState(0);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  // The step lives in the URL (?step=2), so the browser and phone back button go to the previous step
  // instead of leaving the form
  const routerLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const step = Math.min(Math.max((Number(searchParams.get('step')) || 1) - 1, 0), 2);
  const setStep = (index, { replace = false } = {}) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (index > 0) next.set('step', String(index + 1));
        else next.delete('step');
        return next;
      },
      { replace, state: replace ? routerLocation.state : { wizardFrom: step } },
    );
  const savingRef = useRef(false); // blocks a second save from a double click before React re-renders
  const tiersTouched = useRef(false); // until the organizer edits tiers, they follow the chosen category

  const [eventData, setEventData] = useState({
    name: '',
    description: '',
    type: 'CRICKET_MATCH',
    customCategoryId: '',
    date: '',
    time: '7:00 PM PKT',
    endDate: '',
    endTime: '10:00 PM PKT',
    city: 'Lahore',
    venue: '',
    contactEmail: '',
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
        setTicketsHeld(ev.ticketsHeld || 0);
        setEventData({
          name: ev.name,
          description: ev.description,
          type: ev.type,
          customCategoryId: ev.customCategoryId || '',
          date: new Date(ev.date).toISOString().slice(0, 10),
          time: ev.time,
          // Older events have no end yet: the organizer is asked to add one before saving
          endDate: ev.endDate || new Date(ev.date).toISOString().slice(0, 10),
          endTime: ev.endTime ? fromTimeInput(ev.endTime) : '',
          city: ev.city,
          venue: ev.venue,
          contactEmail: ev.contactEmail || '',
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
    const value = key === 'time' || key === 'endTime' ? fromTimeInput(e.target.value) : e.target.value;
    const next = { ...eventData, [key]: value };
    // The end date follows the start date until the organizer picks a different one
    if (key === 'date' && (!eventData.endDate || eventData.endDate === eventData.date)) next.endDate = value;
    setEventData(next);
    if (SCHEDULE_FIELDS.includes(key)) {
      // Start / end order is checked as the dates and times are picked
      const order = scheduleOrderError(next) || {};
      setFieldErrors((prev) => ({ ...prev, [key]: undefined, endDate: order.endDate, endTime: order.endTime, schedule: undefined }));
    } else if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  // ---------- Live venue availability ----------
  // Re-checked (debounced) whenever the venue, city, dates or times change. The API applies the same
  // overlap and one-hour-gap rules again when the event is saved.
  const [venueCheck, setVenueCheck] = useState({ status: 'idle' }); // idle | checking | free | conflict | error
  // Your own events with the same name (from the same check): probably this event entered twice
  const [duplicates, setDuplicates] = useState([]);
  const checkSeq = useRef(0);
  useEffect(() => {
    const { city, venue, date, time, endDate, endTime, name } = eventData;
    const ready = venue.trim().length >= 2 && date && toTimeInput(time) && endDate && toTimeInput(endTime) && !scheduleOrderError(eventData);
    const seq = ++checkSeq.current;
    if (!ready || !token) {
      setVenueCheck({ status: 'idle' });
      return undefined;
    }
    setVenueCheck({ status: 'checking' });
    const timer = setTimeout(() => {
      api
        .get('/events/schedule-check', {
          params: { city, venue: venue.trim(), date, time, endDate, endTime, name: name.trim(), ...(isEdit ? { excludeEventId: editId } : {}) },
        })
        .then((res) => {
          if (seq !== checkSeq.current) return;
          const { available, message, conflicts = [], duplicates: same = [] } = res.data.data;
          setDuplicates(same);
          setVenueCheck(available ? { status: 'free' } : { status: 'conflict', message, more: Math.max(conflicts.length - 1, 0) });
        })
        .catch(() => seq === checkSeq.current && setVenueCheck({ status: 'error' }));
    }, 400);
    return () => clearTimeout(timer);
  }, [eventData.city, eventData.venue, eventData.date, eventData.time, eventData.endDate, eventData.endTime, eventData.name, token, isEdit, editId]);

  // A rejected save (e.g. someone booked the slot in the meantime) shows the problem on its field in step 1
  const showServerError = (body, fallback) => {
    const message = body?.message || fallback;
    if (body?.field && (SCHEDULE_FIELDS.includes(body.field) || body.field === 'schedule')) {
      setStep(0, { replace: true });
      setFieldErrors((prev) => ({ ...prev, [body.field]: message }));
      if (body.field === 'schedule') setVenueCheck({ status: 'conflict', message, more: Math.max((body.conflicts?.length || 1) - 1, 0) });
    }
    setError(message);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const setImage = (field) => (value) => setImages((prev) => ({ ...prev, [field]: value }));

  // What the event page falls back to when a field is empty (same logic as the attendee pages)
  const artwork = getEventVisual({ type: eventData.type, name: eventData.name }, 0).bannerImage;
  const bannerSrc = imageValueSrc(images.banner);
  const bannerFallbackLabel = bannerSrc ? 'the event banner' : 'the category artwork shown here';

  // ---------- Tiers ----------
  const handleAddTier = () => {
    tiersTouched.current = true;
    setTiers((prev) => [...prev, { name: '', price: 2000, totalQuantity: 100 }]);
  };
  const handleRemoveTier = (index) => {
    if (tiers.length <= 1) return;
    tiersTouched.current = true;
    setTiers((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors({});
  };
  const handleTierChange = (index, field, value) => {
    tiersTouched.current = true;
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
      if (eventData.type === 'OTHER' && !eventData.customCategoryId) errs.type = 'Choose a category, or add yours.';
      if (!eventData.venue.trim()) errs.venue = 'Enter the venue or stadium.';
      if (!eventData.date) errs.date = 'Choose the event date.';
      else if (!isEdit && eventData.date < todayIso()) errs.date = 'The date can’t be in the past.';
      if (!toTimeInput(eventData.time)) errs.time = 'Choose the start time.';
      if (!eventData.endDate) errs.endDate = 'Choose the end date.';
      if (!toTimeInput(eventData.endTime)) errs.endTime = 'Choose the end time.';
      Object.assign(errs, scheduleOrderError(eventData));
      if (venueCheck.status === 'conflict') errs.schedule = venueCheck.message;
      if (eventData.description.trim().length < 10) errs.description = 'Add a short description (at least 10 characters).';
      if (eventData.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(eventData.contactEmail.trim())) errs.contactEmail = 'Enter a valid email address, or leave it empty.';
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
      // Going back one step the way we came: use history, so browser Back / Forward stay in order
      if (target === step - 1 && routerLocation.state?.wizardFrom === target) navigate(-1);
      else setStep(target, { replace: true });
      return;
    }
    for (let i = step; i < target; i += 1) {
      const errs = validateStep(i);
      if (Object.keys(errs).length) {
        if (i !== step) setStep(i, { replace: true });
        setFieldErrors(errs);
        requestAnimationFrame(() => document.getElementById(`ev-${Object.keys(errs)[0]}`)?.focus());
        return;
      }
    }
    setFieldErrors({});
    setStep(target);
  };

  // Every step change (buttons, stepper, browser back / forward) starts at the top of the page
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [step]);

  // Opening a later step directly (reload, browser Forward) still needs the earlier steps to be valid
  const formReady = !loading && (!isEdit || Boolean(eventData.name));
  useEffect(() => {
    if (!formReady) return;
    for (let i = 0; i < step; i += 1) {
      const errs = validateStep(i);
      if (Object.keys(errs).length) {
        setStep(i, { replace: true });
        setFieldErrors(errs);
        return;
      }
    }
  }, [step, formReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Until the organizer edits the tiers, a new event's tiers follow the chosen category
  useEffect(() => {
    if (!isEdit && !tiersTouched.current) setTiers(categoryProfile(eventData.type).tiers.map((t) => ({ ...t })));
  }, [eventData.type, isEdit]);

  /**
   * The API found an event of yours with the same name. Same venue and time: offer to open it instead.
   * Otherwise ask; true means create it anyway.
   */
  const confirmDuplicate = async ({ duplicate }) => {
    if (duplicate.sameSlot) {
      const open = await dialog.confirm({
        tone: 'warning',
        title: 'This event already exists',
        message: `You already created “${duplicate.name}” at the same venue and time:\n${describeEvent(duplicate)}\nOpen it to carry on setting it up instead of creating it twice.`,
        confirmLabel: 'Open existing event',
        cancelLabel: 'Stay here',
      });
      if (open) navigate(`/organizer/events/${duplicate.id}/edit`);
      return false;
    }
    return dialog.confirm({
      tone: 'warning',
      title: 'Is this a duplicate?',
      message: `You already have an event called “${duplicate.name}”${duplicate.sameDay ? ' on the same day' : ''}:\n${describeEvent(duplicate)}\nIf you entered it again by mistake, go back and edit the existing one. Create a new event only if this is a separate show or date.`,
      confirmLabel: 'Create anyway',
      cancelLabel: 'Don’t create',
    });
  };

  // ---------- Save ----------
  const createEvent = async (status) => {
    if (savingRef.current) return;
    for (let i = 0; i < 3; i += 1) {
      const errs = validateStep(i);
      if (Object.keys(errs).length) {
        if (i !== step) setStep(i, { replace: true });
        setFieldErrors(errs);
        return;
      }
    }
    savingRef.current = true;
    setError('');
    setSubmitting(status);
    const send = async (allowDuplicate) => {
      const formData = new FormData();
      ['name', 'description', 'type', 'customCategoryId', 'date', 'time', 'endDate', 'endTime', 'city', 'venue', 'contactEmail'].forEach((key) => formData.append(key, eventData[key]));
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
      if (allowDuplicate) formData.append('allowDuplicate', 'true');

      const res = await fetch(`${API_URL}/api/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      return { res, data: await res.json() };
    };
    try {
      let { res, data } = await send(false);
      if (res.status === 409 && data.field === 'duplicate') {
        if (!(await confirmDuplicate(data))) return;
        ({ res, data } = await send(true));
      }
      if (!res.ok) {
        showServerError(data, 'Failed to create event');
        return;
      }

      // The event is saved unpublished. With a forecast: adjust prices first; either way step 4 is seating.
      if (status === 'PRELAUNCH_ANALYSIS') navigate(`/demand-forecast?eventId=${data.data.event.id}&setup=1`);
      else navigate(`/organizer/events/${data.data.event.id}/venue?setup=1`);
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'instant' });
    } finally {
      savingRef.current = false;
      setSubmitting(null);
    }
  };

  // Details and images in one request; the API swaps images only after every upload succeeds
  const saveEdits = async () => {
    if (savingRef.current) return;
    const errs = validateStep(0);
    if (Object.keys(errs).length) {
      setStep(0, { replace: true });
      setFieldErrors(errs);
      return;
    }
    savingRef.current = true;
    setError('');
    setSubmitting('SAVE');
    try {
      const formData = new FormData();
      ['name', 'description', 'type', 'customCategoryId', 'date', 'time', 'endDate', 'endTime', 'city', 'venue', 'contactEmail'].forEach((key) => formData.append(key, eventData[key]));
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
      showServerError(err.response?.data, err.message || 'Failed to save changes');
    } finally {
      savingRef.current = false;
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
  // New events go back to "Register or prebook", where the organizer came from
  const backHref = isEdit ? `/events/${editId}` : '/organizer/events/new';
  const profile = categoryProfile(eventData.type);
  const scheduleLocked = isEdit && ticketsHeld > 0;

  return (
    <div>
      <nav className="tl-wz-crumbs" aria-label="Breadcrumb">
        <Link to="/organizer/dashboard">Dashboard</Link>
        <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        {isEdit ? <Link to={`/events/${editId}`}>{eventData.name}</Link> : <Link to="/organizer/events/new" style={{ color: 'var(--st-green)' }}>Create event</Link>}
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
                <Field id="ev-name" label={profile.nameLabel} error={err('name')} wide>
                  <input id="ev-name" className="tl-wz-input" type="text" value={eventData.name} onChange={update('name')} placeholder={profile.namePlaceholder} aria-invalid={Boolean(err('name'))} />
                </Field>
                <Field id="ev-type" label="Event category" error={err('type')}>
                  <CategoryField
                    id="ev-type"
                    value={{ type: eventData.type, customCategoryId: eventData.customCategoryId || null }}
                    error={err('type')}
                    onChange={({ type, customCategoryId }) => {
                      setEventData((prev) => ({ ...prev, type, customCategoryId: customCategoryId || '' }));
                      if (fieldErrors.type) setFieldErrors((prev) => ({ ...prev, type: undefined }));
                    }}
                  />
                </Field>
                <Field id="ev-city" label="City in Pakistan">
                  <select id="ev-city" className="tl-wz-input" value={eventData.city} onChange={update('city')} disabled={scheduleLocked}>
                    {(CITIES.includes(eventData.city) ? CITIES : [eventData.city, ...CITIES]).map((city) => <option key={city} value={city}>{city}</option>)}
                  </select>
                </Field>
                <Field id="ev-venue" label={profile.venueLabel} error={err('venue')} wide>
                  <input id="ev-venue" disabled={scheduleLocked} className="tl-wz-input" type="text" value={eventData.venue} onChange={update('venue')} placeholder={profile.venuePlaceholder} aria-invalid={Boolean(err('venue'))} />
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
                <Field id="ev-date" label="Start date" error={err('date')}>
                  <input id="ev-date" disabled={scheduleLocked} className="tl-wz-input" type="date" value={eventData.date} min={isEdit ? undefined : todayIso()} onChange={update('date')} aria-invalid={Boolean(err('date'))} />
                </Field>
                <Field id="ev-time" label="Start time (PKT)" error={err('time')}>
                  <input id="ev-time" disabled={scheduleLocked} className="tl-wz-input" type="time" value={toTimeInput(eventData.time)} onChange={update('time')} aria-invalid={Boolean(err('time'))} />
                </Field>
                <Field id="ev-endDate" label="End date" error={err('endDate')}>
                  <input id="ev-endDate" disabled={scheduleLocked} className="tl-wz-input" type="date" value={eventData.endDate} min={eventData.date || undefined} onChange={update('endDate')} aria-invalid={Boolean(err('endDate'))} />
                </Field>
                <Field id="ev-endTime" label="End time (PKT)" error={err('endTime')}>
                  <input id="ev-endTime" disabled={scheduleLocked} className="tl-wz-input" type="time" value={toTimeInput(eventData.endTime)} onChange={update('endTime')} aria-invalid={Boolean(err('endTime'))} />
                </Field>
                {/* Venue availability, re-checked as the venue and times change */}
                {scheduleLocked && (
                  <div className="tl-wz-field is-wide">
                    <div className="tl-wz-dupe" role="note">
                      <CalendarDays className="w-4 h-4" aria-hidden="true" />
                      <div>
                        <strong>{ticketsHeld} ticket{ticketsHeld === 1 ? ' is' : 's are'} sold, so the date, time and venue are locked here</strong>
                        <p>Ticket holders have to be told about a new date and offered a refund. <Link to={`/organizer/events/${editId}/changes`}>Change the date or venue</Link>, postpone, or cancel the event there.</p>
                      </div>
                    </div>
                  </div>
                )}
                <div id="ev-schedule" tabIndex={-1} className="tl-wz-field is-wide" aria-live="polite">
                  {venueCheck.status === 'conflict' ? (
                    <p className="tl-wz-error" role="alert">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      {venueCheck.message}
                      {venueCheck.more > 0 && ` (${venueCheck.more} more booking${venueCheck.more === 1 ? '' : 's'} at this venue also clash.)`}
                    </p>
                  ) : venueCheck.status === 'checking' ? (
                    <p className="tl-wz-hint">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                      Checking whether {eventData.venue.trim()} is free at this time…
                    </p>
                  ) : venueCheck.status === 'free' ? (
                    <p className="tl-wz-hint" style={{ color: '#16a34a' }}>
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                      {eventData.venue.trim()} is free at this time, with at least an hour before and after other events.
                    </p>
                  ) : venueCheck.status === 'error' ? (
                    <p className="tl-wz-hint">Couldn’t check the venue right now. It will be checked again when you save.</p>
                  ) : (
                    <p className="tl-wz-hint">Running past midnight? Set the end date to the next day. Events at the same venue need at least one hour between them.</p>
                  )}
                </div>
                {duplicates.length > 0 && (
                  <div className="tl-wz-field is-wide">
                    <div className="tl-wz-dupe" role="status">
                      <Copy className="w-4 h-4" aria-hidden="true" />
                      <div>
                        <strong>You already have {duplicates.length === 1 ? 'an event' : `${duplicates.length} events`} called “{duplicates[0].name}”</strong>
                        <ul>
                          {duplicates.slice(0, 3).map((d) => (
                            <li key={d.id}>
                              {describeEvent(d)} · <Link to={`/organizer/events/${d.id}/edit`}>Open it</Link>
                            </li>
                          ))}
                        </ul>
                        <p>If you entered it again by mistake, edit the existing one instead. Carry on only if this is a separate show or date.</p>
                      </div>
                    </div>
                  </div>
                )}
                <Field id="ev-description" label={profile.descriptionLabel} error={err('description')} wide>
                  <textarea id="ev-description" className="tl-wz-input" rows={3} value={eventData.description} onChange={update('description')} placeholder={profile.descriptionPlaceholder} aria-invalid={Boolean(err('description'))} />
                </Field>
                <Field id="ev-contact" label="Contact email for attendees (optional)" error={err('contactEmail')} wide>
                  <input id="ev-contact" className="tl-wz-input" type="email" autoComplete="email" value={eventData.contactEmail} onChange={update('contactEmail')} placeholder={company?.email || 'events@yourcompany.pk'} aria-invalid={Boolean(err('contactEmail'))} aria-describedby="ev-contact-hint" />
                  <p id="ev-contact-hint" className="tl-wz-hint">Shown on the event page as “Contact organizer”. Leave empty to use your company email{company?.email ? ` (${company.email})` : ''}.</p>
                </Field>
              </div>
            </section>
          </div>
          <Tips
            title="Event setup tips"
            intro="A few quick tips to help you create a great event listing."
            items={[
              { icon: FileText, title: 'Clear and specific title', text: profile.titleTip },
              { icon: MapPin, title: 'Accurate venue and city', text: profile.venueTip },
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
                      <p>Create ticket tiers for your event. We’ve started you with typical tiers for this category; rename them, change prices and quantities, or add more.</p>
                    </div>
                    <button type="button" className="tl-wz-btn" style={{ minHeight: 46, padding: '0 20px' }} onClick={handleAddTier}>
                      <PlusCircle className="w-5 h-5" /> Add tier
                    </button>
                  </div>
                  <div className="tl-tier-list">
                    {tiers.map((tier, idx) => (
                      <div key={idx} className="tl-tier-row">
                        <Field id={`ev-tier-${idx}-name`} label="Tier name" error={err(`tier-${idx}-name`)}>
                          <input id={`ev-tier-${idx}-name`} className="tl-wz-input" type="text" value={tier.name} onChange={(e) => handleTierChange(idx, 'name', e.target.value)} placeholder={`e.g. ${profile.tiers[0].name}`} />
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
              { icon: Tag, title: 'Set clear tier names', text: `Use simple, descriptive names such as ${profile.tierExamples} so attendees understand their options.` },
              { icon: Tags, title: 'Check prices and quantities', text: 'Double-check ticket prices and total quantities. Make sure they match your event plan and venue capacity.' },
              { icon: Armchair, title: 'Seating comes next', text: 'After this step you set up the seating plan, then review your event and send it to TicketLedger for approval.' },
            ]}
          />
          )}
        </div>

        {/* ---------- Footer: back / next ---------- */}
        <div className="tl-wz-foot">
          {step === 0 ? (
            <Link to={backHref} className="tl-wz-btn"><ArrowLeft className="w-4 h-4" /> {isEdit ? 'Back to event page' : 'Back'}</Link>
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
