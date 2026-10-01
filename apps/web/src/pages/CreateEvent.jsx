import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { getEventVisual } from '../utils/eventMedia';
import ImageField, { emptyImageValue, imageValueSrc } from '../components/event-form/ImageField';
import GalleryField, { galleryItemsFromSaved } from '../components/event-form/GalleryField';
import {
  Calendar,
  Clock,
  MapPin,
  Building2,
  Ticket,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Sparkles,
  Send,
  Save,
  Image as ImageIcon
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta'];

const emptyImages = (event) => ({
  banner: emptyImageValue(event?.bannerUrl || null),
  cardImage: emptyImageValue(event?.cardImageUrl || null),
  galleryWide: emptyImageValue(event?.galleryWideUrl || null),
});

/** Create a new event, or (at /organizer/events/:id/edit) edit an existing event's details and images. */
export default function CreateEvent() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [company, setCompany] = useState(null);
  const [error, setError] = useState('');

  // Event form data
  const [eventData, setEventData] = useState({
    name: '',
    description: '',
    type: 'CRICKET_MATCH',
    date: '',
    time: '7:00 PM PST',
    city: 'Lahore',
    venue: '',
    status: 'PUBLISHED',
    bannerUrl: '',
  });

  // Organizer images: nothing is uploaded until the form is saved, so cancelling leaves the event as it was
  const [images, setImages] = useState(() => emptyImages(null));
  const [gallery, setGallery] = useState([]);
  const [savedGallery, setSavedGallery] = useState([]);
  const [loadError, setLoadError] = useState('');

  // Dynamic ticket tiers
  const [tiers, setTiers] = useState([
    { name: 'General Enclosure', price: 1500, totalQuantity: 500 },
    { name: 'VIP Pavilion', price: 5000, totalQuantity: 100 },
  ]);

  // Check company approval status
  useEffect(() => {
    async function checkCompanyStatus() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/companies/my-company`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok) {
          setCompany(data.data.company);
        }
      } catch (err) {
        console.error('Failed to check company:', err);
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      checkCompanyStatus();
    }
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
        setEventData({
          name: ev.name,
          description: ev.description,
          type: ev.type,
          date: new Date(ev.date).toISOString().slice(0, 10),
          time: ev.time,
          city: ev.city,
          venue: ev.venue,
          status: ev.status,
          bannerUrl: ev.bannerUrl || '',
        });
        setTiers(ev.tiers.map((t) => ({ name: t.name, price: Number(t.price), totalQuantity: t.totalQuantity })));
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

  const setImage = (field) => (value) => setImages((prev) => ({ ...prev, [field]: value }));

  // What the event page falls back to when a field is empty (same logic as the attendee pages)
  const artwork = getEventVisual({ type: eventData.type, name: eventData.name }, 0).bannerImage;
  const bannerSrc = imageValueSrc(images.banner);
  const bannerFallbackLabel = bannerSrc ? 'the Event Banner' : 'the category artwork shown here';

  const handleAddTier = () => {
    setTiers([...tiers, { name: '', price: 2000, totalQuantity: 100 }]);
  };

  const handleRemoveTier = (index) => {
    if (tiers.length <= 1) {
      alert('Event must have at least one ticket tier.');
      return;
    }
    setTiers(tiers.filter((_, i) => i !== index));
  };

  const handleTierChange = (index, field, value) => {
    const updated = [...tiers];
    updated[index][field] = field === 'price' || field === 'totalQuantity' ? Number(value) : value;
    setTiers(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    // Validate tiers
    for (const t of tiers) {
      if (!t.name.trim() || t.price <= 0 || t.totalQuantity <= 0) {
        setError('All ticket tiers must have a valid name, positive price, and quantity.');
        setSubmitting(false);
        return;
      }
    }

    if (isEdit) {
      await saveEdits();
      return;
    }

    try {
      const formData = new FormData();
      formData.append('name', eventData.name);
      formData.append('description', eventData.description);
      formData.append('type', eventData.type);
      formData.append('date', eventData.date);
      formData.append('time', eventData.time);
      formData.append('city', eventData.city);
      formData.append('venue', eventData.venue);
      formData.append('status', eventData.status);
      formData.append('tiers', JSON.stringify(tiers));

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

      if (eventData.status === 'PRELAUNCH_ANALYSIS') {
        navigate(`/demand-forecast?eventId=${data.data.event.id}`);
      } else {
        // Step 2 of setup: design the venue plan attendees will book from
        navigate(`/organizer/events/${data.data.event.id}/venue?setup=1`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Details and images in one request; the API swaps images only after every upload succeeds
  async function saveEdits() {
    try {
      const formData = new FormData();
      ['name', 'description', 'type', 'date', 'time', 'city', 'venue'].forEach((key) => formData.append(key, eventData[key]));
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
      navigate(`/events/${editId}`);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save changes');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  }

  if (isEdit && loadError) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-rose-200 rounded-3xl text-center space-y-4 shadow-sm">
        <AlertCircle className="w-6 h-6 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Can’t edit this event</h2>
        <p className="text-xs text-slate-500">{loadError}</p>
        <Link to="/organizer/dashboard" className="btn-eventfrog inline-flex items-center gap-1.5 px-5 py-2.5 text-xs shadow-sm">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
      </div>
    );
  }

  if (loading || (isEdit && !eventData.name)) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  // Guard: If company is not approved
  if (!company || company.status !== 'APPROVED') {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-white border border-amber-200 rounded-3xl text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center border border-amber-200">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Organizer Verification Required</h2>
        <p className="text-xs text-slate-500 leading-relaxed max-w-md mx-auto">
          As required by TicketLedger governance, only organizers with an <strong>APPROVED</strong> company registration can create and publish ticketed events.
        </p>
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700">
          Current Company Status: <span className="text-amber-600 font-bold">{company?.status || 'NOT_REGISTERED'}</span>
        </div>
        <Link
          to="/company"
          className="btn-eventfrog inline-flex items-center gap-1.5 px-5 py-2.5 text-xs shadow-sm"
        >
          <Building2 className="w-4 h-4" /> Go to Company Verification Portal
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 text-slate-800">
      {/* Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/90 shadow-sm">
        <Link
          to={isEdit ? `/events/${editId}` : '/events'}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#16a34a] transition mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> {isEdit ? 'Back to event page' : 'Back to Events'}
        </Link>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#212b36] tracking-tight flex items-center gap-2">
          <Ticket className="w-6 h-6 text-[#16a34a]" /> {isEdit ? 'Edit Event' : 'Host a New Event'}
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          {isEdit
            ? 'Update the details and images attendees see. Nothing changes until you save.'
            : 'Publish a sports match or music concert with tiered ticket pricing.'}
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 shadow-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 text-xs">
        {/* Section 1: Event Details */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            1. Event Specifications
          </h2>

          <div>
            <label className="block text-slate-700 font-semibold mb-1">Event Name / Match Title</label>
            <input
              type="text"
              required
              value={eventData.name}
              onChange={(e) => setEventData({ ...eventData, name: e.target.value })}
              placeholder="e.g. Lahore Qalandars vs Islamabad United - PSL 2026"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Event Category</label>
              <select
                value={eventData.type}
                onChange={(e) => setEventData({ ...eventData, type: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
              >
                <option value="CRICKET_MATCH">🏏 Cricket Match (PSL)</option>
                <option value="MUSIC_CONCERT">🎵 Music Concert</option>
                <option value="MUSIC_FESTIVAL">🎪 Music Festival</option>
                <option value="KABADDI">🤼 Kabaddi Match</option>
                <option value="FOOTBALL_MATCH">⚽ Football Match</option>
                <option value="BOXING">🥊 Boxing Match</option>
                <option value="HOCKEY_MATCH">🏑 Hockey Match</option>
                <option value="QAWWALI">🪘 Qawwali Night</option>
                <option value="THEATRE">🎭 Theatre</option>
                <option value="CONFERENCE">🎤 Conference</option>
                <option value="GENERAL_ADMISSION">🎟️ General Admission</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">City in Pakistan</label>
              <select
                value={eventData.city}
                onChange={(e) => setEventData({ ...eventData, city: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
              >
                {(CITIES.includes(eventData.city) ? CITIES : [eventData.city, ...CITIES]).map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Venue / Stadium</label>
              <input
                type="text"
                required
                value={eventData.venue}
                onChange={(e) => setEventData({ ...eventData, venue: e.target.value })}
                placeholder="e.g. Gaddafi Stadium"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Date</label>
              <input
                type="date"
                required
                value={eventData.date}
                onChange={(e) => setEventData({ ...eventData, date: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Time (PST)</label>
              <input
                type="text"
                required
                value={eventData.time}
                onChange={(e) => setEventData({ ...eventData, time: e.target.value })}
                placeholder="7:00 PM PST"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-semibold mb-1">Event Description & Lineup</label>
            <textarea
              required
              rows={3}
              value={eventData.description}
              onChange={(e) => setEventData({ ...eventData, description: e.target.value })}
              placeholder="Provide event overview, team rosters, or musical schedule..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
            />
          </div>

        </div>

        {/* Section 2: Event Images */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-[#16a34a]" /> 2. Event Images
            </h2>
            <p className="text-[10px] text-slate-500">
              Previews show how each image is cropped on the event pages. Images that don’t match a ratio can be cropped here.
            </p>
          </div>

          <ImageField kind="banner" value={images.banner} onChange={setImage('banner')} fallbackSrc={artwork} fallbackLabel="the category artwork shown here" />
          <ImageField kind="card" value={images.cardImage} onChange={setImage('cardImage')} fallbackSrc={bannerSrc || artwork} fallbackLabel={bannerFallbackLabel} />
          <ImageField kind="galleryWide" value={images.galleryWide} onChange={setImage('galleryWide')} fallbackSrc={bannerSrc || artwork} fallbackLabel={bannerFallbackLabel} />
          <GalleryField items={gallery} onChange={setGallery} savedItems={savedGallery} />
        </div>

        {/* Section 3: Ticket Tiers & Pricing (set at creation; price changes go through the forecast tools) */}
        {isEdit ? (
          <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-3">
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">3. Ticket Tiers</h2>
            <ul className="divide-y divide-slate-100">
              {tiers.map((tier) => (
                <li key={tier.name} className="py-2 flex justify-between gap-4">
                  <span className="font-semibold text-slate-700">{tier.name}</span>
                  <span className="font-mono text-slate-500">PKR {tier.price.toLocaleString()} · {tier.totalQuantity} seats</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-slate-500">
              Seats, sections and tier quantities are set in{' '}
              <Link to={`/organizer/events/${editId}/venue`} className="text-[#16a34a] font-semibold hover:underline">Venue &amp; Seating</Link>.{' '}
              Tiers aren’t edited here. Adjust prices from the{' '}
              <Link to={`/demand-forecast?eventId=${editId}`} className="text-[#16a34a] font-semibold hover:underline">Pre-Launch Demand Forecast</Link>.
            </p>
          </div>
        ) : (
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">3. Ticket Tiers & Capacity</h2>
              <p className="text-[10px] text-slate-500">Configure ticket categories and original face value prices.</p>
            </div>

            <button
              type="button"
              onClick={handleAddTier}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#16a34a] text-xs font-semibold border border-emerald-200 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Tier
            </button>
          </div>

          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div
                key={idx}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
              >
                <div className="sm:col-span-5">
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Tier Name</label>
                  <input
                    type="text"
                    required
                    value={tier.name}
                    onChange={(e) => handleTierChange(idx, 'name', e.target.value)}
                    placeholder="e.g. General Enclosure / VIP"
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Price (PKR)</label>
                  <input
                    type="number"
                    required
                    min={100}
                    value={tier.price}
                    onChange={(e) => handleTierChange(idx, 'price', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs font-mono"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-slate-500 font-semibold mb-1">Total Quantity</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={tier.totalQuantity}
                    onChange={(e) => handleTierChange(idx, 'totalQuantity', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs font-mono"
                  />
                </div>

                <div className="sm:col-span-1 flex items-end justify-center pt-3 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => handleRemoveTier(idx)}
                    className="p-1.5 text-slate-400 hover:text-rose-500 transition"
                    title="Remove Tier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {isEdit ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link
              to={`/events/${editId}`}
              className="w-full py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs border border-slate-300 shadow-sm transition flex items-center justify-center gap-2"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 btn-eventfrog text-xs shadow-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {submitting ? 'Saving changes…' : 'Save Changes'}
            </button>
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="submit"
            onClick={() => setEventData((prev) => ({ ...prev, status: 'PRELAUNCH_ANALYSIS' }))}
            disabled={submitting}
            className="w-full py-3.5 btn-eventfrog text-xs shadow-sm flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {submitting ? 'Processing...' : 'Pre-Launch Demand Forecast & Pricing'}
          </button>

          <button
            type="submit"
            onClick={() => setEventData((prev) => ({ ...prev, status: 'PUBLISHED' }))}
            disabled={submitting}
            className="w-full py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs border border-slate-300 shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4 text-[#16a34a]" />
            {submitting ? 'Creating Event...' : 'Publish Directly Without Forecast'}
          </button>
        </div>
        )}
      </form>
    </div>
  );
}
