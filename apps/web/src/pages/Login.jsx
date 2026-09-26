import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  LogIn, 
  KeyRound, 
  Mail, 
  ShieldCheck, 
  AlertCircle, 
  Sparkles,
  Smartphone,
  Lock
} from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { login, requestOtp, verifyOtp } = useAuth();

  const [mode, setMode] = useState('password'); // 'password' | 'otp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [mockHint, setMockHint] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await requestOtp(email);
      setOtpSent(true);
      setMockHint(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await verifyOtp(email, otpCode);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Quick Demo Account Auto-Fill
  const handleQuickDemo = (demoEmail) => {
    setEmail(demoEmail);
    setPassword('Password@123');
    setMode('password');
    setError('');
  };

  return (
    <div className="max-w-md mx-auto my-10 p-6 sm:p-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl">
      <div className="text-center mb-6">
        <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-xl mx-auto flex items-center justify-center mb-3">
          <KeyRound className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Sign in to TicketLedger</h1>
        <p className="text-xs text-slate-400 mt-1">Access your secure event ticketing portal</p>
      </div>

      {/* Auth Mode Toggle */}
      <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl mb-6 border border-slate-800 text-xs font-medium">
        <button
          type="button"
          onClick={() => { setMode('password'); setError(''); }}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
            mode === 'password' ? 'bg-slate-800 text-white font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Lock className="w-3.5 h-3.5" /> Password Login
        </button>
        <button
          type="button"
          onClick={() => { setMode('otp'); setError(''); }}
          className={`py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
            mode === 'otp' ? 'bg-slate-800 text-white font-semibold shadow' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" /> OTP-Ready Login
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {mockHint && mode === 'otp' && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
          {mockHint}
        </div>
      )}

      {/* Password Mode Form */}
      {mode === 'password' && (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@ticketledger.pk"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      )}

      {/* OTP Mode Form */}
      {mode === 'otp' && (
        <div className="space-y-4">
          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="customer@ticketledger.pk"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                {loading ? 'Sending OTP...' : 'Send Verification OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Enter 6-Digit OTP</label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="123456"
                  className="w-full text-center tracking-widest font-mono text-lg bg-slate-950 border border-slate-800 rounded-lg py-2.5 text-white focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-sm transition shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify & Log In'}
              </button>

              <button
                type="button"
                onClick={() => setOtpSent(false)}
                className="w-full text-xs text-slate-400 hover:text-slate-200"
              >
                Change Email / Resend
              </button>
            </form>
          )}
        </div>
      )}

      {/* Demo Credentials Quick Switcher */}
      <div className="mt-8 pt-6 border-t border-slate-800">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-3">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Quick Demo Role Switcher
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            type="button"
            onClick={() => handleQuickDemo('customer@ticketledger.pk')}
            className="p-2 rounded bg-slate-950 border border-slate-800 hover:border-emerald-600 text-left transition"
          >
            <div className="font-semibold text-white">Customer</div>
            <div className="text-[10px] text-slate-500 truncate">customer@ticketledger.pk</div>
          </button>
          <button
            type="button"
            onClick={() => handleQuickDemo('organizer@ticketledger.pk')}
            className="p-2 rounded bg-slate-950 border border-slate-800 hover:border-emerald-600 text-left transition"
          >
            <div className="font-semibold text-white">Organizer</div>
            <div className="text-[10px] text-slate-500 truncate">organizer@ticketledger.pk</div>
          </button>
          <button
            type="button"
            onClick={() => handleQuickDemo('staff@ticketledger.pk')}
            className="p-2 rounded bg-slate-950 border border-slate-800 hover:border-emerald-600 text-left transition"
          >
            <div className="font-semibold text-white">Gate Staff</div>
            <div className="text-[10px] text-slate-500 truncate">staff@ticketledger.pk</div>
          </button>
          <button
            type="button"
            onClick={() => handleQuickDemo('admin@ticketledger.pk')}
            className="p-2 rounded bg-slate-950 border border-slate-800 hover:border-emerald-600 text-left transition"
          >
            <div className="font-semibold text-white">Super Admin</div>
            <div className="text-[10px] text-slate-500 truncate">admin@ticketledger.pk</div>
          </button>
        </div>
      </div>

      {/* Footer link to Register */}
      <div className="mt-6 text-center text-xs text-slate-400">
        Don't have an account?{' '}
        <Link to="/signup" className="text-emerald-400 hover:underline font-medium">
          Create Account
        </Link>
      </div>
    </div>
  );
}
