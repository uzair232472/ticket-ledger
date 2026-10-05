import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Repeat2, ScanLine, ShieldCheck, Ticket, Users, MapPinned } from 'lucide-react';
import './legal.css';
import './info.css';

const VALUES = [
  { icon: ShieldCheck, title: 'Real tickets only', text: 'Every pass is cryptographically signed, so a fake or copied QR is caught at the gate in a second.' },
  { icon: Repeat2, title: 'Fair resale', text: 'Fans can pass tickets on, but never for more than 110% of the original price. No scalper markups.' },
  { icon: MapPinned, title: 'Pick your seat', text: 'Choose exactly where you sit on a live venue map, from stadium stands to concert tables.' },
  { icon: ScanLine, title: 'Fast entry', text: 'Gate staff scan passes in under a second, even when the stadium network is down.' },
];

const STEPS = [
  ['Find', 'Explore cricket, football, concerts, qawwali nights and festivals across Pakistan.'],
  ['Book', 'Pick your seats, pay with JazzCash, EasyPaisa or card, and get your tickets instantly.'],
  ['Go', 'Show the QR in your wallet at the gate. Can’t make it? Transfer or resell it fairly.'],
];

/** About us (/about). */
export default function About() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'About us · TicketLedger';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <main className="tl-legal tl-info">
      <header className="tl-legal-head tl-info-head">
        <p className="tl-legal-eyebrow">About us</p>
        <h1>Every ticket. Truly yours.</h1>
        <p className="tl-legal-intro">
          TicketLedger is Pakistan’s home for live events: one place to find the big nights, book the seat you want and walk in with a ticket nobody can fake or scalp.
        </p>
      </header>

      <section className="tl-info-section" aria-labelledby="about-why">
        <h2 id="about-why" className="tl-info-h2"><span>01</span>Why we built it</h2>
        <div className="tl-info-prose">
          <p>
            Fans in Pakistan have lived with fake tickets, sold-out-in-seconds drops that reappear at triple the price, and long queues at the gate. Organizers have lived with counterfeit passes and no idea who is really coming.
          </p>
          <p>
            We built TicketLedger to fix that: tickets that belong to the person who bought them, resale that stays fair, and entry that takes a second. Every event goes through a review before it goes on sale, so what you see is real.
          </p>
        </div>
      </section>

      <section className="tl-info-section" aria-labelledby="about-values">
        <h2 id="about-values" className="tl-info-h2"><span>02</span>What makes it different</h2>
        <ul className="tl-info-cards">
          {VALUES.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="tl-info-icon" aria-hidden="true"><Icon className="w-5 h-5" /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="tl-info-section" aria-labelledby="about-how">
        <h2 id="about-how" className="tl-info-h2"><span>03</span>How it works</h2>
        <ol className="tl-info-steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span aria-hidden="true">{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="tl-info-section" aria-labelledby="about-organizers">
        <h2 id="about-organizers" className="tl-info-h2"><span>04</span>For organizers</h2>
        <div className="tl-info-split">
          <div className="tl-info-prose">
            <p>
              Sell tickets with your own seating plan, price tiers and demand forecasts, invite your gate team, and watch entries live on the day. Your money and your audience data stay yours.
            </p>
          </div>
          <ul className="tl-info-list">
            <li><Ticket className="w-4 h-4" aria-hidden="true" /> Seating plans for stadiums, halls and tables</li>
            <li><Users className="w-4 h-4" aria-hidden="true" /> Gate staff accounts with offline scanning</li>
            <li><ScanLine className="w-4 h-4" aria-hidden="true" /> Live turnout and sales dashboard</li>
          </ul>
        </div>
      </section>

      <section className="tl-info-cta" aria-label="Get started">
        <h2>Your next big night is waiting.</h2>
        <div>
          <Link to="/events" className="tl-info-btn is-primary">Explore events <ArrowUpRight className="w-4 h-4" aria-hidden="true" /></Link>
          <Link to="/contact" className="tl-info-btn">Contact us</Link>
        </div>
      </section>
    </main>
  );
}
