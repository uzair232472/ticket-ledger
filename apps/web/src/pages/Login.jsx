import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  Lock, 
  Mail, 
  ArrowRight, 
  AlertCircle, 
  RefreshCw, 
  KeyRound, 
  ChevronDown, 
  ChevronUp,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import logoImg from '../assets/ticketledger-logo.png';

export default function Login() {
  const navigate = useNavigate();
  const { login, requestOtp, verifyOtp } = useAuth();

  const [mode, setMode] = useState('password'); // 'password' | 'otp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [showExaminerPreset, setShowExaminerPreset] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const redirectByRole = (user) => {
    if (user?.role === 'SUPER_ADMIN') {
      navigate('/admin/dashboard');
    } else if (user?.role === 'ORGANIZER') {
      navigate('/organizer/dashboard');
    } else if (user?.role === 'GATE_STAFF') {
      navigate('/scanner');
    } else {
      navigate('/');
    }
  };

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await login(email, password);
      redirectByRole(data.user);
    } catch (err) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await requestOtp(email);
      setOtpSent(true);
    } catch (err) {
      setError(err.message || 'Failed to dispatch OTP to your email');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await verifyOtp(email, otpCode);
      redirectByRole(data.user);
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (presetEmail) => {
    setEmail(presetEmail);
    setPassword('Password@123');
    setMode('password');
    setError('');
  };

  return (
    <div className="max-w-4xl mx-auto my-8 sm:my-14">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        
        {/* Left Column: Visual Showcase */}
        <div className="hidden lg:flex lg:col-span-5 relative flex-col justify-between p-8 bg-slate-900 text-white overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=800&q=80"
            alt="Event Atmosphere"
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/80 to-transparent" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
              <span>Official Digital Box Office</span>
            </div>
          </div>

          <div className="relative z-10 space-y-4 my-auto py-6">
            <h2 className="text-2xl font-extrabold tracking-tight leading-snug">
              One account for every <span className="text-[#4ade80]">event & ticket.</span>
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Manage your bookings, view your 15-second dynamic entry QR pass, or access the organizer hub in one click.
            </p>

            <div className="space-y-2 pt-2 text-xs text-slate-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                <span>Instant Gmail OTP pre-sales</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                <span>Verified digital seat tickets & passes</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                <span>Mobile Turnstile Gate Scanner</span>
              </div>
            </div>
          </div>

          <div className="relative z-10 text-[11px] text-slate-400 font-medium">
            Protected by Polygon Amoy ERC-721 Smart Contracts
          </div>
        </div>

        {/* Right Column: Clean Sign In Form */}
        <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full space-y-6">
            
            {/* Header */}
            <div>
              <div className="mb-3">
                <img src={logoImg} alt="TicketLedger" className="h-7 w-auto object-contain" />
              </div>
              <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">
                Sign In to TicketLedger
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Enter your credentials or sign in with email OTP code
              </p>
            </div>

            {/* Auth Method Switcher (Password vs OTP) */}
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => { setMode('password'); setError(''); }}
                className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
                  mode === 'password'
                    ? 'bg-white text-slate-900 shadow-sm font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Lock className="w-3.5 h-3.5 text-slate-600" />
                <span>Password</span>
              </button>
              <button
                type="button"
                onClick={() => { setMode('otp'); setError(''); }}
                className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
                  mode === 'otp'
                    ? 'bg-white text-slate-900 shadow-sm font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 text-[#16a34a]" />
                <span>Gmail OTP</span>
              </button>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Mode 1: Standard Password Login */}
            {mode === 'password' && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setMode('otp'); setError(''); }}
                      className="text-[11px] font-semibold text-[#16a34a] hover:underline"
                    >
                      Sign in with Gmail OTP →
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 btn-eventfrog text-xs py-3"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Mode 2: Passwordless Email OTP Login */}
            {mode === 'otp' && (
              <div className="space-y-4">
                {!otpSent ? (
                  <form onSubmit={handleSendOtp} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Registered Email Address
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="name@gmail.com"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        We will send a 6-digit verification code directly to your Gmail inbox.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full btn-eventfrog text-xs py-3"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Dispatching Code...</span>
                        </>
                      ) : (
                        <span>Send Verification Code</span>
                      )}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <div className="text-center p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                      Code dispatched to: <strong className="text-slate-900">{email}</strong>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2 text-center">
                        Enter 6-Digit Gmail OTP Code
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        required
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••••"
                        className="w-full text-center tracking-[0.5em] font-mono text-xl font-bold bg-slate-50 border border-slate-200 rounded-xl py-3 text-slate-900 focus:outline-none focus:border-[#22c55e] transition"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading || otpCode.length !== 6}
                      className="w-full btn-eventfrog text-xs py-3"
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Verifying code...</span>
                        </>
                      ) : (
                        'Verify & Sign In'
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setOtpSent(false)}
                      className="w-full text-xs text-slate-500 hover:text-slate-800 transition text-center"
                    >
                      Change email or resend code
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Footer Link */}
            <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
              Don't have an account yet?{' '}
              <Link to="/signup" className="text-[#16a34a] hover:underline font-bold ml-1">
                Create Account →
              </Link>
            </div>

            {/* Fast-Fill Sandbox (Discreet Accordion) */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowExaminerPreset(!showExaminerPreset)}
                className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-600 transition"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="w-3 h-3 text-[#22c55e]" />
                  <span>FYP Examiner Demo Logins</span>
                </span>
                {showExaminerPreset ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>

              {showExaminerPreset && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleQuickFill('customer@ticketledger.pk')}
                    className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition"
                  >
                    <div className="font-bold text-slate-800">Customer</div>
                    <div className="text-[10px] text-slate-500 truncate">customer@ticketledger.pk</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickFill('organizer@ticketledger.pk')}
                    className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition"
                  >
                    <div className="font-bold text-slate-800">Organizer</div>
                    <div className="text-[10px] text-slate-500 truncate">organizer@ticketledger.pk</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickFill('staff@ticketledger.pk')}
                    className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition"
                  >
                    <div className="font-bold text-slate-800">Gate Staff (Turnstile)</div>
                    <div className="text-[10px] text-slate-500 truncate">staff@ticketledger.pk</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickFill('admin@ticketledger.pk')}
                    className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left transition"
                  >
                    <div className="font-bold text-slate-800">Super Admin</div>
                    <div className="text-[10px] text-slate-500 truncate">admin@ticketledger.pk</div>
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
