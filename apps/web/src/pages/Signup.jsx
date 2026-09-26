import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  UserPlus, 
  Mail, 
  Lock, 
  User, 
  Phone, 
  Wallet, 
  AlertCircle, 
  CheckCircle2,
  Building2,
  Scan,
  Ticket
} from 'lucide-react';

export default function Signup() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'CUSTOMER',
    walletAddress: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleRoleSelect = (selectedRole) => {
    setFormData((prev) => ({
      ...prev,
      role: selectedRole,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await register(formData);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto my-10 p-6 sm:p-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-xl mx-auto flex items-center justify-center mb-3">
          <UserPlus className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Create your Account</h1>
        <p className="text-xs text-slate-400 mt-1">Join the decentralized ticketing platform for Pakistani events</p>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Role Selection Cards */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-2">Select Account Role</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleRoleSelect('CUSTOMER')}
              className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                formData.role === 'CUSTOMER'
                  ? 'border-emerald-500 bg-emerald-950/30 text-emerald-400'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Ticket className="w-5 h-5" />
              <div className="text-xs font-semibold">Customer</div>
              <div className="text-[10px] text-slate-500">Buy & resale</div>
            </button>

            <button
              type="button"
              onClick={() => handleRoleSelect('ORGANIZER')}
              className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                formData.role === 'ORGANIZER'
                  ? 'border-emerald-500 bg-emerald-950/30 text-emerald-400'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Building2 className="w-5 h-5" />
              <div className="text-xs font-semibold">Organizer</div>
              <div className="text-[10px] text-slate-500">Host events</div>
            </button>

            <button
              type="button"
              onClick={() => handleRoleSelect('GATE_STAFF')}
              className={`p-3 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                formData.role === 'GATE_STAFF'
                  ? 'border-emerald-500 bg-emerald-950/30 text-emerald-400'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
              }`}
            >
              <Scan className="w-5 h-5" />
              <div className="text-xs font-semibold">Gate Staff</div>
              <div className="text-[10px] text-slate-500">Scan QR codes</div>
            </button>
          </div>
        </div>

        {/* Full Name */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
          <div className="relative">
            <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g. Tariq Mehmood"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="name@example.pk"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">Phone Number (Pakistan)</label>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+92 300 1234567"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              placeholder="At least 6 characters"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
        </div>

        {/* MetaMask Wallet Address (Optional) */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            MetaMask Wallet Address <span className="text-slate-500">(Optional, can connect later)</span>
          </label>
          <div className="relative">
            <Wallet className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              name="walletAddress"
              value={formData.walletAddress}
              onChange={handleChange}
              placeholder="0x..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white font-mono text-xs focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20 disabled:opacity-50 mt-4"
        >
          {loading ? 'Creating Account...' : 'Complete Registration'}
        </button>
      </form>

      <div className="mt-6 text-center text-xs text-slate-400">
        Already have an account?{' '}
        <Link to="/login" className="text-emerald-400 hover:underline font-medium">
          Sign In
        </Link>
      </div>
    </div>
  );
}
