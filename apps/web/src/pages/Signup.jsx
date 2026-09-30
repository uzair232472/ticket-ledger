import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  Mail, 
  Lock, 
  User, 
  Phone, 
  Wallet, 
  AlertCircle, 
  CheckCircle2,
  ArrowLeft,
  RefreshCw,
  ExternalLink,
  Inbox,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import logoImg from '../assets/ticketledger-logo.png';

export default function Signup() {
  const navigate = useNavigate();
  const { register, verifyOtp, requestOtp } = useAuth();

  const [step, setStep] = useState(1);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'CUSTOMER',
    walletAddress: '',
  });

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpInputRefs = useRef([]);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    let timer;
    if (step === 2 && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (countdown === 0) {
      setCanResend(true);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await register(formData);
      setStep(2);
      setCountdown(60);
      setCanResend(false);
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 100);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (value.length > 1) {
      const cleanDigits = value.replace(/\D/g, '').slice(0, 6);
      if (cleanDigits.length > 0) {
        const newOtp = [...otp];
        for (let i = 0; i < 6; i++) {
          newOtp[i] = cleanDigits[i] || '';
        }
        setOtp(newOtp);
        const focusIdx = Math.min(cleanDigits.length, 5);
        otpInputRefs.current[focusIdx]?.focus();
        return;
      }
    }

    const cleanChar = value.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[index] = cleanChar;
    setOtp(newOtp);

    if (cleanChar && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    const fullOtp = otp.join('');
    if (fullOtp.length !== 6) {
      setError('Please enter all 6 digits of the code received in your email.');
      return;
    }

    setLoading(true);
    try {
      await verifyOtp(formData.email, fullOtp);
      setSuccessMsg('Account verified successfully! Redirecting...');
      setTimeout(() => {
        navigate('/');
      }, 900);
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend || resendLoading) return;
    setError('');
    setSuccessMsg('');
    setResendLoading(true);

    try {
      await requestOtp(formData.email);
      setSuccessMsg(`A fresh 6-digit code was sent to ${formData.email}.`);
      setCountdown(60);
      setCanResend(false);
    } catch (err) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto my-8 sm:my-14">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        
        {/* Left Column: Visual Showcase */}
        <div className="hidden lg:flex lg:col-span-5 relative flex-col justify-between p-8 bg-slate-900 text-white overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=800&q=80"
            alt="Festival"
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/80 to-transparent" />

          <div className="relative z-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-[11px] font-bold">
              <Sparkles className="w-3 h-3 text-[#4ade80]" />
              Official Registration
            </span>
          </div>

          <div className="relative z-10 space-y-4 my-auto py-6">
            <h2 className="text-2xl font-extrabold tracking-tight leading-snug">
              Authentic tickets. <span className="text-[#4ade80]">Fair pricing.</span>
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Every customer account is protected with real-time Gmail OTP verification. Instant access to live cricket, concerts, and arena tours.
            </p>

            <div className="space-y-2 pt-2 text-xs text-slate-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                <span>Direct email verification</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                <span>Anti-counterfeit digital smart ticketing</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                <span>Easy checkout with EasyPaisa, JazzCash & Cards</span>
              </div>
            </div>
          </div>

          <div className="relative z-10 pt-4 border-t border-white/10 text-xs">
            <span className="text-slate-400">Hosting an event? </span>
            <Link to="/company" className="text-[#4ade80] font-bold hover:underline">
              Organizer Portal →
            </Link>
          </div>
        </div>

        {/* Right Column: Step 1 or Step 2 */}
        <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
          <div className="max-w-md mx-auto w-full space-y-6">
            
            {/* Step indicator */}
            <div className="flex items-center gap-2">
              <div className={`h-1.5 flex-1 rounded-full ${step >= 1 ? 'bg-[#22c55e]' : 'bg-slate-200'}`} />
              <div className={`h-1.5 flex-1 rounded-full ${step === 2 ? 'bg-[#22c55e]' : 'bg-slate-200'}`} />
              <span className="text-[11px] font-bold text-slate-400 uppercase">Step {step} of 2</span>
            </div>

            {step === 1 && (
              <>
                <div>
                  <div className="mb-3">
                    <img src={logoImg} alt="TicketLedger" className="h-7 w-auto object-contain" />
                  </div>
                  <h1 className="text-2xl font-extrabold text-[#212b36] tracking-tight">
                    Create Customer Account
                  </h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Sign up below to access verified tickets and dynamic QR passes
                  </p>
                </div>

                {error && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmitForm} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          name="name"
                          required
                          value={formData.name}
                          onChange={handleChange}
                          placeholder="Tariq Mehmood"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Mobile Number</label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          name="phone"
                          value={formData.phone}
                          onChange={handleChange}
                          placeholder="+92 300 1234567"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Email Address (Gmail)</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="email"
                        name="email"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="name@gmail.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      A real 6-digit confirmation code will be dispatched to this inbox.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="password"
                        name="password"
                        required
                        value={formData.password}
                        onChange={handleChange}
                        placeholder="Minimum 6 characters"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Polygon Wallet <span className="font-normal text-slate-400">(Optional)</span>
                    </label>
                    <div className="relative">
                      <Wallet className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                      <input
                        type="text"
                        name="walletAddress"
                        value={formData.walletAddress}
                        onChange={handleChange}
                        placeholder="0x..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:border-[#22c55e] focus:bg-white transition"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full btn-eventfrog text-xs py-3 mt-2"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Sending code to email...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue to Email Verification</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
                  Already registered?{' '}
                  <Link to="/login" className="text-[#16a34a] hover:underline font-bold ml-1">
                    Sign in here →
                  </Link>
                </div>
              </>
            )}

            {step === 2 && (
              <div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 mb-6"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Edit email address</span>
                </button>

                <div className="text-center mb-6 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#16a34a] mx-auto flex items-center justify-center">
                    <Mail className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-extrabold text-[#212b36]">
                    Check Your Gmail App
                  </h2>
                  <p className="text-xs text-slate-500">
                    We just sent a 6-digit confirmation code to:
                  </p>
                  <div className="inline-block px-3 py-1 bg-slate-100 border border-slate-200 rounded-full font-mono text-xs font-bold text-slate-800">
                    {formData.email}
                  </div>

                  <div className="pt-2">
                    <a
                      href="https://mail.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition"
                    >
                      <Inbox className="w-3.5 h-3.5 text-red-500" />
                      <span>Open Gmail Inbox</span>
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </a>
                  </div>
                </div>

                {error && (
                  <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <form onSubmit={handleVerifyOtp} className="space-y-6">
                  <div>
                    <label className="block text-center text-xs font-bold text-slate-700 mb-3">
                      Enter 6-Digit Code from Email
                    </label>

                    <div className="flex justify-center gap-2">
                      {otp.map((digit, idx) => (
                        <input
                          key={idx}
                          ref={(el) => (otpInputRefs.current[idx] = el)}
                          type="text"
                          inputMode="numeric"
                          maxLength={idx === 0 ? 6 : 1}
                          value={digit}
                          onChange={(e) => handleOtpChange(idx, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(idx, e)}
                          className="w-11 h-13 bg-slate-50 border-2 border-slate-200 focus:border-[#22c55e] focus:bg-white rounded-xl text-center text-xl font-bold font-mono text-slate-900 focus:outline-none transition shadow-sm"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || otp.join('').length !== 6}
                    className="w-full btn-eventfrog text-xs py-3"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Verifying code...</span>
                      </>
                    ) : (
                      'Verify & Activate Account'
                    )}
                  </button>
                </form>

                <div className="mt-6 text-center text-xs text-slate-500 border-t border-slate-100 pt-4">
                  Didn't receive the email?{' '}
                  {canResend ? (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendLoading}
                      className="text-[#16a34a] hover:underline font-bold ml-1 inline-flex items-center gap-1"
                    >
                      {resendLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
                      Resend Email Code
                    </button>
                  ) : (
                    <span className="text-slate-400 font-mono ml-1">
                      Resend in {countdown}s
                    </span>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
