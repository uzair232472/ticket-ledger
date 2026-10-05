import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SUPPORT_EMAIL } from '../lib/site';
import './legal.css';

const UPDATED = '5 October 2026';
const CONTACT = SUPPORT_EMAIL;

/** Each document: title, intro and numbered sections ({ id, heading, body: [paragraph | string[] list] }). */
const DOCS = {
  terms: {
    title: 'Terms of Service',
    intro: 'These terms apply when you use TicketLedger to find events, buy, transfer or resell tickets, organize events, or scan tickets at a gate. By creating an account you agree to them.',
    sections: [
      {
        id: 'account',
        heading: 'Your account',
        body: [
          'You need an account to buy, hold or transfer tickets. Give your real name, a working email address and a Pakistani mobile number, and keep them up to date: we use them to send your tickets and to protect your account.',
          'Keep your password private. You are responsible for what happens on your account. For your safety we sign you out after 30 minutes without activity.',
          'One person, one customer account. Accounts made to get around ticket limits can be suspended.',
        ],
      },
      {
        id: 'tickets',
        heading: 'Buying tickets',
        body: [
          'Seats you pick are held for you for a short time while you check out. If the timer runs out, they are released for other fans.',
          'Prices are set by the organizer and confirmed by our server when you pay. A ticket is yours only after the payment is confirmed; you then find it in your wallet and in your email.',
          'Payments are handled by the payment provider you choose (JazzCash, EasyPaisa or card via Stripe). Their own terms apply to the payment itself.',
        ],
      },
      {
        id: 'entry',
        heading: 'Your pass and entry',
        body: [
          'Each ticket has a signed QR pass and a short manual code. Show the pass from your wallet or the PDF at the gate. Each ticket admits one person once: the first scan gets in, later scans of the same ticket are refused.',
          'Don’t share your QR code or code. Anyone who is scanned with it first uses your ticket.',
          'The organizer and venue may refuse entry for safety reasons or if their entry rules are not followed.',
        ],
      },
      {
        id: 'transfer',
        heading: 'Transfers and resale',
        body: [
          'You can transfer a ticket to another TicketLedger account or list it on fan resale. When a ticket moves, a new pass and code are issued to the new holder and your old ones stop working.',
          'Resale is capped at 110% of the original price. Reselling TicketLedger tickets anywhere else, or above the cap, is not allowed and can lead to the ticket being cancelled.',
        ],
      },
      {
        id: 'refunds',
        heading: 'Cancellations and refunds',
        body: [
          'If an event is cancelled, the organizer is responsible for refunds, which are returned through the original payment method. Cancelled tickets can’t be used for entry.',
          'Otherwise tickets are non-refundable, but you can transfer them or resell them within the cap.',
        ],
      },
      {
        id: 'organizers',
        heading: 'Organizers and gate staff',
        body: [
          'Organizers must give accurate event details. Events are reviewed by TicketLedger before they go on sale, and we may pause or remove events that break these terms.',
          'Organizers are responsible for their events, prices, venue and refunds. Gate staff may use the scanner only for the events they are assigned to.',
        ],
      },
      {
        id: 'conduct',
        heading: 'Fair use',
        body: [
          'Don’t use bots or automated tools to buy tickets, don’t copy or forge passes, and don’t try to get around limits, security or the resale cap.',
          'We may suspend accounts or cancel tickets involved in fraud or scalping.',
        ],
      },
      {
        id: 'liability',
        heading: 'Our responsibility',
        body: [
          'TicketLedger provides the booking and ticketing platform. The event itself is provided by its organizer.',
          'We work to keep the service available and secure, but we can’t promise it will never be interrupted. As far as the law allows, we are not liable for indirect losses.',
        ],
      },
      {
        id: 'changes',
        heading: 'Changes and contact',
        body: [
          'We may update these terms. If the changes are significant we will tell you by email or in the app before they apply.',
          `Questions? Write to ${CONTACT}.`,
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    intro: 'This explains what personal data TicketLedger collects, why, who sees it and the choices you have.',
    sections: [
      {
        id: 'collect',
        heading: 'What we collect',
        body: [
          [
            'Account details: your name, email address, mobile number and password (stored only as a secure hash).',
            'Bookings: the events, seats and tickets you buy, transfer or resell, and your check-ins at the gate.',
            'Payments: the payment method and a reference from the provider. Card numbers and wallet PINs go to the payment provider, not to us.',
            'Usage: pages you view and actions you take in the app, the device and browser you use, used to keep the service secure and improve it.',
          ],
        ],
      },
      {
        id: 'use',
        heading: 'How we use it',
        body: [
          [
            'To create your account, send your tickets and let you transfer or resell them.',
            'To send you emails about your account, bookings and activity (you can turn notification emails off in your account settings).',
            'To check passes at the gate and stop fraud, bots and scalping.',
            'To understand demand and improve TicketLedger, using combined data that doesn’t identify you.',
          ],
        ],
      },
      {
        id: 'share',
        heading: 'Who sees it',
        body: [
          'Organizers see the bookings for their own events (name, ticket and check-in) so they can run them. Gate staff see only a holder’s first name and ticket type when scanning.',
          'Payment providers receive what they need to process your payment. We don’t sell your personal data.',
          'We may share data when the law requires it or to protect people from fraud or harm.',
        ],
      },
      {
        id: 'passes',
        heading: 'Your QR pass',
        body: [
          'Your QR pass contains only the ticket and event identifiers and a signature. It holds no name, phone number or other personal details.',
        ],
      },
      {
        id: 'security',
        heading: 'Security and storage',
        body: [
          'Passwords are hashed, sessions expire after 30 minutes without activity, and passes are cryptographically signed. Data is kept while your account is active and as long as needed for bookings, legal and accounting duties.',
        ],
      },
      {
        id: 'choices',
        heading: 'Your choices',
        body: [
          'You can update your details and email preferences in your account. You can ask us for a copy of your data, or to correct or delete it, by writing to us; some booking records must be kept for legal reasons.',
        ],
      },
      {
        id: 'cookies',
        heading: 'Cookies',
        body: [
          'We use a secure sign-in cookie to keep you logged in, and browser storage for conveniences such as remembering your seat selection. We don’t use advertising cookies.',
        ],
      },
      {
        id: 'contact',
        heading: 'Changes and contact',
        body: [`We may update this policy and will tell you about significant changes. Questions or requests: ${CONTACT}.`],
      },
    ],
  },
};

/** Terms of Service (/terms) and Privacy Policy (/privacy). */
export default function Legal({ doc = 'terms' }) {
  const d = DOCS[doc] || DOCS.terms;
  const other = doc === 'terms' ? { to: '/privacy', label: 'Privacy Policy' } : { to: '/terms', label: 'Terms of Service' };

  useEffect(() => {
    const previous = document.title;
    document.title = `${d.title} · TicketLedger`;
    return () => {
      document.title = previous;
    };
  }, [d.title]);

  return (
    <main className="tl-legal">
      <header className="tl-legal-head">
        <p className="tl-legal-eyebrow">Legal</p>
        <h1>{d.title}</h1>
        <p className="tl-legal-updated">Last updated {UPDATED}</p>
        <p className="tl-legal-intro">{d.intro}</p>
      </header>

      <div className="tl-legal-grid">
        <nav className="tl-legal-toc" aria-label="On this page">
          <p>On this page</p>
          <ol>
            {d.sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.heading}</a></li>
            ))}
          </ol>
          <Link to={other.to} className="tl-legal-switch">Read the {other.label} →</Link>
        </nav>

        <article className="tl-legal-body">
          {d.sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
              <h2 id={`${s.id}-h`}><span>{String(i + 1).padStart(2, '0')}</span>{s.heading}</h2>
              {s.body.map((b, j) => (Array.isArray(b) ? (
                <ul key={j}>{b.map((li) => <li key={li}>{li}</li>)}</ul>
              ) : (
                <p key={j}>{b}</p>
              )))}
            </section>
          ))}
          <p className="tl-legal-foot">
            See also the <Link to={other.to}>{other.label}</Link>. Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </p>
        </article>
      </div>
    </main>
  );
}
