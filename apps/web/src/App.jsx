import React, { useLayoutEffect, useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useNavigationType, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { insightPath } from './lib/insightPaths';
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
import CreateEventChoice from './pages/CreateEventChoice';
import EventChanges from './pages/EventChanges';
import EventRefund from './pages/EventRefund';
import Prebookings from './pages/Prebookings';
import PrebookForm from './pages/PrebookForm';
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
import AdminFraudReview from './pages/AdminFraudReview';
import DemandForecast from './pages/DemandForecast';
import Notifications from './pages/Notifications';
import NotificationBell from './components/NotificationBell';
import HoldBar from './components/HoldBar';
import PixelLoader from './components/events/PixelLoader';
import SplashScreen from './components/motion/SplashScreen';
import BehaviourReport from './pages/BehaviourReport';
import AiMonitor from './pages/AiMonitor';
import PurchaseIntentAnalytics from './pages/PurchaseIntentAnalytics';
import AbandonedIntentDashboard from './pages/AbandonedIntentDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import OrganizerTeam from './pages/OrganizerTeam';
import OrganizerOrganization from './pages/OrganizerOrganization';
import OrganizerDiscounts from './pages/OrganizerDiscounts';
import Support from './pages/Support';
import SupportTicketPage from './pages/SupportTicketPage';
import SupportDesk from './pages/SupportDesk';
import GateManagement from './pages/GateManagement';
import OrganizerSupport from './pages/OrganizerSupport';
import OrganizerCheckoutSettings from './pages/OrganizerCheckoutSettings';
import AdminPayouts from './pages/AdminPayouts';
import Cart from './pages/Cart';
import GiftClaim from './pages/GiftClaim';
import AdminFinance from './pages/AdminFinance';
import AdminPlatform from './pages/AdminPlatform';
import AdminInvestigations from './pages/AdminInvestigations';
import EventTools from './pages/EventTools';
import SiteBanner from './components/SiteBanner';
import { ORG_PAGE_PERMISSIONS } from './lib/permissions';
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
  // Help & support pages (not the agents' desk) use the site's header and footer too
  const legal = /^\/(terms|privacy|about|contact)\/?$/.test(pathname) || (/^\/support(\/[^/]+)?\/?$/.test(pathname) && !/^\/support\/desk/.test(pathname)) || /^\/gifts\/[^/]+\/?$/.test(pathname);
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

/**
 * Discount links from recovery reminders (/events/:id?code=…): the code is kept for that event's checkout,
 * however the customer gets there (event page → seats → checkout).
 */
function DiscountCodeCatcher() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const m = pathname.match(/^\/events\/([^/]+)/);
    const code = new URLSearchParams(search).get('code');
    if (!m || !code) return;
    try {
      sessionStorage.setItem(`tl_discount_${m[1]}`, code.trim().toUpperCase().slice(0, 40));
    } catch {
      /* storage unavailable */
    }
  }, [pathname, search]);
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
// Step 6: the three AI pages are back, rebuilt to show rule figures first and the experimental (shadow)
// model only as labelled, aggregated, display-only information.
const COMING_SOON = {
  demandForecast: false,
  purchaseIntent: false,
  behaviorAnalysis: false,
};
const soon = (flag, feature, page) => (COMING_SOON[flag] ? <ComingSoon feature={feature} /> : <DashShell>{page}</DashShell>);

// The insight pages are shared by super admins (/admin/...) and organizers (/organizer/...). An organizer who opens
// an old /admin/... address (bookmark, old link) is sent to the organizer address of the same page.
function AdminInsightRoute({ page, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (user && user.role !== 'SUPER_ADMIN') return <Navigate replace to={`${insightPath(user.role, page)}${location.search}`} />;
  return children;
}

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
        <DiscountCodeCatcher />
        <RouteLoader />
        <div className="min-h-screen flex flex-col bg-[#f8fafc] text-[#212b36]">
          <SiteBanner />
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
              <Route path="/events/:id/refund" element={<ProtectedRoute><EventRefund /></ProtectedRoute>} />
              <Route path="/events/:id/checkout" element={<Checkout />} />
              <Route path="/checkout" element={<Checkout />} />
              {/* The cart page was replaced by checkout */}
              {/* Several events' held seats, paid together */}
              <Route path="/cart" element={<Cart />} />
              <Route path="/gifts/:token" element={<GiftClaim />} />
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

              {/* Help desk: customers' requests, and the agents' desk (the API checks agents) */}
              <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
              <Route path="/support/desk" element={<DashShell><ProtectedRoute><SupportDesk /></ProtectedRoute></DashShell>} />
              <Route path="/support/desk/:reference" element={<DashShell><ProtectedRoute><SupportDesk /></ProtectedRoute></DashShell>} />
              <Route path="/support/:reference" element={<ProtectedRoute><SupportTicketPage /></ProtectedRoute>} />

              {/* Protected Gate Staff Scanner */}
              <Route path="/staff/events" element={<DashShell><ProtectedRoute allowedRoles={['GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN']} permission={'gate.scan'}><StaffEvents /></ProtectedRoute></DashShell>} />
              <Route path="/scanner" element={<DashShell><ProtectedRoute allowedRoles={['GATE_STAFF', 'ORGANIZER', 'SUPER_ADMIN']} permission={'gate.scan'}><GateScanner /></ProtectedRoute></DashShell>} />

              {/* Protected Organizer Studio */}
              <Route path="/organizer/team" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={['staff.view', 'audit.view']} requireApprovedCompany><OrganizerTeam /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/organization" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={ORG_PAGE_PERMISSIONS}><OrganizerOrganization /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/support" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'support.respond'}><OrganizerSupport /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/support/:reference" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'support.respond'}><OrganizerSupport /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/manage" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.view'} requireApprovedCompany><EventTools /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/checkout-settings" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={['finance.view', 'event.edit']} requireApprovedCompany><OrganizerCheckoutSettings /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/gates" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'gate.supervise'}><GateManagement /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/discounts" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'discount.manage'} requireApprovedCompany><OrganizerDiscounts /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/dashboard" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.view'} requireApprovedCompany><OrganizerDashboard /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/new" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.create'} requireApprovedCompany><CreateEventChoice /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/prebook" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER']} permission={'event.create'} requireApprovedCompany><Prebookings /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/prebook/:id" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER']} permission={'event.create'} requireApprovedCompany><PrebookForm /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/create-event" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.create'} requireApprovedCompany><CreateEvent key="create" /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/venue" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.view'} requireApprovedCompany><VenueEditor /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/edit" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.view'} requireApprovedCompany><CreateEvent key="edit" /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/changes" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.lifecycle'} requireApprovedCompany><EventChanges /></ProtectedRoute></DashShell>} />
              <Route path="/organizer/events/:id/submit" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.view'} requireApprovedCompany><EventSubmit /></ProtectedRoute></DashShell>} />

              {/* Protected Super Admin Governance */}
              <Route path="/admin/dashboard" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><SuperAdminDashboard /></ProtectedRoute></DashShell>} />
              <Route path="/admin/companies" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminCompanies /></ProtectedRoute></DashShell>} />
              <Route path="/admin/event-approvals" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminEventApprovals /></ProtectedRoute></DashShell>} />
              <Route path="/admin/finance" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminFinance /></ProtectedRoute></DashShell>} />
              <Route path="/admin/platform" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminPlatform /></ProtectedRoute></DashShell>} />
              <Route path="/admin/investigations" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminInvestigations /></ProtectedRoute></DashShell>} />
              <Route path="/admin/investigations/:id" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminInvestigations /></ProtectedRoute></DashShell>} />
              <Route path="/admin/payouts" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminPayouts /></ProtectedRoute></DashShell>} />
              <Route path="/admin/fraud-watchlist" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminFraudWatchlist /></ProtectedRoute></DashShell>} />
              <Route path="/admin/fraud-review" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminFraudReview /></ProtectedRoute></DashShell>} />
              <Route path="/admin/demand-forecast" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']} permission={'event.pricing'}><AdminInsightRoute page="demand">{soon('demandForecast', 'Demand forecast', <DemandForecast />)}</AdminInsightRoute></ProtectedRoute>} />
              <Route path="/organizer/demand-forecast" element={<ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'event.pricing'}>{soon('demandForecast', 'Demand forecast', <DemandForecast />)}</ProtectedRoute>} />
              <Route path="/demand-forecast" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']} permission={'event.pricing'}>{soon('demandForecast', 'Demand forecast', <DemandForecast />)}</ProtectedRoute>} />
              <Route path="/admin/behavior-profile" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN']}>{soon('behaviorAnalysis', 'Behavioral analysis', <BehaviourReport />)}</ProtectedRoute>} />
              <Route path="/admin/ai-monitor" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AiMonitor /></ProtectedRoute></DashShell>} />
              <Route path="/admin/purchase-intent" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']} permission={'attendee.view'}><AdminInsightRoute page="intent">{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</AdminInsightRoute></ProtectedRoute>} />
              <Route path="/organizer/purchase-intent" element={<ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'attendee.view'}>{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</ProtectedRoute>} />
              <Route path="/analytics/intent/:id" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']} permission={'attendee.view'}>{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</ProtectedRoute>} />
              <Route path="/analytics/intent" element={<ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']} permission={'attendee.view'}>{soon('purchaseIntent', 'Purchase intent', <PurchaseIntentAnalytics />)}</ProtectedRoute>} />
              <Route path="/admin/abandoned-intents" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']} permission={'attendee.view'}><AdminInsightRoute page="abandoned"><AbandonedIntentDashboard /></AdminInsightRoute></ProtectedRoute></DashShell>} />
              <Route path="/organizer/abandoned-intents" element={<DashShell><ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']} permission={'attendee.view'}><AbandonedIntentDashboard /></ProtectedRoute></DashShell>} />

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
