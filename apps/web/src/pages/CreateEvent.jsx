import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Building2, 
  Ticket, 
  Plus, 
  Trash2, 
  UploadCloud, 
  AlertCircle, 
  CheckCircle2, 
  ArrowLeft,
  Sparkles,
  Send
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CreateEvent() {
  const navigate = useNavigate();
  const { token } = useAuth();

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

  const [bannerFile, setBannerFile] = useState(null);

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

      if (bannerFile) {
        formData.append('banner', bannerFile);
      } else if (eventData.bannerUrl) {
        formData.append('bannerUrl', eventData.bannerUrl);
      }

      const res = await fetch(`${API_URL}/api/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create event');

      navigate(`/events/${data.data.event.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  // Guard: If company is not approved
  if (!company || company.status !== 'APPROVED') {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 bg-slate-900 border border-amber-900/50 rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 mx-auto flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-white">Organizer Verification Required</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
          As required by TicketLedger governance, only organizers with an <strong>APPROVED</strong> company registration can create and publish ticketed events.
        </p>
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300">
          Current Company Status: <span className="text-amber-400 font-bold">{company?.status || 'NOT_REGISTERED'}</span>
        </div>
        <Link
          to="/company"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-600/20"
        >
          <Building2 className="w-4 h-4" /> Go to Company Verification Portal
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/events"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-emerald-400 transition mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Events
        </Link>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Ticket className="w-6 h-6 text-emerald-400" /> Host a New Event
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Publish a sports match or music concert with tiered ticket pricing.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 text-xs">
        {/* Section 1: Event Details */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
            1. Event Specifications
          </h2>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Event Name / Match Title</label>
            <input
              type="text"
              required
              value={eventData.name}
              onChange={(e) => setEventData({ ...eventData, name: e.target.value })}
              placeholder="e.g. Lahore Qalandars vs Islamabad United - PSL 2026"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Event Category</label>
              <select
                value={eventData.type}
                onChange={(e) => setEventData({ ...eventData, type: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
              >
                <option value="CRICKET_MATCH">🏏 Cricket Match (PSL)</option>
                <option value="MUSIC_CONCERT">🎵 Music Concert</option>
                <option value="MUSIC_FESTIVAL">🎪 Music Festival</option>
                <option value="KABADDI">🤼 Kabaddi Match</option>
                <option value="FOOTBALL_MATCH">⚽ Football Match</option>
                <option value="BOXING">🥊 Boxing Match</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">City in Pakistan</label>
              <select
                value={eventData.city}
                onChange={(e) => setEventData({ ...eventData, city: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
              >
                <option value="Lahore">Lahore</option>
                <option value="Karachi">Karachi</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Rawalpindi">Rawalpindi</option>
                <option value="Faisalabad">Faisalabad</option>
                <option value="Multan">Multan</option>
                <option value="Peshawar">Peshawar</option>
                <option value="Quetta">Quetta</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Venue / Stadium</label>
              <input
                type="text"
                required
                value={eventData.venue}
                onChange={(e) => setEventData({ ...eventData, venue: e.target.value })}
                placeholder="e.g. Gaddafi Stadium"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Date</label>
              <input
                type="date"
                required
                value={eventData.date}
                onChange={(e) => setEventData({ ...eventData, date: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Time (PST)</label>
              <input
                type="text"
                required
                value={eventData.time}
                onChange={(e) => setEventData({ ...eventData, time: e.target.value })}
                placeholder="7:00 PM PST"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Event Description & Lineup</label>
            <textarea
              required
              rows={3}
              value={eventData.description}
              onChange={(e) => setEventData({ ...eventData, description: e.target.value })}
              placeholder="Provide event overview, team rosters, or musical schedule..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          {/* Banner Upload */}
          <div>
            <label className="block text-slate-300 font-medium mb-1">Event Banner Image</label>
            <div className="p-4 rounded-xl border border-dashed border-slate-800 bg-slate-950 text-center">
              <UploadCloud className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setBannerFile(e.target.files[0])}
                className="text-xs text-slate-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-slate-950 hover:file:bg-emerald-500 cursor-pointer"
              />
              <span className="block text-[10px] text-slate-500 mt-1">
                Optional: Cloudinary upload or leave empty for automatic sports banner
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Ticket Tiers & Pricing */}
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div>
              <h2 className="text-sm font-bold text-white">2. Ticket Tiers & Capacity</h2>
              <p className="text-[10px] text-slate-400">Configure ticket categories and original face value prices.</p>
            </div>

            <button
              type="button"
              onClick={handleAddTier}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 text-xs font-semibold border border-slate-700 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add Tier
            </button>
          </div>

          <div className="space-y-3">
            {tiers.map((tier, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
              >
                <div className="sm:col-span-5">
                  <label className="block text-[10px] text-slate-400 font-medium mb-1">Tier Name</label>
                  <input
                    type="text"
                    required
                    value={tier.name}
                    onChange={(e) => handleTierChange(idx, 'name', e.target.value)}
                    placeholder="e.g. General Enclosure / VIP"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-slate-400 font-medium mb-1">Price (PKR)</label>
                  <input
                    type="number"
                    required
                    min={100}
                    value={tier.price}
                    onChange={(e) => handleTierChange(idx, 'price', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500 text-xs font-mono"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-slate-400 font-medium mb-1">Total Quantity</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={tier.totalQuantity}
                    onChange={(e) => handleTierChange(idx, 'totalQuantity', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500 text-xs font-mono"
                  />
                </div>

                <div className="sm:col-span-1 flex items-end justify-center pt-3 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => handleRemoveTier(idx)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition"
                    title="Remove Tier"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" />
          {submitting ? 'Creating Event & Ticket Tiers...' : 'Publish Event on TicketLedger'}
        </button>
      </form>
    </div>
  );
}
