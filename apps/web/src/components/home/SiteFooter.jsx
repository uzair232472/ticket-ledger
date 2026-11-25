import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/** Organizer call to action for the current visitor (matches the routes their role can open). */
export function organizerAction(user, isAuthenticated) {
  if (!isAuthenticated) return { primary: { label: 'Become an organizer', to: '/signup' }, secondary: { label: 'How hosting works', to: '/company' } };
  switch (user.role) {
    case 'ORGANIZER':
      return user.companyStatus === 'APPROVED'
        ? { primary: { label: 'Create an event', to: '/organizer/events/new' }, secondary: { label: 'Organizer dashboard', to: '/organizer/dashboard' } }
        : { primary: { label: 'Finish company setup', to: '/company' } };
    case 'SUPER_ADMIN':
      return { primary: { label: 'Review organizer approvals', to: '/admin/companies' } };
    default:
      return { primary: { label: 'Learn about hosting', to: '/company' } };
  }
}

// Cheering-crowd silhouette along the bottom of the footer (drawn once, deterministic)
const CROWD = (() => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const parts = [];
  for (let x = -10; x < 1450; x += 16 + rnd() * 14) {
    const h = 38 + rnd() * 34; // shoulder height from the bottom
    const y = 120 - h;
    const r = 7 + rnd() * 3;
    parts.push(`M${(x - 15).toFixed(1)} 120 Q${(x - 14).toFixed(1)} ${(y + 4).toFixed(1)} ${x.toFixed(1)} ${(y + 2).toFixed(1)} Q${(x + 14).toFixed(1)} ${(y + 4).toFixed(1)} ${(x + 15).toFixed(1)} 120 Z`);
    parts.push(`M${(x + r).toFixed(1)} ${(y - r).toFixed(1)} a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-2 * r).toFixed(1)} 0 a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(2 * r).toFixed(1)} 0 Z`);
    if (rnd() < 0.45) {
      // a raised arm (sometimes both), as a thin quad
      for (const side of rnd() < 0.35 ? [-1, 1] : [rnd() < 0.5 ? -1 : 1]) {
        const bx = x + side * 11, by = y + 8, tx = x + side * (14 + rnd() * 12), ty = y - 26 - rnd() * 22;
        parts.push(`M${(bx - 3).toFixed(1)} ${by.toFixed(1)} L${(tx - 2.5).toFixed(1)} ${ty.toFixed(1)} L${(tx + 2.5).toFixed(1)} ${(ty - 1).toFixed(1)} L${(bx + 3).toFixed(1)} ${by.toFixed(1)} Z`);
      }
    }
  }
  return parts.join('');
})();

/**
 * Shared footer (every page): gradient wordmark and brand blurb, four short link columns, a crowd silhouette and
 * a slim bottom bar with the legal links. The wordmark goes back to the home page.
 * `onCategories` scrolls to the page's own category section/navigation.
 */
export default function SiteFooter({ onCategories }) {
  const { user, isAuthenticated } = useAuth();
  const organizer = organizerAction(user, isAuthenticated);
  const fan = !isAuthenticated || ['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role);

  return (
    <footer className="tl-footer">
      <svg className="tl-footer-wave" viewBox="0 0 1440 70" preserveAspectRatio="none" aria-hidden="true">
        <path className="tl-footer-wave-glow" d="M0 46 C 260 10, 520 8, 800 34 S 1240 58, 1440 6 V70 H0 Z" />
        <path className="tl-footer-wave-fill" d="M0 56 C 280 24, 540 22, 820 44 S 1250 64, 1440 18 V70 H0 Z" />
      </svg>
      <svg className="tl-footer-crowd" viewBox="0 0 1440 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d={CROWD} />
      </svg>
      <div className="tl-footer-inner">
        <div className="tl-footer-top">
          <div className="tl-footer-brand">
            <Link to="/" className="tl-footer-wordmark" aria-label="TicketLedger home">
              Ticket<span>Ledger</span>
            </Link>
            <p>Tickets for cricket, concerts and festivals across Pakistan, with seat selection and QR entry.</p>
          </div>
          <nav aria-label="Discover">
            <h3>Discover</h3>
            <ul>
              <li><Link to="/events">Explore events</Link></li>
              <li>
                {onCategories
                  ? <button type="button" className="tl-footer-link" onClick={onCategories}>Categories</button>
                  : <Link to="/categories">Categories</Link>}
              </li>
              {fan && <li><Link to="/resale">Fan resale</Link></li>}
            </ul>
          </nav>
          <nav aria-label="Your account">
            <h3>Account</h3>
            <ul>
              {isAuthenticated ? (
                <>
                  {['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role) && <li><Link to="/wallet">My tickets</Link></li>}
                  <li><Link to="/profile">Profile</Link></li>
                </>
              ) : (
                <>
                  <li><Link to="/login">Log in</Link></li>
                  <li><Link to="/signup">Sign up</Link></li>
                </>
              )}
            </ul>
          </nav>
          <nav aria-label="Organizers">
            <h3>Organizers</h3>
            <ul>
              <li><Link to={organizer.primary.to}>{organizer.primary.label}</Link></li>
              {organizer.secondary && <li><Link to={organizer.secondary.to}>{organizer.secondary.label}</Link></li>}
            </ul>
          </nav>
          <nav aria-label="Company">
            <h3>Company</h3>
            <ul>
              <li><Link to="/about">About us</Link></li>
              <li><Link to="/contact">Contact us</Link></li>
            </ul>
          </nav>
        </div>
        <div className="tl-footer-bottom">
          <span>© {new Date().getFullYear()} TicketLedger. Made for fans in Pakistan.</span>
          <nav aria-label="Legal" className="tl-footer-legal">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
