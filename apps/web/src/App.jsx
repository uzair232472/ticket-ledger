import React from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
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
import { 
  Ticket, 
  User, 
  LogOut, 
  ShieldCheck, 
  Building2,
  Calendar,
  PlusCircle,
  Layers,
  Sparkles,
  ShoppingBag,
  Tag,
  QrCode,
  Bot,
  TrendingUp,
  Activity
} from 'lucide-react';

function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-6">
          <Link to="/" className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Ticket className="w-6 h-6 text-slate-950 font-bold" />
            </div>
            <div>
              <span className="font-bold text-xl tracking-tight bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent">
                TicketLedger
              </span>
              <span className="ml-2 text-[10px] uppercase px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-semibold">
                Phase 2 FYP
              </span>
            </div>
          </Link>

          {/* Primary Nav */}
          <nav className="hidden md:flex items-center space-x-1">
            <Link
              to="/events"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
            >
              <Calendar className="w-3.5 h-3.5 text-emerald-400" /> Browse Events
            </Link>

            <Link
              to="/resale"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 hover:text-white hover:bg-emerald-950/40 transition border border-emerald-800/40"
            >
              <Tag className="w-3.5 h-3.5 text-emerald-400" /> Resale Market
              <span className="text-[9px] bg-emerald-900/80 text-emerald-300 px-1 py-0.5 rounded font-bold">110% CAP</span>
            </Link>

            {isAuthenticated && (
              <>
                <Link
                  to="/my-bookings"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
                >
                  <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" /> My Bookings
                </Link>
                <Link
                  to="/my-nfts"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-300 hover:text-white hover:bg-purple-950/40 transition border border-purple-800/40"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" /> NFT Tickets
                </Link>
                <Link
                  to="/wallet"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 hover:text-white hover:bg-emerald-950/50 transition border border-emerald-800/60 shadow-sm"
                >
                  <QrCode className="w-3.5 h-3.5 text-emerald-400" /> Digital QR Wallet
                </Link>
              </>
            )}

            {isAuthenticated && (user.role === 'ORGANIZER' || user.role === 'SUPER_ADMIN') && (
              <Link
                to="/organizer/create-event"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:bg-emerald-950/40 transition"
              >
                <PlusCircle className="w-3.5 h-3.5" /> Host Event
              </Link>
            )}

            <Link
              to="/demand-forecast"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-300 hover:text-white hover:bg-purple-950/40 transition border border-purple-800/40"
            >
              <TrendingUp className="w-3.5 h-3.5 text-purple-400" /> AI Demand Forecast
            </Link>

            {isAuthenticated && (user.role === 'GATE_STAFF' || user.role === 'SUPER_ADMIN' || user.role === 'ORGANIZER') && (
              <Link
                to="/scanner"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 hover:text-white hover:bg-amber-950/40 transition border border-amber-800/50 shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Turnstile Scanner
              </Link>
            )}
          </nav>
        </div>

        {/* User / Auth navigation */}
        <div className="flex items-center space-x-3">
          {isAuthenticated ? (
            <div className="flex items-center space-x-3">
              {/* Role-specific Links */}
              {(user.role === 'ORGANIZER' || user.role === 'SUPER_ADMIN') && (
                <Link
                  to="/company"
                  className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-950/40 hover:bg-teal-900/60 text-teal-300 border border-teal-800/60 transition"
                >
                  <Building2 className="w-3.5 h-3.5" /> Company Verification
                </Link>
              )}

              {user.role === 'SUPER_ADMIN' && (
                <>
                  <Link
                    to="/admin/fraud-detection"
                    className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 transition"
                  >
                    <Bot className="w-3.5 h-3.5 text-rose-400" /> AI Bot Watchlist
                  </Link>
                  <Link
                    to="/admin/companies"
                    className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" /> Admin Approvals
                  </Link>
                </>
              )}

              <NotificationBell />

              <Link
                to="/profile/behavior"
                className="hidden xl:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60 transition"
                title="View user behavioral telemetry and ML intent/fraud scores"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Behavior Telemetry</span>
              </Link>

              <Link
                to="/profile"
                className="flex items-center gap-2 p-1.5 sm:px-3 sm:py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-200 border border-slate-700/80 transition"
              >
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold">
                  {user.name?.charAt(0) || 'U'}
                </div>
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-bold text-white leading-none">
                    {user.name}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                    {user.role} {user.walletAddress ? '• 0x...' + user.walletAddress.substring(38) : ''}
                  </div>
                </div>
              </Link>

              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Link
                to="/login"
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-slate-950 transition shadow-md shadow-emerald-600/20"
              >
                Create Account
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Layout({ children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      <div>
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>

      <footer className="border-t border-slate-800 bg-slate-900/60 py-4 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div>
            TicketLedger 🇵🇰 — Blockchain Event Ticketing for Pakistani Sports & Concerts
          </div>
          <div className="flex items-center gap-2">
            <span className="text-purple-400 font-medium">Module 8 Complete: Polygon Amoy Smart Contract & ERC721 NFT Minting Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/:id" element={<EventDetails />} />
            <Route path="/events/:id/seats" element={<SeatMap />} />
            <Route
              path="/checkout"
              element={
                <ProtectedRoute>
                  <Checkout />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings/:id/confirmation"
              element={
                <ProtectedRoute>
                  <BookingSuccess />
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-bookings"
              element={
                <ProtectedRoute>
                  <MyBookings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-nfts"
              element={
                <ProtectedRoute>
                  <MyNFTTickets />
                </ProtectedRoute>
              }
            />
            <Route
              path="/wallet"
              element={
                <ProtectedRoute>
                  <DigitalWallet />
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <Notifications />
                </ProtectedRoute>
              }
            />
            <Route path="/resale" element={<ResaleMarketplace />} />
            <Route
              path="/scanner"
              element={
                <ProtectedRoute allowedRoles={['GATE_STAFF', 'SUPER_ADMIN', 'ORGANIZER']}>
                  <GateScanner />
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile/behavior"
              element={
                <ProtectedRoute>
                  <BehaviorProfile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/behavior"
              element={
                <ProtectedRoute>
                  <BehaviorProfile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/company"
              element={
                <ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']}>
                  <CompanyRegistration />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/companies"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <AdminCompanies />
                </ProtectedRoute>
              }
            />
            <Route
              path="/organizer/create-event"
              element={
                <ProtectedRoute allowedRoles={['ORGANIZER', 'SUPER_ADMIN']}>
                  <CreateEvent />
                </ProtectedRoute>
              }
            />
            <Route path="/demand-forecast" element={<DemandForecast />} />
            <Route
              path="/admin/fraud-detection"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <AdminFraudWatchlist />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  );
}
