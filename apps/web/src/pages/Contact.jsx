import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Mail, MessageSquare, Send, Ticket } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { SUPPORT_EMAIL, ORGANIZER_EMAIL, SUPPORT_HOURS } from '../lib/site';
import './legal.css';
import './info.css';

const TOPICS = [
  ['BOOKING', 'Tickets and bookings'],
  ['PAYMENT', 'Payments and refunds'],
  ['ORGANIZER', 'Hosting an event'],
  ['ACCOUNT', 'My account'],
  ['OTHER', 'Something else'],
];

/** Contact us (/contact): ways to reach the team and a message form that emails support. */
export default function Contact() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', topic: 'BOOKING', message: '' });
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: 'idle', text: '' }); // idle | sending | sent | error

  useEffect(() => {
    const previous = document.title;
    document.title = 'Contact us · TicketLedger';
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    if (user) setForm((f) => ({ ...f, name: f.name || user.name || '', email: f.email || user.email || '' }));
  }, [user]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.name.trim().length < 2) errs.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errs.email = 'Enter a valid email address.';
    if (form.message.trim().length < 10) errs.message = 'Write a little more (at least 10 characters).';
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`ct-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setStatus({ state: 'sending', text: '' });
    try {
      const res = await api.post('/contact', form);
      setStatus({ state: 'sent', text: res.data.message });
      setForm((f) => ({ ...f, message: '' }));
    } catch (err) {
      setStatus({ state: 'error', text: err.response?.data?.message || `We couldn’t send your message. Email us at ${SUPPORT_EMAIL} instead.` });
    }
  };

  const field = (id, label, input, hint) => (
    <label className="tl-info-field" htmlFor={`ct-${id}`}>
      <span>{label}</span>
      {input}
      {errors[id] ? <em id={`ct-${id}-err`} role="alert">{errors[id]}</em> : hint ? <small>{hint}</small> : null}
    </label>
  );

  return (
    <main className="tl-legal tl-info">
      <header className="tl-legal-head tl-info-head">
        <p className="tl-legal-eyebrow">Contact us</p>
        <h1>We’re here to help.</h1>
        <p className="tl-legal-intro">Questions about a booking, a payment or hosting your event? Send us a message and a real person will reply.</p>
      </header>

      <div className="tl-info-contact">
        <aside className="tl-info-ways" aria-label="Other ways to reach us">
          <div>
            <span className="tl-info-icon" aria-hidden="true"><Mail className="w-5 h-5" /></span>
            <h2>Fan support</h2>
            <p>Tickets, payments, transfers and your account.</p>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </div>
          <div>
            <span className="tl-info-icon" aria-hidden="true"><Ticket className="w-5 h-5" /></span>
            <h2>Organizers</h2>
            <p>Listing an event, seating plans and payouts.</p>
            <a href={`mailto:${ORGANIZER_EMAIL}`}>{ORGANIZER_EMAIL}</a>
          </div>
          <div>
            <span className="tl-info-icon" aria-hidden="true"><MessageSquare className="w-5 h-5" /></span>
            <h2>About a specific event?</h2>
            <p>Open the event page and press <strong>Contact organizer</strong> to reach the people running it.</p>
            <Link to="/events">Find the event</Link>
          </div>
          <p className="tl-info-hours"><Clock className="w-4 h-4" aria-hidden="true" /> {SUPPORT_HOURS} · we reply within one working day</p>
        </aside>

        <section className="tl-info-formcard" aria-labelledby="ct-title">
          <h2 id="ct-title">Send a message</h2>
          {status.state === 'sent' ? (
            <div className="tl-info-sent" role="status">
              <CheckCircle2 className="w-10 h-10" aria-hidden="true" />
              <h3>Message sent</h3>
              <p>{status.text}</p>
              <button type="button" className="tl-info-btn" onClick={() => setStatus({ state: 'idle', text: '' })}>Send another message</button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="tl-info-row">
                {field('name', 'Your name', <input id="ct-name" value={form.name} onChange={set('name')} autoComplete="name" maxLength={80} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'ct-name-err' : undefined} />)}
                {field('email', 'Email', <input id="ct-email" type="email" value={form.email} onChange={set('email')} autoComplete="email" maxLength={200} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'ct-email-err' : undefined} />, 'We reply to this address.')}
              </div>
              {field('topic', 'Topic', (
                <select id="ct-topic" value={form.topic} onChange={set('topic')}>
                  {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ))}
              {field('message', 'Message', <textarea id="ct-message" rows={6} value={form.message} onChange={set('message')} maxLength={3000} placeholder="Tell us what happened. Include your order or event name if it’s about a booking." aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? 'ct-message-err' : undefined} />)}
              {status.state === 'error' && <p className="tl-info-error" role="alert">{status.text}</p>}
              <button type="submit" className="tl-info-btn is-primary" disabled={status.state === 'sending'}>
                {status.state === 'sending' ? 'Sending…' : <>Send message <Send className="w-4 h-4" aria-hidden="true" /></>}
              </button>
              <p className="tl-info-fine">By sending, you agree we may use your details to reply. See our <Link to="/privacy">Privacy Policy</Link>.</p>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
