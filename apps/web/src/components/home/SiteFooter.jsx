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
 * Shared footer (homepage and Explore Events): oversized wordmark plus link columns.
 * `onCategories` scrolls to the page's own category section/navigation.
 */
export default function SiteFooter({ onCategories }) {
  const { user, isAuthenticated } = useAuth();
  const organizer = organizerAction(user, isAuthenticated);

  return (
    <footer className="tl-footer">
      <p className="tl-footer-wordmark" aria-hidden="true">
        Ticket<span>Ledger</span>
      </p>
      <div>
        <div className="tl-footer-top">
          <div className="tl-footer-brand">
            <BrandLogo />
            <p>Tickets for cricket, concerts and festivals across Pakistan, with seat selection and QR entry.</p>
          </div>
          <nav aria-label="Discover">
            <h3>Discover</h3>
            <ul>
              <li><Link to="/events">Explore events</Link></li>
              {onCategories && (
                <li><button type="button" className="tl-footer-link" onClick={onCategories}>Categories</button></li>
              )}
              {(!isAuthenticated || ['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role)) && <li><Link to="/resale">Fan resale</Link></li>}
            </ul>
          </nav>
          <nav aria-label="Your account">
            <h3>Your account</h3>
            <ul>
              {!isAuthenticated && (
                <>
                  <li><Link to="/login">Log in</Link></li>
                  <li><Link to="/signup">Sign up</Link></li>
                </>
              )}
              {['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role) && <li><Link to="/wallet">My tickets</Link></li>}
              {isAuthenticated && <li><Link to="/notifications">Notifications</Link></li>}
              {isAuthenticated && <li><Link to="/profile">Profile</Link></li>}
            </ul>
          </nav>
          <nav aria-label="Organizers">
            <h3>Organizers</h3>
            <ul>
              <li><Link to={organizer.primary.to}>{organizer.primary.label}</Link></li>
              {organizer.secondary && <li><Link to={organizer.secondary.to}>{organizer.secondary.label}</Link></li>}
            </ul>
          </nav>
        </div>
        <div className="tl-footer-bottom">
          <span>© {new Date().getFullYear()} TicketLedger</span>
          <span>Made for fans in Pakistan</span>
        </div>
      </div>
    </footer>
  );
}
