import React, { useLayoutEffect, useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useNavigationType, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import CompanyRegistration from './pages/CompanyRegistration';
import AdminCompanies from './pages/AdminCompanies';
import Events from './pages/Events';
import Categories from './pages/Categories';
import EventSubmit from './pages/EventSubmit';
import AdminEventApprovals from './pages/AdminEventApprovals';
import EventDetails from './pages/EventDetails';
import CreateEvent from './pages/CreateEvent';
import VenueEditor from './pages/VenueEditor';
import SeatMap from './pages/SeatMap';
import Checkout from './pages/Checkout';
import BookingSuccess from './pages/BookingSuccess';
import MyBookings from './pages/MyBookings';
import MyNFTTickets from './pages/MyNFTTickets';
import ResaleMarketplace from './pages/ResaleMarketplace';
import DigitalWallet from './pages/DigitalWallet';
import GateScanner from './pages/GateScanner';
import AdminFraudWatchlist from './pages/AdminFraudWatchlist';
import DemandForecast from './pages/DemandForecast';
import Notifications from './pages/Notifications';
import NotificationBell from './components/NotificationBell';
import HoldBar from './components/HoldBar';
import PixelLoader from './components/events/PixelLoader';
import SplashScreen from './components/motion/SplashScreen';
import BehaviorProfile from './pages/BehaviorProfile';
import PurchaseIntentAnalytics from './pages/PurchaseIntentAnalytics';
import AbandonedIntentDashboard from './pages/AbandonedIntentDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import OrganizerDashboard from './pages/OrganizerDashboard';
import VerifyOtp from './pages/VerifyOtp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AcceptInvite from './pages/AcceptInvite';
import Suspended from './pages/Suspended';
import StaffEvents from './pages/StaffEvents';
import {
  User,
  LogOut,
  ShieldCheck,
  PlusCircle,
  ShoppingBag,
  QrCode,
  TrendingUp,
  ChevronDown,
  Scan,
  Search,
  Tag,
  Sparkles,
  CalendarPlus,
  Ticket,
  Settings
} from 'lucide-react';
import BrandLogo from './components/brand/BrandLogo';
import HomeHeader from './components/home/HomeHeader';
import SiteFooter from './components/home/SiteFooter';
import DashShell from './components/dash/DashShell';
import { DialogProvider } from './components/ui/DialogProvider';
import { WishlistProvider } from './context/WishlistContext';
import Wishlist from './pages/Wishlist';
import NotFound from './pages/NotFound';
import ComingSoon from './pages/ComingSoon';
import Legal from './pages/Legal';
import About from './pages/About';
import Contact from './pages/Contact';
import WorkflowExplorer from './pages/WorkflowExplorer';
import './components/ui/selects.css';
import SelectEnhancer from './components/ui/SelectEnhancer';
import SmoothScroll from './components/motion/SmoothScroll';
import AwayTitle from './components/motion/AwayTitle';

function SiteChrome({ children }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  // Every page brings its own header and footer, except these, which get the site's (logo, cart,
  // notifications, profile, menu): the suspended notice, the customer pages' access notice for other
  // roles, and account pages while signed out (on their way to sign in).
  const customerOnly = /^\/(resale|wallet|my-nfts|my-bookings)\/?$/.test(pathname) && !['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role);
  const accountSignedOut = /^\/(profile|notifications)\/?$/.test(pathname) && !user;
  const legal = /^\/(terms|privacy|about|contact)\/?$/.test(pathname);
  return pathname === '/suspended' || customerOnly || accountSignedOut || legal ? children : null;
}

/**
 * Every new screen (link, menu, login, logout) opens at its top. Back/forward and reloads ('POP') are left to
 * the pages that restore their own position (homepage, Explore Events, Fan resale).
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  useLayoutEffect(() => {
    if (navigationType === 'POP') return;
    // With Lenis, jump through it so its own scroll position matches (no smooth catch-up)
    if (window.__lenis) window.__lenis.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, navigationType]);
  return null;
}

/** The pixel loader plays on every page change (keyed by path, so filters and query changes don't trigger it). */
function RouteLoader() {
  const { pathname } = useLocation();
  // On the very first visit the splash screen already covers the page load, so the loader sits that one out
  const [skipFirst] = useState(() => {
    try {
      return !sessionStorage.getItem('tl_splash_seen');
    } catch {
      return false;
    }
  });
  const firstPath = useRef(pathname);
  if (skipFirst && pathname === firstPath.current) return null;
  return <PixelLoader key={pathname} />;
}

// Features still in development show the "Coming soon" page (same theme as the 404 page) instead of
// their real page. The real pages and routes stay wired below: set the flag to false to bring one back.
const COMING_SOON = {
  demandForecast: true,
  purchaseIntent: true,
  behaviorAnalysis: true,
};
const soon = (flag, feature, page) => (COMING_SOON[flag] ? <ComingSoon feature={feature} /> : <DashShell>{page}</DashShell>);

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
        <WishlistProvider>
        <SelectEnhancer />
        <SmoothScroll />
        <AwayTitle />
        <SplashScreen />
        <ScrollToTop />
        <RouteLoader />
        <div className="min-h-screen flex flex-col bg-[#f8fafc] text-[#212b36]">
          {/* Pages without their own chrome get the site header (logo, cart, notifications, profile, menu) */}
          <SiteChrome><div className="tl-home tl-chrome"><HomeHeader tone="light" /></div></SiteChrome>
          <main className="flex-1 w-full">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/events" element={<Events />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/terms" element={<Legal doc="terms" />} />
              <Route path="/privacy" element={<Legal doc="privacy" />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              {/* Workflow explorer: overall flow and every module's flowchart */}
              <Route path="/workflow" element={<WorkflowExplorer />} />
              <Route path="/wishlist" element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
              <Route path="/events/:id" element={<EventDetails />} />
              <Route path="/events/:id/seats" element={<SeatMap />} />
              <Route path="/events/:id/checkout" element={<Checkout />} />
              <Route path="/checkout" element={<Checkout />} />
              {/* The cart page was replaced by checkout */}
              <Route path="/cart" element={<Navigate to="/checkout" replace />} />
              <Route path="/booking-success/:orderId" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/booking-success/:id" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/bookings/:orderId/confirmation" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/bookings/:id/confirmation" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/resale" element={<ProtectedRoute allowedRoles={['CUSTOMER', 'SUPER_ADMIN']}><ResaleMarketplace /></ProtectedRoute>} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/verify" element={<VerifyOtp />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/invite/:token" element={<AcceptInvite />} />
              <Route path="/suspended" element={<Suspended />} />
              <Route path="/company" element={<CompanyRegistration />} />

              {/* Protected Customer Routes */}
              <Route path="/wallet" element={<ProtectedRoute allowedRoles={['CUSTOMER', 'SUPER_ADMIN']}><DigitalWallet /></ProtectedRoute>} />
              <Route path="/my-bookings" element={<ProtectedRoute allowedRoles={['CUSTOMER', 'SUPER_ADMIN']}><MyBookings /></ProtectedRoute>} />
              <Route path="/my-nfts" element={<ProtectedRoute allowedRoles={['CUSTOMER', 'SUPER_ADMIN']}><MyNFTTickets /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

              {/* Protected Gate Staff Scanner */}
              <Route path="/staff/events" element={<DashShell><ProtectedRoute allowedRoles={['GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN']}><StaffEvents /></ProtectedRoute></DashShell>} />
              <Route path="/scanner" element={<DashShell><ProtectedRoute allowedRoles={['GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN']}><GateScanner /></ProtectedRoute></DashShell>} />

              {/* Protected Organizer Studio */}
              <Route path="/organizer/dashboard" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} requireApprovedCompany><OrganizerDashboard /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/create-event" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} requireApprovedCompany><CreateEvent key="create" /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/venue" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} requireApprovedCompany><VenueEditor /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/edit" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} requireApprovedCompany><CreateEvent key="edit" /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/submit" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} requireApprovedCompany><EventSubmit /></ProtectedRoute></DashShell>} />

              {/* Protected Super Admin Governance */}
              <Route path="/admin/dashboard" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><SuperAdminDashboard /></ProtectedRoute></DashShell>} />
              <Route path="/admin/companies" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminCompanies /></ProtectedRoute></DashShell>} />
              <Route path="/admin/event-approvals" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminEventApprovals /></ProtectedRoute></DashShell>} />
              <Route path="/admin/fraud-watchlist" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminFraudWatchlist /></ProtectedRoute></DashShell>} />
              <Route path="/admin/demand-forecast" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}>{soon('demandForecast', 'Demand forecast', <DemandForecast />)}</ProtectedRoute>} />
              <Route path="/demand-forecast" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}>{soon('demandForecast', 'Demand forecast', <DemandForecast />)}</ProtectedRoute>} />
              <Route path="/admin/behavior-profile" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN']}>{soon('behaviorAnalysis', 'Behavioral analysis', <BehaviorProfile />)}</ProtectedRoute>} />
              <Route path="/admin/purchase-intent" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}>{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</ProtectedRoute>} />
              <Route path="/analytics/intent/:id" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}>{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</ProtectedRoute>} />
              <Route path="/analytics/intent" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}>{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</ProtectedRoute>} />
              <Route path="/admin/abandoned-intents" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><AbandonedIntentDashboard /></ProtectedRoute></DashShell>} />

              {/* Safe catch-all fallback */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <SiteChrome><div className="tl-home tl-chrome"><SiteFooter /></div></SiteChrome>
          <HoldBar />
        </div>
        </WishlistProvider>
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
