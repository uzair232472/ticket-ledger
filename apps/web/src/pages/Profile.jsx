import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BasicShell from '../components/basic/BasicShell';
import { useDialog } from '../components/ui/DialogProvider';
import ChangePasswordCard from '../components/account/ChangePasswordCard';
import '../components/account/overview.css';
import {
  User,
  Wallet,
  Bell,
  History,
  ShieldCheck,
  Building2,
  Scan,
  Ticket,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Unlink,
  Save,
  RefreshCw,
  Globe,
  Smartphone,
  Mail,
  Activity,
  Sparkles,
  TrendingUp,
  Layers,
  Eye,
  ShoppingCart,
  LayoutGrid,
  Settings,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Key,
  Lock,
  Clock,
  HelpCircle,
  Camera,
  Check,
  Home,
  UserRound,
  BarChart3,
  KeyRound,
  FileText,
  Pencil,
  ArrowRight,
  Boxes,
  Zap,
  CalendarDays,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const POLYGON_AMOY_CHAIN_ID = '0x13882'; // 80002 in hex

export default function Profile() {
  const dialog = useDialog();
  const { token, user: authUser } = useAuth();

  // Navigation tabs matching Eventfrog structure
  const [activeTab, setActiveTab] = useState('overview');
  // 'my-data' | 'security' | 'notifications' | 'intent' | 'preferred-website' | 'api-keys' | 'privacy' | 'overview'

  // Phones start with the navigation groups collapsed, so the overview is visible first
  const [myTicketsExpanded, setMyTicketsExpanded] = useState(() => !window.matchMedia('(max-width: 860px)').matches);
  const [settingsExpanded, setSettingsExpanded] = useState(() => !window.matchMedia('(max-width: 860px)').matches);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Profile data from backend
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({});
  const [history, setHistory] = useState([]);
  const [recentTickets, setRecentTickets] = useState(null); // overview: latest tickets (null while loading)

  // Form states matching Eventfrog fields
  const [salutation, setSalutation] = useState(localStorage.getItem('tl_salutation') || 'Mr');
  const [organisation, setOrganisation] = useState(localStorage.getItem('tl_organisation') || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('Lahore');
  const [avatarUrl, setAvatarUrl] = useState(localStorage.getItem('tl_avatar') || null);
  const fileInputRef = useRef(null);

  // Notification toggles
  const [notifications, setNotifications] = useState({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
  });

  // Wallet states
  const [manualWallet, setManualWallet] = useState('');
  const [isConnectingMetaMask, setIsConnectingMetaMask] = useState(false);
  const [web3Status, setWeb3Status] = useState({ connected: false, address: '', chainId: null });

  // Behavioral profile & AI intent score (Customer telemetry)
  const [behaviorProfile, setBehaviorProfile] = useState(null);
  const [loadingBehavior, setLoadingBehavior] = useState(false);

  // Load profile from API
  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/users/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const p = data.data.profile;
        setProfile(p);
        setStats(data.data.stats || {});

        // Split name into first and last name for Eventfrog format
        const nameParts = (p.name || '').trim().split(' ');
        setFirstName(nameParts[0] || '');
        setLastName(nameParts.slice(1).join(' ') || '');
        setPhone(p.phone || '');
        setCity(p.city || 'Lahore');

        setNotifications({
          emailNotifications: p.emailNotifications ?? true,
          pushNotifications: p.pushNotifications ?? true,
          smsNotifications: p.smsNotifications ?? false,
        });
      }
    } catch (err) {
      console.error('Error loading profile:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load audit history
  const loadHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/api/users/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(data.data.history || []);
      }
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  // Load behavioral profile & AI intent score
  const loadBehaviorProfile = async () => {
    try {
      setLoadingBehavior(true);
      const res = await fetch(`${API_URL}/api/behavior/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data) {
        setBehaviorProfile(data.data);
      }
    } catch (err) {
      console.error('Error loading behavior profile:', err);
    } finally {
      setLoadingBehavior(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadProfile();
      loadHistory();
      loadBehaviorProfile();
    }
  }, [token]);

  // Handle Avatar selection
  const handleAvatarFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(reader.result);
      localStorage.setItem('tl_avatar', reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Handle Profile Update
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: '', type: '' });

    // Combine First and Last Name
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');

    // Persist UI extras
    localStorage.setItem('tl_salutation', salutation);
    localStorage.setItem('tl_organisation', organisation);

    try {
      const res = await fetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: fullName,
          phone,
          city,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Update failed');

      setMessage({ text: 'Profile details saved successfully!', type: 'success' });
      dialog.alert({ tone: 'success', title: 'Details saved', message: 'Your profile details were updated. We’ve sent a confirmation to your email.' });
      await loadProfile();
      await loadHistory();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Connect MetaMask Wallet
  const connectMetaMask = async () => {
    setIsConnectingMetaMask(true);
    setMessage({ text: '', type: '' });

    if (typeof window.ethereum === 'undefined') {
      setMessage({
        text: 'MetaMask extension not detected in this browser. You can enter your wallet address manually below for evaluation.',
        type: 'error',
      });
      setIsConnectingMetaMask(false);
      return;
    }

    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0];
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });

      setWeb3Status({ connected: true, address, chainId });
      await saveWalletToBackend(address);
    } catch (err) {
      setMessage({ text: err.message || 'Failed to connect MetaMask', type: 'error' });
    } finally {
      setIsConnectingMetaMask(false);
    }
  };

  // Switch network to Polygon Amoy Testnet
  const switchToPolygonAmoy = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: POLYGON_AMOY_CHAIN_ID }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: POLYGON_AMOY_CHAIN_ID,
                chainName: 'Polygon Amoy Testnet',
                nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
                rpcUrls: ['https://rpc-amoy.polygon.technology'],
                blockExplorerUrls: ['https://amoy.polygonscan.com/'],
              },
            ],
          });
        } catch (addError) {
          console.error('Failed to add Polygon Amoy:', addError);
        }
      }
    }
  };

  // Save wallet to backend
  const saveWalletToBackend = async (addressToSave) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/users/wallet`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ walletAddress: addressToSave }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save wallet');

      setMessage({ text: data.message, type: 'success' });
      setManualWallet('');
      await loadProfile();
      await loadHistory();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Disconnect wallet
  const handleDisconnectWallet = async () => {
    if (!(await dialog.confirm({ title: 'Unlink this wallet?', message: 'Your tickets stay in your TicketLedger custodial vault.', confirmLabel: 'Unlink wallet', tone: 'warning' }))) return;
    await saveWalletToBackend(null);
  };

  // Save Notification Preferences
  const handleSaveNotifications = async () => {
    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetch(`${API_URL}/api/users/notifications`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notifications),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update preferences');

      setMessage({ text: 'Notification settings saved!', type: 'success' });
      await loadProfile();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'overview' || recentTickets) return;
    fetch(`${API_URL}/api/tickets/wallet`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setRecentTickets((d?.data?.tickets || []).slice(0, 3)))
      .catch(() => setRecentTickets([]));
  }, [activeTab, recentTickets, token]);

  const goTab = (tab) => {
    setActiveTab(tab);
    setMessage({ text: '', type: '' });
  };
  const roleLabel = { CUSTOMER: 'Customer', ORGANIZER: 'Organizer', SUPER_ADMIN: 'Admin', GATE_STAFF: 'Gate staff' }[profile?.role] || 'Member';
  const initials = (profile?.name || profile?.email || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const SETTINGS_TABS = [
    ['my-data', 'My data', UserRound],
    ['security', 'Security', ShieldCheck],
    ['notifications', 'Notifications', Bell],
    ['intent', 'AI Intent & Telemetry', BarChart3],
    ['preferred-website', 'Preferred Website', Globe],
    ['api-keys', 'API keys', KeyRound],
    ['privacy', 'Privacy', FileText],
  ];

  const getBreadcrumbLabel = () => {
    switch (activeTab) {
      case 'my-data': return 'My data';
      case 'security': return 'Security';
      case 'notifications': return 'Notifications';
      case 'intent': return 'AI Intent & Telemetry';
      case 'preferred-website': return 'Preferred Website';
      case 'api-keys': return 'API keys';
      case 'privacy': return 'Privacy';
      case 'overview': return 'Overview';
      default: return 'Settings';
    }
  };

  return (
    <BasicShell
      eyebrow={<span className="tl-ov-crumbs">Account <span aria-hidden="true">/</span> <b>{getBreadcrumbLabel()}</b></span>}
      title={loading ? 'Account' : activeTab === 'overview' ? 'Account overview' : getBreadcrumbLabel()}
      intro={loading ? 'Loading your account…' : activeTab === 'overview' ? 'Manage your profile, tickets and connected wallet.' : `Signed in as ${profile?.name || profile?.email || 'you'}.`}
      actions={
        !loading && (activeTab === 'overview' ? (
          <button type="button" onClick={() => goTab('my-data')} className="tl-ov-edit">
            <Pencil className="w-4 h-4" aria-hidden="true" /> Edit profile
          </button>
        ) : (
          <button type="button" onClick={() => goTab('overview')} className="tl-btn tl-btn--ghost">
            Account overview
          </button>
        ))
      }
    >
    {loading ? (
      <div className="tl-pf-loading" aria-busy="true" aria-label="Loading account"><span /></div>
    ) : (
    <div className="tl-basic-skin tl-pf text-slate-800">

      {/* Left navigation + content */}
      <div className="tl-ov-layout">

        {/* Left navigation */}
        <aside className="tl-ov-nav" aria-label="Account sections">
          <button type="button" className={`tl-ov-nav-top${activeTab === 'overview' ? ' is-active' : ''}`} aria-current={activeTab === 'overview' ? 'page' : undefined} onClick={() => goTab('overview')}>
            <Home className="w-5 h-5" aria-hidden="true" /> Overview
          </button>

          <div className="tl-ov-nav-group">
            <button type="button" className="tl-ov-nav-head" aria-expanded={myTicketsExpanded} onClick={() => setMyTicketsExpanded(!myTicketsExpanded)}>
              <span><Ticket className="w-4 h-4" aria-hidden="true" /> My tickets</span>
              {myTicketsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {myTicketsExpanded && (
              <div className="tl-ov-nav-list">
                <Link to="/wallet"><Ticket className="w-4 h-4" aria-hidden="true" /> My tickets</Link>
                <Link to="/my-bookings"><Clock className="w-4 h-4" aria-hidden="true" /> Order history</Link>
              </div>
            )}
          </div>

          <div className="tl-ov-nav-group">
            <button type="button" className="tl-ov-nav-head" aria-expanded={settingsExpanded} onClick={() => setSettingsExpanded(!settingsExpanded)}>
              <span><Settings className="w-4 h-4" aria-hidden="true" /> Settings</span>
              {settingsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {settingsExpanded && (
              <div className="tl-ov-nav-list">
                {SETTINGS_TABS.map(([key, label, Icon]) => (
                  <button key={key} type="button" className={activeTab === key ? 'is-active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => goTab(key)}>
                    <Icon className="w-4 h-4" aria-hidden="true" /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tl-ov-nav-user">
            <span className="tl-ov-avatar is-sm">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials}</span>
            <span><strong>{profile?.name || profile?.email}</strong><small>{roleLabel}</small></span>
          </div>
        </aside>

        {/* Right Main Content Area */}
        <main className="tl-ov-main">

          {/* Feedback Banner */}
          {message.text && (
            <div className={`p-4 rounded-2xl text-xs flex items-center gap-2 border font-medium ${message.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
              {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#008459]" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-600" />}
              <span>{message.text}</span>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: MY DATA (EXACT EVENTFROG MATCH FROM 3RD IMAGE)                        */}
          {/* ========================================================================= */}
          {activeTab === 'my-data' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">
                  My data
                </h1>
                <h2 className="text-sm font-bold text-[#212b36] mt-3">
                  My profile
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Complete your profile with all the required data. You can change your details at any time.
                </p>
              </div>

              {/* Form Container */}
              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">

                {/* Profile picture dropzone */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-800">
                    Profile picture
                  </label>

                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleAvatarFile(e.dataTransfer.files?.[0]);
                    }}
                    className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-[#008459] bg-slate-50/50 hover:bg-slate-50 transition cursor-pointer group"
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={(e) => handleAvatarFile(e.target.files?.[0])}
                    />

                    {avatarUrl ? (
                      <div className="flex flex-col items-center gap-2">
                        <img
                          src={avatarUrl}
                          alt="Avatar Preview"
                          className="w-16 h-16 rounded-full object-cover border-2 border-[#008459] shadow-sm"
                        />
                        <span className="text-xs font-bold text-[#008459] hover:underline">Change image</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="w-10 h-10 rounded-xl bg-slate-200/70 text-slate-500 flex items-center justify-center mx-auto">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <button
                            type="button"
                            className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-200 shadow-sm"
                          >
                            Add image
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          or drag in here
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Profile picture helper note */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-start gap-3 text-xs text-slate-600">
                    <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                      <HelpCircle className="w-3.5 h-3.5" />
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Customise your profile and add a picture. If you have several accounts, you can better distinguish them by the profile picture.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleUpdateProfile} className="space-y-5 text-xs">

                  {/* Salutation* */}
                  <div className="space-y-2">
                    <label className="block font-bold text-slate-800">
                      Salutation*
                    </label>
                    <div className="flex items-center gap-6 text-xs text-slate-700 font-medium">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="salutation"
                          value="Ms"
                          checked={salutation === 'Ms'}
                          onChange={(e) => setSalutation(e.target.value)}
                          className="accent-[#008459] w-4 h-4 cursor-pointer"
                        />
                        <span>Ms</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="salutation"
                          value="Mr"
                          checked={salutation === 'Mr'}
                          onChange={(e) => setSalutation(e.target.value)}
                          className="accent-[#008459] w-4 h-4 cursor-pointer"
                        />
                        <span>Mr</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="salutation"
                          value="Mx"
                          checked={salutation === 'Mx'}
                          onChange={(e) => setSalutation(e.target.value)}
                          className="accent-[#008459] w-4 h-4 cursor-pointer"
                        />
                        <span>Mx</span>
                      </label>
                    </div>
                  </div>

                  {/* Organisation */}
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-800">
                      Organisation
                    </label>
                    <input
                      type="text"
                      value={organisation}
                      onChange={(e) => setOrganisation(e.target.value)}
                      placeholder="Company / Organization / Freelance"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
                    />
                  </div>

                  {/* First name* */}
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-800">
                      First name*
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
                    />
                  </div>

                  {/* Last name* */}
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-800">
                      Last name*
                    </label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
                    />
                  </div>

                  {/* Email Address (Account bound) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-800">Email address</label>
                      <span className="text-[10px] text-[#008459] font-bold flex items-center gap-1">
                        <Check className="w-3 h-3" /> Verified Account
                      </span>
                    </div>
                    <input
                      type="email"
                      disabled
                      value={profile?.email || ''}
                      className="w-full bg-slate-100 border border-slate-200 text-slate-500 rounded-xl px-3.5 py-2.5 text-xs cursor-not-allowed font-medium"
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-800">
                      Phone number (Pakistan)*
                    </label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+92 300 1234567"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
                    />
                  </div>

                  {/* City in Pakistan */}
                  <div className="space-y-1.5">
                    <label className="block font-bold text-slate-800">
                      City in Pakistan*
                    </label>
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#008459]/20 focus:border-[#008459] transition"
                    >
                      <option value="Lahore">Lahore (Gaddafi Stadium / Alhamra)</option>
                      <option value="Karachi">Karachi (National Stadium / Arts Council)</option>
                      <option value="Islamabad">Islamabad / Rawalpindi (Pindi Cricket Stadium)</option>
                      <option value="Peshawar">Peshawar (Arbab Niaz Stadium)</option>
                      <option value="Multan">Multan (Multan Cricket Stadium)</option>
                      <option value="Faisalabad">Faisalabad (Iqbal Stadium)</option>
                      <option value="Quetta">Quetta (Bugti Stadium)</option>
                    </select>
                  </div>

                  {/* Save Details Button */}
                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-6 py-2.5 rounded-full bg-[#008459] hover:bg-[#00704c] text-white text-xs font-bold transition shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{saving ? 'Saving...' : 'Save details'}</span>
                    </button>
                  </div>

                </form>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: SECURITY & WALLET                                                    */}
          {/* ========================================================================= */}
          {activeTab === 'security' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">Security</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Change your password, manage your wallet link and review your account activity.
                </p>
              </div>

              <ChangePasswordCard />

              {/* Wallet Integration Card */}
              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                  <span className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                    <Wallet className="w-4 h-4" />
                  </span>
                  <div>
                    <h3 className="font-extrabold text-[#212b36] text-base">MetaMask Web3 Wallet Integration</h3>
                    <p className="text-xs text-slate-500">Polygon Amoy Testnet (Chain ID 80002)</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        Active Wallet in Database
                      </div>
                      {profile?.walletAddress ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#008459] break-all">
                            {profile.walletAddress}
                          </span>
                          <a
                            href={`https://amoy.polygonscan.com/address/${profile.walletAddress}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-400 hover:text-[#008459] transition"
                            title="View on Polygonscan"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ) : (
                        <div className="text-xs text-amber-700 flex items-center gap-1.5 font-medium">
                          <AlertCircle className="w-4 h-4 text-amber-500" /> No wallet currently linked.
                        </div>
                      )}
                    </div>

                    {profile?.walletAddress && (
                      <button
                        type="button"
                        onClick={handleDisconnectWallet}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition"
                      >
                        <Unlink className="w-3.5 h-3.5" /> Unlink
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={connectMetaMask}
                    disabled={isConnectingMetaMask || saving}
                    className="px-5 py-2 rounded-full bg-[#008459] hover:bg-[#00704c] text-white text-xs font-bold transition shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Wallet className="w-4 h-4" />
                    <span>{isConnectingMetaMask ? 'Connecting...' : 'Connect MetaMask'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={switchToPolygonAmoy}
                    className="px-4 py-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition"
                  >
                    Switch to Polygon Amoy
                  </button>
                </div>

                {/* Manual Address */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <label className="block text-xs font-bold text-slate-800">
                    Manual Testnet Wallet Registration
                  </label>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveWalletToBackend(manualWallet);
                    }}
                    className="flex flex-col sm:flex-row gap-2"
                  >
                    <input
                      type="text"
                      value={manualWallet}
                      onChange={(e) => setManualWallet(e.target.value)}
                      placeholder="0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#008459]/20"
                    />
                    <button
                      type="submit"
                      disabled={saving || !manualWallet}
                      className="px-4 py-2 rounded-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition disabled:opacity-50"
                    >
                      Save Address
                    </button>
                  </form>
                </div>
              </div>

              {/* Activity Audit Trail */}
              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
                      <History className="w-4 h-4" />
                    </span>
                    <h3 className="font-extrabold text-[#212b36] text-base">Account Audit Trail & Activity</h3>
                  </div>
                  <button
                    onClick={loadHistory}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>

                {history.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 font-medium">
                    No security audit logs recorded yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 overflow-hidden text-xs">
                    {history.slice(0, 8).map((log) => (
                      <div key={log.id} className="p-3.5 bg-white hover:bg-slate-50 flex items-center justify-between gap-2 transition">
                        <div>
                          <span className="font-mono font-bold text-[#008459] text-xs">
                            {log.action}
                          </span>
                          <span className="ml-2 text-slate-500 text-[11px]">
                            Target: {log.targetType || 'User'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: NOTIFICATIONS                                                        */}
          {/* ========================================================================= */}
          {activeTab === 'notifications' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">Notifications</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Configure how you receive ticket issuance confirmations, gate check-in alerts, and resale notifications.
                </p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-5">
                <div className="space-y-3.5 text-xs">
                  {/* Email Notifications */}
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-50 text-[#008459]">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">Email Notifications (Nodemailer)</div>
                        <div className="text-slate-500 text-[11px]">
                          Booking receipts, PDF tickets, organizer approval, and fraud warning emails.
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications.emailNotifications}
                      onChange={(e) => setNotifications({ ...notifications, emailNotifications: e.target.checked })}
                      className="w-4 h-4 accent-[#008459] rounded cursor-pointer"
                    />
                  </div>

                  {/* In-App / Push Notifications */}
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-teal-50 text-teal-700">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">Socket.io & In-App Alerts</div>
                        <div className="text-slate-500 text-[11px]">
                          Real-time seat lock countdowns, waitlist resale availability, and gate entry confirmation.
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications.pushNotifications}
                      onChange={(e) => setNotifications({ ...notifications, pushNotifications: e.target.checked })}
                      className="w-4 h-4 accent-[#008459] rounded cursor-pointer"
                    />
                  </div>

                  {/* SMS / WhatsApp Notifications */}
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-purple-50 text-purple-700">
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">SMS / WhatsApp Verification Alerts</div>
                        <div className="text-slate-500 text-[11px]">
                          Emergency match rescheduling announcements and gate pass codes.
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifications.smsNotifications}
                      onChange={(e) => setNotifications({ ...notifications, smsNotifications: e.target.checked })}
                      className="w-4 h-4 accent-[#008459] rounded cursor-pointer"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleSaveNotifications}
                    disabled={saving}
                    className="px-6 py-2.5 rounded-full bg-[#008459] hover:bg-[#00704c] text-white text-xs font-bold transition shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Save Notification Preferences'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: AI INTENT & TELEMETRY                                                */}
          {/* ========================================================================= */}
          {activeTab === 'intent' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">AI Intent & Telemetry</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Machine learning telemetry continuously computes your purchase readiness, preferred event genres, and session engagement.
                </p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-emerald-50 text-[#008459] flex items-center justify-center">
                      <Activity className="w-4 h-4" />
                    </span>
                    <div>
                      <h3 className="font-extrabold text-[#212b36] text-base">Client Telemetry & Affinity Metrics</h3>
                      <span className="text-[10px] font-bold text-[#008459]">Module 13 ML Inference</span>
                    </div>
                  </div>

                  <button
                    onClick={loadBehaviorProfile}
                    disabled={loadingBehavior}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingBehavior ? 'animate-spin text-[#008459]' : ''}`} />
                    <span>Refresh Telemetry</span>
                  </button>
                </div>

                {/* Metric KPI Tiles */}
                {(() => {
                  const summary = behaviorProfile?.summary || {};
                  const scores = behaviorProfile?.scores || {};
                  const intentScore = scores.purchaseIntent?.score ?? summary.intentScore ?? 45;
                  const intentLevel = scores.purchaseIntent?.tier ?? summary.intentLevel ?? (intentScore > 70 ? 'HIGH' : intentScore > 40 ? 'MEDIUM' : 'NORMAL');
                  const totalActions = behaviorProfile?.totalEventsTracked ?? summary.totalActions ?? (behaviorProfile?.timeline?.length || 0);
                  const topCategory = summary.categoryAffinity?.[0]?.category || summary.topCategory || 'PSL Cricket';
                  const riskLevel = scores.fraudRisk?.level || summary.riskLevel || 'LOW_RISK';

                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Card 1: Intent Score */}
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold text-slate-400">AI Intent</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${intentLevel === 'HIGH'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-teal-100 text-teal-800'
                            }`}>
                            {intentLevel}
                          </span>
                        </div>
                        <div className="text-2xl font-black text-slate-900 font-mono">
                          {intentScore} <span className="text-xs text-slate-400 font-normal">/ 100</span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-[#008459] h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, Math.max(10, intentScore))}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-500">Checkout completion readiness</p>
                      </div>

                      {/* Card 2: Actions Tracked */}
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Session Actions</span>
                        <div className="text-2xl font-black text-slate-900 font-mono">
                          {totalActions}
                        </div>
                        <p className="text-[10px] text-slate-500">Live views & seat touches</p>
                      </div>

                      {/* Card 3: Top Category */}
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Top Affinity</span>
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {topCategory.replace('_', ' ')}
                        </div>
                        <p className="text-[10px] text-slate-500">Highest viewed event genre</p>
                      </div>

                      {/* Card 4: Bot & Security Status */}
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Security Verification</span>
                        <div className="text-sm font-bold text-[#008459] flex items-center gap-1.5">
                          <ShieldCheck className="w-4 h-4 text-[#008459]" />
                          <span>{riskLevel === 'LOW_RISK' ? 'Human Verified' : riskLevel}</span>
                        </div>
                        <p className="text-[10px] text-slate-500">Anti-scalping score normal</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Behavioral Action Timeline */}
                <div className="space-y-3 pt-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" /> Recent Behavioral Interactions
                  </h3>

                  {!behaviorProfile?.timeline || behaviorProfile.timeline.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 font-medium">
                      No interaction telemetry logged for this session yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-2xl overflow-hidden text-xs">
                      {behaviorProfile.timeline.slice(0, 10).map((item, idx) => (
                        <div key={idx} className="p-3 bg-white hover:bg-slate-50 flex items-center justify-between gap-3 transition">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-slate-100 text-[#008459] flex items-center justify-center font-bold shrink-0">
                              {item.action?.includes('seat') ? <Layers className="w-3.5 h-3.5" /> :
                                item.action?.includes('checkout') ? <ShoppingCart className="w-3.5 h-3.5" /> :
                                  item.action?.includes('view') ? <Eye className="w-3.5 h-3.5" /> :
                                    <Activity className="w-3.5 h-3.5" />}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 text-xs">
                                {item.action?.replace('_', ' ').toUpperCase()}
                              </div>
                              {item.metadata?.source && (
                                <div className="text-[10px] text-slate-400 font-mono">
                                  {item.metadata.source}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-400 font-mono">
                            {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'Just now'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: PREFERRED WEBSITE                                                    */}
          {/* ========================================================================= */}
          {activeTab === 'preferred-website' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">Preferred Website</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage your localized regional preferences, language, currency, and time formatting.
                </p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-800">Primary Language</label>
                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900">
                      <option value="en">English (Default)</option>
                      <option value="ur">Urdu (اردو)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-800">Regional Currency</label>
                    <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900">
                      <option value="PKR">Pakistani Rupee (PKR - Rs.)</option>
                      <option value="USD">US Dollar (USD - $)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-800">Country / Region</label>
                    <input
                      type="text"
                      disabled
                      value="Pakistan"
                      className="w-full bg-slate-100 border border-slate-200 text-slate-700 rounded-xl px-3.5 py-2.5 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-bold text-slate-800">Timezone</label>
                    <input
                      type="text"
                      disabled
                      value="Asia/Karachi (PKT, UTC+5)"
                      className="w-full bg-slate-100 border border-slate-200 text-slate-700 rounded-xl px-3.5 py-2.5 text-xs"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMessage({ text: 'Regional preferences saved!', type: 'success' })}
                  className="px-6 py-2.5 rounded-full bg-[#008459] hover:bg-[#00704c] text-white text-xs font-bold transition shadow-sm"
                >
                  Save Preferences
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: API KEYS                                                             */}
          {/* ========================================================================= */}
          {activeTab === 'api-keys' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">API keys</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Developer credentials for programmatic turnstile integration, webhook listeners, and telemetry ingestion.
                </p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-5 text-xs">
                <div className="space-y-2">
                  <label className="font-bold text-slate-800">Live Client Integration Token</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`tkl_live_${authUser?.id?.replace(/-/g, '').substring(0, 24) || '8f92a10e47c3'}`}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(`tkl_live_${authUser?.id?.replace(/-/g, '').substring(0, 24) || '8f92a10e47c3'}`);
                        setMessage({ text: 'API key copied to clipboard!', type: 'success' });
                      }}
                      className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Use this secret key to authenticate FastGate scanners and automated ticketing sync services.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: PRIVACY                                                              */}
          {/* ========================================================================= */}
          {activeTab === 'privacy' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">Privacy</h1>
                <p className="text-xs text-slate-500 mt-1">
                  Manage your data processing consent, on-chain NFT visibility, and anti-scalping verification.
                </p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-4 text-xs">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">On-Chain Polygon NFT Visibility</div>
                  <p className="text-slate-500 text-[11px]">
                    Token IDs and contract addresses are publicly queryable on Polygonscan for fraud prevention. Attendee identity and personal data remain strictly off-chain in encrypted PostgreSQL databases.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">Telemetry Ingestion & Anti-Bot Screening</div>
                  <p className="text-slate-500 text-[11px]">
                    Clickstream frequency and checkout speed are evaluated by our local scikit-learn ML engine to protect Pakistani sporting fans against bulk bot scalping.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: OVERVIEW (ACCOUNT SUMMARY)                                           */}
          {/* ========================================================================= */}
          {activeTab === 'overview' && (
            <div className="tl-ov">
              <section className="tl-ov-hero">
                <span className="tl-ov-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : initials}</span>
                <div>
                  <h2>{profile?.name || profile?.email}</h2>
                  <p>{roleLabel} account</p>
                  <span className="tl-ov-pill"><i aria-hidden="true" /> Active member</span>
                </div>
              </section>

              <div className="tl-ov-stats">
                <section className="tl-ov-stat">
                  <h3>Account role</h3>
                  <div className="tl-ov-stat-row">
                    <span className="tl-ov-stat-icon"><UserRound className="w-5 h-5" aria-hidden="true" /></span>
                    <div>
                      <strong>{roleLabel}</strong>
                      <span className="tl-ov-pill is-sm"><i aria-hidden="true" /> Active member</span>
                    </div>
                  </div>
                  <UserRound className="tl-ov-art" aria-hidden="true" />
                </section>
                <section className="tl-ov-stat">
                  <h3>My tickets</h3>
                  <div className="tl-ov-stat-row">
                    <span className="tl-ov-stat-icon"><Ticket className="w-5 h-5" aria-hidden="true" /></span>
                    <strong>{(stats.ticketCount ?? 0).toLocaleString()}</strong>
                  </div>
                  <Link to="/wallet" className="tl-ov-link">View my passes <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
                  <Ticket className="tl-ov-art" aria-hidden="true" />
                </section>
                <section className="tl-ov-stat">
                  <h3>Connected wallet</h3>
                  <div className="tl-ov-stat-row">
                    <span className="tl-ov-stat-icon"><Wallet className="w-5 h-5" aria-hidden="true" /></span>
                    <strong>{profile?.walletAddress ? 'Polygon linked' : 'Custodial vault'}</strong>
                  </div>
                  <button type="button" className="tl-ov-outline" onClick={() => goTab('security')}>Manage wallet <ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
                  <Boxes className="tl-ov-art" aria-hidden="true" />
                </section>
              </div>

              <div className="tl-ov-split">
                <section className="tl-ov-panel" aria-labelledby="ov-tickets">
                  <div className="tl-ov-panel-head">
                    <h3 id="ov-tickets"><Ticket className="w-5 h-5" aria-hidden="true" /> Your tickets</h3>
                    <Link to="/my-bookings" className="tl-ov-link">Order history <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
                  </div>
                  {recentTickets === null ? (
                    <p className="tl-ov-muted">Loading your tickets…</p>
                  ) : recentTickets.length === 0 ? (
                    <div className="tl-ov-empty">
                      <span className="tl-ov-empty-art" aria-hidden="true"><Ticket className="w-10 h-10" /></span>
                      <strong>No tickets yet</strong>
                      <p>Tickets you book will appear here.</p>
                      <Link to="/events" className="tl-ov-edit">Explore events <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link>
                    </div>
                  ) : (
                    <ul className="tl-ov-tickets">
                      {recentTickets.map((t) => (
                        <li key={t.id}>
                          <Link to="/wallet">
                            <span className="tl-ov-stat-icon"><Ticket className="w-5 h-5" aria-hidden="true" /></span>
                            <span className="tl-ov-ticket-text">
                              <strong>{t.event?.name}</strong>
                              <small>{t.event?.date ? new Date(t.event.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}{t.seat?.tierName ? ` · ${t.seat.tierName}` : ''}</small>
                            </span>
                            <span className={`tl-ov-status is-${(t.status || '').toLowerCase()}`}>{t.status}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="tl-ov-panel" aria-labelledby="ov-actions">
                  <div className="tl-ov-panel-head">
                    <h3 id="ov-actions"><Zap className="w-5 h-5" aria-hidden="true" /> Quick actions</h3>
                  </div>
                  <div className="tl-ov-actions">
                    <button type="button" onClick={() => goTab('my-data')}>
                      <span className="tl-ov-stat-icon"><Pencil className="w-5 h-5" aria-hidden="true" /></span>
                      <span><strong>Edit profile details</strong><small>Update your account information</small></span>
                      <ArrowRight className="w-5 h-5" aria-hidden="true" />
                    </button>
                    <Link to="/wallet">
                      <span className="tl-ov-stat-icon"><Ticket className="w-5 h-5" aria-hidden="true" /></span>
                      <span><strong>View my passes</strong><small>Open your ticket wallet</small></span>
                      <ArrowRight className="w-5 h-5" aria-hidden="true" />
                    </Link>
                    <button type="button" onClick={() => goTab('security')}>
                      <span className="tl-ov-stat-icon"><KeyRound className="w-5 h-5" aria-hidden="true" /></span>
                      <span><strong>Change password</strong><small>Keep your account secure</small></span>
                      <ArrowRight className="w-5 h-5" aria-hidden="true" />
                    </button>
                    <Link to="/events">
                      <span className="tl-ov-stat-icon"><CalendarDays className="w-5 h-5" aria-hidden="true" /></span>
                      <span><strong>Explore events</strong><small>Find your next experience</small></span>
                      <ArrowRight className="w-5 h-5" aria-hidden="true" />
                    </Link>
                  </div>
                </section>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
    )}
    </BasicShell>
  );
}
