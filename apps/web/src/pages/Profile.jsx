import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
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
  Mail
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const POLYGON_AMOY_CHAIN_ID = '0x13882'; // 80002 in hex

export default function Profile() {
  const { token, user: authUser } = useAuth();
  
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'wallet' | 'notifications' | 'history'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Profile data from backend
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState({});
  const [history, setHistory] = useState([]);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    city: 'Lahore',
  });

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

  // Load profile from API
  const loadProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/users/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setProfile(data.data.profile);
        setStats(data.data.stats);
        setFormData({
          name: data.data.profile.name || '',
          phone: data.data.profile.phone || '',
          city: data.data.profile.city || 'Lahore',
        });
        setNotifications({
          emailNotifications: data.data.profile.emailNotifications ?? true,
          pushNotifications: data.data.profile.pushNotifications ?? true,
          smsNotifications: data.data.profile.smsNotifications ?? false,
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

  useEffect(() => {
    if (token) {
      loadProfile();
      loadHistory();
    }
  }, [token]);

  // Handle Profile Update
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ text: '', type: '' });

    try {
      const res = await fetch(`${API_URL}/api/users/profile`, {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Update failed');

      setMessage({ text: 'Profile updated successfully!', type: 'success' });
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

      // Save to backend
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
      // Chain not added yet, add it
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

  // Disconnect / Unlink wallet
  const handleDisconnectWallet = async () => {
    if (!window.confirm('Are you sure you want to unlink this MetaMask wallet from TicketLedger?')) return;
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

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Profile Header */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 p-6 sm:p-8 border border-slate-800 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-slate-950 font-black text-2xl shadow-lg shadow-emerald-500/20">
              {profile?.name?.charAt(0) || 'U'}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-white tracking-tight">{profile?.name}</h1>
                <span className="text-xs uppercase px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {profile?.role}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-teal-500/20 text-teal-400 border border-teal-500/30">
                  {profile?.status}
                </span>
              </div>
              <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
                <span>{profile?.email}</span>
                <span>•</span>
                <span>{profile?.city || 'Pakistan'}</span>
                <span>•</span>
                <span>Member since {new Date(profile?.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Quick Wallet Indicator */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <div className="text-slate-400 flex items-center gap-1.5 font-medium mb-1">
              <Wallet className="w-4 h-4 text-emerald-400" /> MetaMask Status
            </div>
            {profile?.walletAddress ? (
              <div className="font-mono text-emerald-400 text-[11px] truncate max-w-[200px]" title={profile.walletAddress}>
                {profile.walletAddress}
              </div>
            ) : (
              <div className="text-amber-400 text-xs flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Wallet Not Linked
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {message.text && (
        <div className={`p-4 rounded-xl text-xs flex items-center gap-2 border ${
          message.type === 'success' 
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Profile Tabs Navigation */}
      <div className="flex border-b border-slate-800 gap-2 text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => { setActiveTab('overview'); setMessage({ text: '', type: '' }); }}
          className={`py-3 px-4 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
            activeTab === 'overview' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <User className="w-4 h-4" /> Overview & Role Details
        </button>

        <button
          onClick={() => { setActiveTab('wallet'); setMessage({ text: '', type: '' }); }}
          className={`py-3 px-4 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
            activeTab === 'wallet' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wallet className="w-4 h-4" /> Web3 Wallet (MetaMask)
        </button>

        <button
          onClick={() => { setActiveTab('notifications'); setMessage({ text: '', type: '' }); }}
          className={`py-3 px-4 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
            activeTab === 'notifications' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bell className="w-4 h-4" /> Notifications Settings
        </button>

        <button
          onClick={() => { setActiveTab('history'); setMessage({ text: '', type: '' }); }}
          className={`py-3 px-4 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
            activeTab === 'history' 
              ? 'border-emerald-500 text-emerald-400' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" /> Activity History
        </button>
      </div>

      {/* TAB 1: OVERVIEW & ROLE DETAILS */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Edit Profile Form */}
          <div className="md:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800">
            <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-emerald-400" /> Personal Profile Details
            </h2>

            <form onSubmit={handleUpdateProfile} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Email Address</label>
                  <input
                    type="email"
                    disabled
                    value={profile?.email || ''}
                    className="w-full bg-slate-950/60 border border-slate-800/60 text-slate-500 rounded-lg px-3 py-2 text-xs cursor-not-allowed"
                  />
                  <span className="text-[10px] text-slate-500">Email cannot be modified directly</span>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Phone Number (Pakistan)</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+92 300 1234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">City in Pakistan</label>
                <select
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500 text-xs"
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

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </form>
          </div>

          {/* Role-Specific Metrics Card */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              {profile?.role} Role Privileges
            </h2>

            {profile?.role === 'CUSTOMER' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Purchased Tickets</div>
                  <div className="text-xl font-extrabold text-white mt-1">{stats.ticketCount ?? 0} Tickets</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Total Orders</div>
                  <div className="text-xl font-extrabold text-white mt-1">{stats.orderCount ?? 0} Orders</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">NFT Ticket Resale Eligibility</div>
                  <div className="text-emerald-400 font-semibold mt-1">✓ Active (110% Cap Enforced)</div>
                </div>
              </div>
            )}

            {profile?.role === 'ORGANIZER' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Company Approval Status</div>
                  <div className="text-base font-bold text-emerald-400 mt-1">
                    {stats.companyStatus || 'NOT_REGISTERED'}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Requires NTN/CNIC document verification by Super Admin (Module 4).
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Events Hosted</div>
                  <div className="text-xl font-extrabold text-white mt-1">{stats.eventsHosted ?? 0} Events</div>
                </div>
              </div>
            )}

            {profile?.role === 'GATE_STAFF' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Entry Scans Logged</div>
                  <div className="text-xl font-extrabold text-white mt-1">{stats.totalScans ?? 0} Scans</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Assigned Venue</div>
                  <div className="text-emerald-400 font-semibold mt-1">Gaddafi Stadium Lahore - Gate 4</div>
                </div>
              </div>
            )}

            {profile?.role === 'SUPER_ADMIN' && (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Total Monitored Users</div>
                  <div className="text-xl font-extrabold text-white mt-1">{stats.totalUsers ?? 0} Accounts</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Pending Company Reviews</div>
                  <div className="text-xl font-extrabold text-amber-400 mt-1">{stats.pendingCompanies ?? 0} Pending</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: WEB3 WALLET (METAMASK) */}
      {activeTab === 'wallet' && (
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900 border border-slate-800 space-y-6">
          <div className="max-w-2xl">
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-400" /> MetaMask Web3 Wallet Integration
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              TicketLedger uses the **Polygon Amoy Testnet** for minting and verifying ERC721 NFT tickets. Connecting your MetaMask wallet enables ticket ownership on-chain, verifiable gate check-ins, and anti-scalping resale transactions.
            </p>
          </div>

          {/* Current Saved Wallet Display */}
          <div className="p-5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-400 mb-1">
                  Active Wallet in TicketLedger Database
                </div>
                {profile?.walletAddress ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-emerald-400 break-all">
                      {profile.walletAddress}
                    </span>
                    <a
                      href={`https://amoy.polygonscan.com/address/${profile.walletAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-500 hover:text-emerald-400 transition"
                      title="View on Polygonscan"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                ) : (
                  <div className="text-xs text-amber-400 flex items-center gap-1.5 font-medium">
                    <AlertCircle className="w-4 h-4" /> No wallet currently saved in your profile.
                  </div>
                )}
              </div>

              {profile?.walletAddress && (
                <button
                  type="button"
                  onClick={handleDisconnectWallet}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition"
                >
                  <Unlink className="w-3.5 h-3.5" /> Unlink Wallet
                </button>
              )}
            </div>
          </div>

          {/* 1-Click Connect MetaMask Button */}
          <div className="p-5 rounded-xl bg-gradient-to-br from-slate-950 to-emerald-950/20 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Browser Extension Connection</h3>
                <p className="text-xs text-slate-400">
                  Request connection via MetaMask extension and register account automatically.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={connectMetaMask}
                  disabled={isConnectingMetaMask || saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                >
                  <Wallet className="w-4 h-4" />
                  {isConnectingMetaMask ? 'Connecting MetaMask...' : 'Connect MetaMask'}
                </button>

                <button
                  type="button"
                  onClick={switchToPolygonAmoy}
                  className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                  title="Switch network to Polygon Amoy Testnet (Chain ID 80002)"
                >
                  Switch to Polygon Amoy
                </button>
              </div>
            </div>
          </div>

          {/* Manual / Sandbox Address Registration */}
          <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-white">Manual / Testnet Wallet Registration</h3>
              <div className="flex items-center gap-2">
                <a
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 font-semibold"
                >
                  <ExternalLink className="w-3 h-3" /> Get MetaMask Extension
                </a>
                <span className="text-slate-600">•</span>
                <button
                  type="button"
                  onClick={() => {
                    const randomHex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
                    setManualWallet(`0x${randomHex}`);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold"
                >
                  <Sparkles className="w-3 h-3" /> Generate Testnet Address
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              For testing in browsers without the MetaMask extension, enter any valid 42-character Ethereum/Polygon address:
            </p>

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
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={saving || !manualWallet}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition disabled:opacity-50"
              >
                Save Address
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: NOTIFICATIONS SETTINGS */}
      {activeTab === 'notifications' && (
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900 border border-slate-800 space-y-6">
          <div className="max-w-xl">
            <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Bell className="w-5 h-5 text-emerald-400" /> Ticket & Alert Notification Settings
            </h2>
            <p className="text-xs text-slate-400">
              Configure how you receive ticket issuance confirmations, gate check-in alerts, and resale notifications.
            </p>
          </div>

          <div className="space-y-4 max-w-2xl text-xs">
            {/* Email Notifications */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white">Email Notifications (Nodemailer)</div>
                  <div className="text-slate-400 text-[11px]">
                    Booking receipts, PDF tickets, organizer approval, and fraud warning emails.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={notifications.emailNotifications}
                onChange={(e) => setNotifications({ ...notifications, emailNotifications: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>

            {/* In-App / Push Notifications */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white">Socket.io & In-App Alerts</div>
                  <div className="text-slate-400 text-[11px]">
                    Real-time seat lock countdowns, waitlist resale availability, and gate entry confirmation.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={notifications.pushNotifications}
                onChange={(e) => setNotifications({ ...notifications, pushNotifications: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>

            {/* SMS / WhatsApp Notifications */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white">SMS / WhatsApp Verification Alerts</div>
                  <div className="text-slate-400 text-[11px]">
                    Emergency match rescheduling announcements and gate pass codes.
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={notifications.smsNotifications}
                onChange={(e) => setNotifications({ ...notifications, smsNotifications: e.target.checked })}
                className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>

            <button
              type="button"
              onClick={handleSaveNotifications}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Notification Preferences'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: ACCOUNT ACTIVITY HISTORY */}
      {activeTab === 'history' && (
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-400" /> Account Audit Trail & Activity
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Cryptographic audit log of account modifications and security actions.
              </p>
            </div>
            <button
              onClick={loadHistory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {history.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No audit logs recorded yet. Changes to your profile and wallet will appear here.
            </div>
          ) : (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden text-xs">
              {history.map((log) => (
                <div key={log.id} className="p-4 bg-slate-950/60 hover:bg-slate-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition">
                  <div>
                    <span className="font-mono font-bold text-emerald-400 text-xs">
                      {log.action}
                    </span>
                    <span className="ml-2 text-slate-400 text-[11px]">
                      Target: {log.targetType || 'User'}
                    </span>
                    {log.details && (
                      <div className="text-[11px] text-slate-400 font-mono mt-1">
                        {JSON.stringify(log.details)}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
