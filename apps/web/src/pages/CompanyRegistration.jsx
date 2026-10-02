import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountShell, { AccountSection } from '../components/account/AccountShell';
import { STAGE_IMAGE } from '../components/home/homeData';
import {
  Building2,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  UploadCloud,
  ExternalLink,
  ShieldCheck,
  ArrowUpRight,
  User,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  RefreshCw,
  Send
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function CompanyRegistration() {
  const { token, user, isAuthenticated, loading: authLoading, refreshUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [company, setCompany] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  const [formData, setFormData] = useState({
    companyName: '',
    ownerName: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
    city: 'Lahore',
    ntnCnic: '',
    documentUrl: '',
  });

  const [documentFile, setDocumentFile] = useState(null);

  // Load current company status
  const loadCompany = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/companies/my-company`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.data.company) {
        setCompany(data.data.company);
        setFormData({
          companyName: data.data.company.companyName,
          ownerName: data.data.company.ownerName,
          phone: data.data.company.phone,
          email: data.data.company.email,
          city: data.data.company.city,
          ntnCnic: data.data.company.ntnCnic,
          documentUrl: data.data.company.documentUrl || '',
        });
      }
    } catch (err) {
      console.error('Failed to load company:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // my-company is restricted to ORGANIZER / SUPER_ADMIN; skip it for other roles to avoid a 403
    if (token && (user?.role === 'ORGANIZER' || user?.role === 'SUPER_ADMIN')) {
      loadCompany();
      // The admin may have approved or rejected the company since this session started
      if (user?.role === 'ORGANIZER') refreshUser();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [token, user?.role, authLoading]);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ text: '', type: '' });

    try {
      const formPayload = new FormData();
      formPayload.append('companyName', formData.companyName);
      formPayload.append('ownerName', formData.ownerName);
      formPayload.append('phone', formData.phone);
      formPayload.append('email', formData.email);
      formPayload.append('city', formData.city);
      formPayload.append('ntnCnic', formData.ntnCnic);

      if (documentFile) {
        formPayload.append('document', documentFile);
      } else if (formData.documentUrl) {
        formPayload.append('documentUrl', formData.documentUrl);
      }

      const res = await fetch(`${API_URL}/api/companies/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formPayload,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to submit registration');

      setMessage({ text: data.message, type: 'success' });
      await loadCompany();
      await refreshUser();
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const busy = loading || authLoading;
  const isOrganizer = isAuthenticated && user?.role === 'ORGANIZER';
  const approved = company?.status === 'APPROVED';

  // Hosting steps, as implemented: organizer signup -> email verification -> company registration with
  // NTN/CNIC + document -> super admin review -> events with tiers, seating and forecast -> gate staff
  const steps = [
    { title: 'Sign up', copy: 'Create an account and choose Event Organizer as the account type, then verify your email with the code we send.' },
    { title: 'Register', copy: 'Add your company name, contact details, headquarters city and NTN or CNIC, with a verification document (PDF, PNG or JPG).' },
    { title: 'Get approved', copy: 'A super admin reviews your application. You can create and publish events once your company is approved.' },
    { title: 'Create', copy: 'Set up ticket tiers and the seating plan, then run the pre-launch demand forecast or publish directly.' },
    { title: 'Run the gate', copy: 'Invite gate staff from your organizer dashboard. They scan rotating QR tickets at the door.' },
  ];

  const organizerNav = approved
    ? [
        { to: '/organizer/dashboard', label: 'Organizer dashboard' },
        { to: '/organizer/create-event', label: 'Create event' },
        { to: '/scanner', label: 'Gate scanner' },
        { to: '/company', label: 'Company' },
      ]
    : [];

  const statusLabel = { APPROVED: 'Approved', PENDING: 'Under review', REJECTED: 'Needs changes' };

  let actions;
  if (busy) actions = null;
  else if (!isAuthenticated) {
    actions = (
      <>
        <Link to="/signup" className="tl-btn tl-btn--green">
          Create organizer account <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
        </Link>
        <Link to="/login" className="tl-btn tl-btn--ghost">I already have one</Link>
      </>
    );
  } else if (isOrganizer) {
    actions = (
      <>
        {approved ? (
          <Link to="/organizer/create-event" className="tl-btn tl-btn--green">
            Create an event <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        ) : (
          <a href="#tl-host-company" className="tl-btn tl-btn--green">
            {company ? 'View application' : 'Register your company'} <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </a>
        )}
        <button type="button" onClick={() => { loadCompany(); refreshUser(); }} className="tl-btn tl-btn--ghost">
          <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh status
        </button>
      </>
    );
  }

  const howItWorks = (
    <AccountSection id="tl-host-steps" tone="light" kicker="How hosting works" title="From sign-up to the gate">
      <ol className="tl-acct-rows">
        {steps.map((step, i) => (
          <li key={step.title} className="tl-acct-row" data-reveal>
            <span className="tl-acct-row-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
          </li>
        ))}
      </ol>
    </AccountSection>
  );

  return (
    <AccountShell
      eyebrow="For organizers"
      title={['Host your', 'next event']}
      intro="Register your company for approval, set up ticket tiers and seating, check a demand forecast before you publish, and invite gate staff to scan tickets at the door."
      image={STAGE_IMAGE}
      stats={isOrganizer && company ? [{ value: statusLabel[company.status] || company.status, label: company.companyName }] : []}
      actions={actions}
      nav={organizerNav}
      contentKey={`${busy}-${company?.status || 'none'}-${message.text}`}
    >
      {busy ? (
        <AccountSection id="tl-host-company" kicker="Organizer company" title="Loading">
          <div className="tl-acct-loading">
            <span className="tl-acct-spinner" aria-hidden="true" />
            <p>Checking your organizer account…</p>
          </div>
        </AccountSection>
      ) : isOrganizer ? (
        <AccountSection
          id="tl-host-company"
          kicker={company ? `Status · ${statusLabel[company.status] || company.status}` : 'Step 2 of hosting'}
          title={company ? 'Your company' : 'Register your company'}
          aside="Verify your organization via NTN or CNIC to publish sports matches and concerts on TicketLedger."
        >
          <div className="max-w-4xl space-y-6 text-slate-800">
      {/* Feedback Alert */}
      {message.text && (
        <div className={`p-4 rounded-2xl text-xs flex items-center gap-2 border ${message.type === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-[#16a34a]" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-500" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* STATUS BANNER CARDS */}
      {company?.status === 'APPROVED' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-emerald-50 border border-emerald-200 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
            <CheckCircle2 className="w-5 h-5 text-[#16a34a]" /> Company Verified & Approved by Administration
          </div>
          <p className="text-slate-700">
            "{company.companyName}" is officially authorized to create events, configure seating plans, and mint NFT tickets.
          </p>
          <div className="pt-2 text-slate-500 text-[11px] flex gap-4">
            <span>Reviewed by: <strong className="text-slate-800">{company.reviewedBy}</strong></span>
            <span>Approved on: <strong className="text-slate-800">{new Date(company.reviewedAt).toLocaleDateString()}</strong></span>
          </div>
          <Link to="/organizer/dashboard" className="inline-flex btn-eventfrog text-xs px-5 py-2.5 mt-2">
            Go to Organizer Dashboard
          </Link>
        </div>
      )}

      {company?.status === 'PENDING' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-amber-50 border border-amber-200 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
            <Clock className="w-5 h-5 text-amber-600" /> Application Under Review
          </div>
          <p className="text-slate-700">
            Your verification documents for <strong className="text-slate-900">{company.companyName}</strong> have been submitted. Super Admin is reviewing your NTN/CNIC credentials.
          </p>
          <p className="text-[11px] text-amber-800 font-medium">
            ⚠️ Note: As required by TicketLedger governance, organizers cannot publish live events until company approval is granted.
          </p>
          <p className="text-[11px] text-slate-600">
            While you wait you can still update your <Link to="/profile" className="font-bold text-[#16a34a] hover:underline">profile</Link>.
          </p>
        </div>
      )}

      {company?.status === 'REJECTED' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-rose-50 border border-rose-200 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 text-rose-900 font-bold text-sm">
            <AlertCircle className="w-5 h-5 text-rose-500" /> Verification Rejected
          </div>
          <p className="text-slate-700">
            Reason: <strong className="text-rose-800">{company.rejectionReason}</strong>
          </p>
          <p className="text-slate-500 text-[11px]">
            Please correct the issues noted above and press <strong>Resubmit</strong> below.
          </p>
        </div>
      )}

      {/* REGISTRATION FORM */}
      {/* Shown before the first submission and after a rejection; PENDING applications are locked while under review */}
      {(!company || company.status === 'REJECTED') && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#16a34a]" />
            {company ? 'Update & Re-Submit Registration' : 'Company Credentials & Document Submission'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Company / Organization Name</label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="companyName"
                    required
                    value={formData.companyName}
                    onChange={handleChange}
                    placeholder="e.g. PCB Events Management Lahore"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Owner / Authorized Representative</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="ownerName"
                    required
                    value={formData.ownerName}
                    onChange={handleChange}
                    placeholder="e.g. Tariq Mehmood"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Official Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="contact@company.pk"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Phone Number (Pakistan)</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="phone"
                    required
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+92 300 1234567"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Headquarters City</label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <select
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  >
                    <option value="Lahore">Lahore</option>
                    <option value="Karachi">Karachi</option>
                    <option value="Islamabad">Islamabad</option>
                    <option value="Rawalpindi">Rawalpindi</option>
                    <option value="Peshawar">Peshawar</option>
                    <option value="Multan">Multan</option>
                    <option value="Faisalabad">Faisalabad</option>
                    <option value="Quetta">Quetta</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">NTN (National Tax No.) or CNIC</label>
                <div className="relative">
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="ntnCnic"
                    required
                    value={formData.ntnCnic}
                    onChange={handleChange}
                    placeholder="e.g. 1234567-8 or 35201-1234567-1"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-[#22c55e] text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Document Upload Area (Cloudinary Abstraction) */}
            <div className="pt-2">
              <label className="block text-slate-700 font-semibold mb-2">
                Verification Document (NTN Certificate, FBR Registration, or CNIC Scan)
              </label>

              <div className="p-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center hover:border-slate-300 transition">
                <UploadCloud className="w-8 h-8 text-[#16a34a] mx-auto mb-2" />
                <div className="text-xs text-slate-700 font-medium">
                  {documentFile ? documentFile.name : 'Choose a PDF, PNG, or JPG file (Max 10MB)'}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  Stored securely using Cloudinary document abstraction
                </div>
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg"
                  onChange={(e) => setDocumentFile(e.target.files[0])}
                  className="mt-3 text-xs text-slate-500 file:mr-3 file:py-1 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#16a34a] file:text-white hover:file:bg-[#15803d] cursor-pointer"
                />
              </div>

              {company?.documentUrl && (
                <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1">
                  <span>Current document on file:</span>
                  <a
                    href={company.documentUrl.startsWith('http') ? company.documentUrl : `${API_URL}${company.documentUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#16a34a] hover:underline flex items-center gap-1 font-mono font-semibold"
                  >
                    View Document <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-eventfrog inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold shadow-sm transition disabled:opacity-50 mt-4"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting Registration...' : company ? 'Resubmit for Verification' : 'Submit for Super Admin Verification'}
            </button>
          </form>
        </div>
      )}
          </div>
        </AccountSection>
      ) : (
        <AccountSection id="tl-host-company" kicker="Organizer accounts" title="Start hosting">
          <div className="tl-host-start" data-reveal>
            <Building2 className="w-8 h-8" aria-hidden="true" />
            {!isAuthenticated ? (
              <>
                <p>Create an Event Organizer account, verify your email, then register your company for approval.</p>
                <div className="tl-host-start-actions">
                  <Link to="/signup" className="tl-btn tl-btn--green">Create organizer account <ArrowUpRight className="w-4 h-4" aria-hidden="true" /></Link>
                  <Link to="/login" className="tl-btn tl-btn--ghost">Log in</Link>
                </div>
              </>
            ) : (
              <p>
                You're signed in with a {user.role.replace('_', ' ').toLowerCase()} account. Each account has one role, so to host
                events please sign up for a separate Event Organizer account with a different email.
              </p>
            )}
          </div>
        </AccountSection>
      )}

      {howItWorks}
    </AccountShell>
  );
}
