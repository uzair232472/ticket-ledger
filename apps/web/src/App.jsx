import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import CompanyRegistration from './pages/CompanyRegistration';
import AdminCompanies from './pages/AdminCompanies';
import Events from './pages/Events';
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
import DashShell from './components/dash/DashShell';

function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [organizerMenu, setOrganizerMenu] = useState(false);
  const [adminMenu, setAdminMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const handleLogout = async () => {
    setUserMenu(false);
    await logout();
    navigate('/login');
  };

  const handleHeaderSearch = (e) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      navigate(`/events?search=${encodeURIComponent(searchTerm.trim())}`);
    } else {
      navigate('/events');
    }
  };

  const isActive = (path) => location.pathname === path;

  if (location.pathname === '/') return null;

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200/90 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4">

        {/* Left: Brand Logo & Integrated Header Search (matching Eventfrog in Image 3) */}
        <div className="flex items-center gap-5 sm:gap-7">
          <Link to="/" className="flex items-center flex-shrink-0">
            <BrandLogo className="text-[22px] sm:text-[25px]" />
          </Link>

          {/* Eventfrog Signature Pill Search Bar */}
          <form onSubmit={handleHeaderSearch} className="hidden md:flex items-center relative w-56 lg:w-72">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Event, Artist, Location..."
              className="w-full bg-slate-50 hover:bg-slate-100 focus:bg-white border border-slate-300/80 focus:border-[#45b549] rounded-full pl-4 pr-9 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none transition shadow-sm"
            />
            <button type="submit" className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
              <Search className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Center: Main Navigation */}
        <nav className="hidden lg:flex items-center space-x-1 text-xs font-semibold text-slate-700">
          <Link
            to="/events"
            className={`px-3 py-2 rounded-lg transition ${isActive('/events')
                ? 'text-[#16a34a] font-bold'
                : 'hover:text-[#16a34a]'
              }`}
          >
            Find events
          </Link>

          {/* Organise Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setOrganizerMenu(!organizerMenu); setAdminMenu(false); setUserMenu(false); }}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg hover:text-[#16a34a] transition"
            >
              <span>Organise</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {organizerMenu && (
              <div
                className="absolute left-0 mt-2 w-64 rounded-2xl bg-white border border-slate-200 shadow-xl p-2 z-50 animate-in fade-in duration-150"
                onClick={() => setOrganizerMenu(false)}
              >
                <Link
                  to="/organizer/dashboard"
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 text-slate-800 text-xs font-semibold"
                >
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <span>Organizer Dashboard</span>
                </Link>
                <Link
                  to="/organizer/create-event"
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 text-slate-800 text-xs font-semibold"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-600" />
                  <span>Publish New Event</span>
                </Link>
                <Link
                  to="/scanner"
                  className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-slate-50 text-slate-800 text-xs font-semibold"
                >
                  <Scan className="w-4 h-4 text-emerald-600" />
                  <span>Gate Scanner App</span>
                </Link>
              </div>
            )}
          </div>

          {/* Customer Contextual Navigation */}
          {isAuthenticated && user?.role === 'CUSTOMER' && (
            <>
              <Link
                to="/resale"
                className={`px-3 py-2 rounded-lg transition ${isActive('/resale') ? 'text-[#16a34a] font-bold' : 'hover:text-[#16a34a]'
                  }`}
              >
                Fan Resale
              </Link>
              <Link
                to="/wallet"
                className={`px-3 py-2 rounded-lg transition ${isActive('/wallet') ? 'text-[#16a34a] font-bold' : 'hover:text-[#16a34a]'
                  }`}
              >
                My Passes
              </Link>
              <Link
                to="/my-nfts"
                className={`px-3 py-2 rounded-lg transition ${isActive('/my-nfts') ? 'text-[#16a34a] font-bold' : 'hover:text-[#16a34a]'
                  }`}
              >
                NFT Tickets
              </Link>
              <Link
                to="/my-bookings"
                className={`px-3 py-2 rounded-lg transition ${isActive('/my-bookings') ? 'text-[#16a34a] font-bold' : 'hover:text-[#16a34a]'
                  }`}
              >
                Orders
              </Link>
            </>
          )}

          {/* Gate Staff Contextual Navigation */}
          {isAuthenticated && user?.role === 'GATE_STAFF' && (
            <Link
              to="/staff/events"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold"
            >
              <Scan className="w-3.5 h-3.5" />
              <span>My Gate Events</span>
            </Link>
          )}
        </nav>

        {/* Right: "Create event" CTA Button & User Account */}
        <div className="flex items-center gap-3">

          {/* Admin Governance Shortcut */}
          {isAuthenticated && user?.role === 'SUPER_ADMIN' && (
            <div className="relative">
              <button
                type="button"
                onClick={() => { setAdminMenu(!adminMenu); setOrganizerMenu(false); setUserMenu(false); }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#008459] hover:bg-[#00704c] text-white transition shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-white" />
                <span>Admin</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {adminMenu && (
                <div
                  className="absolute right-0 mt-2 w-64 rounded-2xl bg-white border border-slate-200 shadow-xl p-2 z-50"
                  onClick={() => setAdminMenu(false)}
                >
                  <Link to="/admin/dashboard" className="block px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-50">
                    Governance Dashboard
                  </Link>
                  <Link to="/admin/companies" className="block px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-50">
                    Organizer Verification
                  </Link>
                  <Link to="/admin/fraud-watchlist" className="block px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-50">
                    Anti-Scalp Watchlist
                  </Link>
                  <Link to="/admin/demand-forecast" className="block px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-50">
                    Demand Forecast
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Create Event Button (Eventfrog style) */}
          <Link
            to={isAuthenticated && (user?.role === 'ORGANIZER' || user?.role === 'SUPER_ADMIN') ? "/organizer/create-event" : "/company"}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 rounded-lg border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-900 font-bold text-xs shadow-sm transition"
          >
            Create event
          </Link>

          {/* Notification Bell */}
          {isAuthenticated && <NotificationBell />}

          {/* User Account / Profile */}
          {isAuthenticated ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => { setUserMenu(!userMenu); setOrganizerMenu(false); setAdminMenu(false); }}
                className="flex items-center gap-2.5 p-1 rounded-full hover:bg-slate-50 transition"
              >
                <div className="w-8 h-8 rounded-full bg-[#60b5c7] text-white flex items-center justify-center font-bold text-xs shadow-sm">
                  {user?.name ? user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() : 'U'}
                </div>
                <div className="text-left hidden md:block">
                  <div className="text-xs font-bold text-slate-900 leading-tight">{user?.name}</div>
                  <div className="text-[10px] text-slate-500 leading-tight truncate max-w-[130px]">{user?.email}</div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {userMenu && (
                <div
                  className="absolute right-0 mt-2 w-52 rounded-2xl bg-white border border-slate-200 shadow-xl py-2 z-50 animate-in fade-in duration-150"
                  onClick={() => setUserMenu(false)}
                >
                  <Link
                    to={isAuthenticated && (user?.role === 'ORGANIZER' || user?.role === 'SUPER_ADMIN') ? "/organizer/create-event" : "/company"}
                    className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition"
                  >
                    <CalendarPlus className="w-4 h-4 text-slate-700" />
                    <span>Create event</span>
                  </Link>

                  {user?.role === 'CUSTOMER' && (
                    <Link
                      to="/wallet"
                      className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition"
                    >
                      <Ticket className="w-4 h-4 text-slate-700" />
                      <span>My tickets</span>
                    </Link>
                  )}

                  <Link
                    to="/profile"
                    className="flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition"
                  >
                    <Settings className="w-4 h-4 text-slate-700" />
                    <span>Settings</span>
                  </Link>

                  <div className="border-t border-slate-100 my-1.5" />

                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition text-left"
                  >
                    <LogOut className="w-4 h-4 text-slate-700" />
                    <span>Log out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 px-2 py-1.5 transition"
            >
              <User className="w-4 h-4 text-slate-600" />
              <span>Log in</span>
            </Link>
          )}

        </div>

      </div>
    </header>
  );
}

function Footer() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();

  if (location.pathname === '/') return null;

  return (
    <footer className="bg-white border-t border-slate-200 mt-20 pt-14 pb-10 text-xs text-slate-600">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          <div className="space-y-3">
            <BrandLogo className="text-[22px]" />
            <p className="text-slate-500 leading-relaxed text-xs">
              Official verified ticketing platform for live sports, concerts, and stadium festivals. Powered by smart contracts with guaranteed fair pricing.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-sm tracking-tight">For Ticket Buyers</h4>
            <ul className="space-y-2 text-slate-600">
              <li><Link to="/events" className="hover:text-[#16a34a] transition">Discover Live Events</Link></li>
              <li><Link to="/wallet" className="hover:text-[#16a34a] transition">My Digital Passes</Link></li>
              <li><Link to="/my-bookings" className="hover:text-[#16a34a] transition">Order History & Receipts</Link></li>
              {isAuthenticated && user?.role === 'CUSTOMER' && (
                <li><Link to="/resale" className="hover:text-[#16a34a] transition">Fan Resale Marketplace (110% Cap)</Link></li>
              )}
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-sm tracking-tight">For Event Organizers</h4>
            <ul className="space-y-2 text-slate-600">
              <li><Link to="/company" className="hover:text-[#16a34a] transition">Host an Event</Link></li>
              <li><Link to="/organizer/dashboard" className="hover:text-[#16a34a] transition">Organizer Hub & Analytics</Link></li>
              <li><Link to="/scanner" className="hover:text-[#16a34a] transition">Gate Scanner Terminal</Link></li>
              <li><Link to="/organizer/create-event" className="hover:text-[#16a34a] transition">Tier Pricing & Venue Mapping</Link></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-sm tracking-tight">Trust & Security</h4>
            <ul className="space-y-2 text-slate-600">
              <li><span className="font-semibold text-slate-700">Polygon Amoy:</span> ERC-721 Smart Contracts</li>
              <li><span className="font-semibold text-slate-700">Anti-Scalp Protection:</span> 110% Resale Cap</li>
              <li><span className="font-semibold text-slate-700">Dynamic Gate Pass:</span> 15-Second Rotating QR</li>
              <li><span className="font-semibold text-slate-700">Payment Methods:</span> EasyPaisa, JazzCash & Cards</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div>
            © 2026 TicketLedger. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <Link to="/events" className="hover:text-slate-600">Events</Link>
            <span>•</span>
            <Link to="/company" className="hover:text-slate-600">Organizers</Link>
            <span>•</span>
            <Link to="/scanner" className="hover:text-slate-600">Turnstiles</Link>
            {isAuthenticated && user?.role === 'CUSTOMER' && (
              <>
                <span>•</span>
                <Link to="/resale" className="hover:text-slate-600">Resale</Link>
              </>
            )}
          </div>
        </div>

      </div>
    </footer>
  );
}

// The homepage and Explore Events have their own fixed header, menu and footer
function SiteChrome({ children }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  // Pages with their own full-bleed header, menu and footer (including the whole booking flow)
  const bookingFlow = /^\/(events\/[^/]+\/(seats|checkout)|checkout|booking-success\/[^/]+|bookings\/[^/]+\/confirmation)\/?$/.test(pathname);
  // Fan resale and the ticket pages have their own chrome for the roles that can open them; other roles keep
  // this navbar around the access notice
  const customerPage = /^\/(resale|wallet|my-nfts|my-bookings)\/?$/.test(pathname) && ['CUSTOMER', 'SUPER_ADMIN'].includes(user?.role);
  // Profile and notifications are open to every signed-in role and bring their own header and footer
  const accountPage = /^\/(profile|notifications)\/?$/.test(pathname) && Boolean(user);
  // Organizer, Super Admin and gate staff consoles use DashShell (header, console nav, footer)
  const consolePage = /^\/((admin|organizer)\/|(scanner|staff\/events|demand-forecast|analytics\/intent)(\/|$))/.test(pathname);
  return pathname === '/' || consolePage || pathname === '/company' || pathname === '/events' || /^\/events\/[^/]+\/?$/.test(pathname) || customerPage || accountPage || bookingFlow ? null : children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen flex flex-col bg-[#f8fafc] text-[#212b36]">
          <SiteChrome><Navbar /></SiteChrome>
          <main className="flex-1 w-full">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/events" element={<Events />} />
              <Route path="/events/:id" element={<EventDetails />} />
              <Route path="/events/:id/seats" element={<SeatMap />} />
              <Route path="/events/:id/checkout" element={<Checkout />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/booking-success/:orderId" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/booking-success/:id" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/bookings/:orderId/confirmation" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/bookings/:id/confirmation" element={<ProtectedRoute><BookingSuccess /></ProtectedRoute>} />
              <Route path="/resale" element={<ProtectedRoute allowedRoles={['CUSTOMER', 'SUPER_ADMIN']}><ResaleMarketplace /></ProtectedRoute>} />
              <Route path="/login" element={<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"><Login /></div>} />
              <Route path="/signup" element={<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"><Signup /></div>} />
              <Route path="/verify" element={<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"><VerifyOtp /></div>} />
              <Route path="/forgot-password" element={<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"><ForgotPassword /></div>} />
              <Route path="/reset-password" element={<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"><ResetPassword /></div>} />
              <Route path="/invite/:token" element={<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6"><AcceptInvite /></div>} />
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

              {/* Protected Super Admin Governance */}
              <Route path="/admin/dashboard" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><SuperAdminDashboard /></ProtectedRoute></DashShell>} />
              <Route path="/admin/companies" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminCompanies /></ProtectedRoute></DashShell>} />
              <Route path="/admin/fraud-watchlist" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><AdminFraudWatchlist /></ProtectedRoute></DashShell>} />
              <Route path="/admin/demand-forecast" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><DemandForecast /></ProtectedRoute></DashShell>} />
              <Route path="/demand-forecast" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><DemandForecast /></ProtectedRoute></DashShell>} />
              <Route path="/admin/behavior-profile" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN']}><BehaviorProfile /></ProtectedRoute></DashShell>} />
              <Route path="/admin/purchase-intent" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><PurchaseIntentAnalytics /></ProtectedRoute></DashShell>} />
              <Route path="/analytics/intent/:id" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><PurchaseIntentAnalytics /></ProtectedRoute></DashShell>} />
              <Route path="/analytics/intent" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><PurchaseIntentAnalytics /></ProtectedRoute></DashShell>} />
              <Route path="/admin/abandoned-intents" element={<DashShell><ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ORGANIZER']}><AbandonedIntentDashboard /></ProtectedRoute></DashShell>} />

              {/* Safe catch-all fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <SiteChrome><Footer /></SiteChrome>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
