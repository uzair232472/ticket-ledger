import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import BrandLogo from '../brand/BrandLogo';

/** Organizer call to action for the current visitor (matches the routes their role can open). */
export function organizerAction(user, isAuthenticated) {
  if (!isAuthenticated) return { primary: { label: 'Become an organizer', to: '/signup' }, secondary: { label: 'How hosting works', to: '/company' } };
  switch (user.role) {
    case 'ORGANIZER':
      return user.companyStatus === 'APPROVED'
        ? { primary: { label: 'Create an event', to: '/organizer/create-event' }, secondary: { label: 'Organizer dashboard', to: '/organizer/dashboard' } }
        : { primary: { label: 'Finish company setup', to: '/company' } };
    case 'SUPER_ADMIN':
      return { primary: { label: 'Review organizer approvals', to: '/admin/companies' } };
    default:
      return { primary: { label: 'Learn about hosting', to: '/company' } };
  }
}

/**
 * Shared footer: oversized wordmark, brand blurb and four short link columns, then a slim bottom bar with the
 * legal links. Both the wordmark and the logo go back to the home page.
 * `onCategories` scrolls to the page's own category section/navigation.
 */
export default function SiteFooter({ onCategories }) {
  const { user, isAuthenticated } = useAuth();
  const organizer = organizerAction(user, isAuthenticated);
  const fan = !isAuthenticated || ['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role);

  return (
    <footer className="tl-footer">
      <Link to="/" className="tl-footer-wordmark" aria-label="TicketLedger home">
        Ticket<span>Ledger</span>
      </Link>
      <div>
        <div className="tl-footer-top">
          <div className="tl-footer-brand">
            <Link to="/" className="tl-footer-logo" aria-label="TicketLedger home"><BrandLogo /></Link>
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
          <span>© {new Date().getFullYear()} TicketLedger · Made for fans in Pakistan</span>
          <nav aria-label="Legal" className="tl-footer-legal">
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
