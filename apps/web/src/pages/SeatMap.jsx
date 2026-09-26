import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { trackClientBehavior } from '../utils/api';
import {
  Ticket,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  ShoppingBag,
  Info,
  ShieldCheck,
  MapPin,
  Calendar,
  Lock,
  ChevronRight
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5000';

export default function SeatMap() {
  const { id: eventId } = useParams();
  const navigate = useNavigate();
  const { user, token, isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [sections, setSections] = useState({});
  const [summary, setSummary] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  // User's currently locked seats
  const [myLockedSeats, setMyLockedSeats] = useState([]);
  const [timeLeft, setTimeLeft] = useState(null); // in seconds

  const socketRef = useRef(null);
  const timerRef = useRef(null);

  // Headers helper
  const getAuthHeaders = () => {
    const sessionId = localStorage.getItem('tl_session_id') || 'sess_default';
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-session-id': sessionId,
    };
  };

  // 1. Fetch Event Seat Map
  const fetchSeatMap = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`${API_BASE_URL}/api/seats/event/${eventId}`, {
        headers: getAuthHeaders(),
      });

      if (res.data.success) {
        const { event, sections: fetchedSections, summary: fetchedSummary, seats } = res.data.data;
        setEventData(event);
        setSections(fetchedSections);
        setSummary(fetchedSummary);

        const sectionNames = Object.keys(fetchedSections);
        if (sectionNames.length > 0 && !activeSection) {
          setActiveSection(sectionNames[0]);
        }

        // Identify seats locked by the current user
        if (user) {
          const userLocked = seats.filter(
            (s) => s.status === 'LOCKED' && s.isLockedByMe
          );
          setMyLockedSeats(userLocked);

          // Calculate lowest remaining TTL
          if (userLocked.length > 0) {
            const now = Date.now();
            const expiries = userLocked
              .map((s) => new Date(s.lockedUntil).getTime())
              .filter((t) => t > now);
            if (expiries.length > 0) {
              const earliest = Math.min(...expiries);
              setTimeLeft(Math.max(0, Math.floor((earliest - now) / 1000)));
            }
          } else {
            setTimeLeft(null);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching seat map:', err);
      setError(err.response?.data?.message || 'Failed to load stadium seat map.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Setup Socket.io real-time listener
  useEffect(() => {
    fetchSeatMap();

    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    // Handle real-time seat lock/unlock events broadcast by API
    socket.on('seat:status_change', (payload) => {
      if (payload.eventId === eventId) {
        setSections((prevSections) => {
          if (!prevSections[payload.section]) return prevSections;

          const updatedSection = { ...prevSections[payload.section] };
          const rowSeats = updatedSection.rows[payload.row] || [];

          updatedSection.rows[payload.row] = rowSeats.map((seat) => {
            if (seat.id === payload.seatId) {
              const isLockedByMe = user && payload.lockedByUserId === user.id;
              return {
                ...seat,
                status: payload.status,
                lockedUntil: payload.lockedUntil,
                isLockedByMe,
              };
            }
            return seat;
          });

          return {
            ...prevSections,
            [payload.section]: updatedSection,
          };
        });

        // Update summary counts locally
        setSummary((prev) => {
          if (!prev) return prev;
          if (payload.status === 'LOCKED') {
            return { ...prev, available: Math.max(0, prev.available - 1), locked: prev.locked + 1 };
          } else if (payload.status === 'AVAILABLE') {
            return { ...prev, available: prev.available + 1, locked: Math.max(0, prev.locked - 1) };
          }
          return prev;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [eventId, user?.id]);

  // 3. Countdown timer for seat locks
  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) {
      if (timeLeft === 0 && myLockedSeats.length > 0) {
        alert('Your 10-minute seat reservation has expired. Please select your seats again.');
        setMyLockedSeats([]);
        fetchSeatMap();
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [timeLeft]);

  // 4. Toggle Seat Lock / Unlock
  const handleSeatClick = async (seat) => {
    if (!isAuthenticated) {
      alert('Please sign in to select and reserve seats.');
      navigate('/login');
      return;
    }

    if (seat.status === 'SOLD') {
      alert('This seat is already sold and minted as an NFT ticket on the Polygon blockchain.');
      return;
    }

    if (seat.status === 'BLOCKED') {
      alert('This seat is blocked by stadium venue security.');
      return;
    }

    if (seat.status === 'LOCKED' && !seat.isLockedByMe) {
      alert('This seat is currently held under a 10-minute temporary reservation by another customer.');
      return;
    }

    setActionLoading(true);

    try {
      if (seat.isLockedByMe) {
        // Unlock / release seat
        const res = await axios.post(
          `${API_BASE_URL}/api/seats/unlock`,
          { seatId: seat.id },
          { headers: getAuthHeaders() }
        );

        if (res.data.success) {
          setMyLockedSeats((prev) => prev.filter((s) => s.id !== seat.id));
          updateLocalSeatStatus(seat, 'AVAILABLE', false);
          if (myLockedSeats.length <= 1) {
            setTimeLeft(null);
          }
        }
      } else {
        // Lock / reserve seat
        const res = await axios.post(
          `${API_BASE_URL}/api/seats/lock`,
          { seatId: seat.id },
          { headers: getAuthHeaders() }
        );

        if (res.data.success) {
          const lockedSeat = {
            ...seat,
            status: 'LOCKED',
            isLockedByMe: true,
            lockedUntil: res.data.data.seat.lockedUntil,
          };
          setMyLockedSeats((prev) => [...prev, lockedSeat]);
          updateLocalSeatStatus(seat, 'LOCKED', true, res.data.data.seat.lockedUntil);

          // Track seat selection
          trackClientBehavior('seat_selected', eventId, {
            seatId: seat.id,
            section: seat.section,
            row: seat.row,
            seatNumber: seat.seatNumber,
          });

          // Reset timer to 10 minutes (600s)
          setTimeLeft(600);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Seat lock action failed.';
      alert(`⚠️ Lock Notice: ${msg}`);
      // Refresh to ensure client is in sync with Redis
      fetchSeatMap();
    } finally {
      setActionLoading(false);
    }
  };

  const updateLocalSeatStatus = (targetSeat, newStatus, isLockedByMe, lockedUntil = null) => {
    setSections((prev) => {
      const sec = prev[targetSeat.section];
      if (!sec) return prev;
      const rows = { ...sec.rows };
      if (!rows[targetSeat.row]) return prev;

      rows[targetSeat.row] = rows[targetSeat.row].map((s) => {
        if (s.id === targetSeat.id) {
          return {
            ...s,
            status: newStatus,
            isLockedByMe,
            lockedUntil,
          };
        }
        return s;
      });

      return {
        ...prev,
        [targetSeat.section]: {
          ...sec,
          rows,
        },
      };
    });
  };

  // Format seconds to MM:SS
  const formatTimer = (seconds) => {
    if (seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate total price of user's locked seats
  const totalPrice = myLockedSeats.reduce((sum, s) => sum + Number(s.tier?.price || 0), 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
        <p className="text-slate-400 text-sm">Loading stadium seating map and Redis locks...</p>
      </div>
    );
  }

  if (error || !eventData) {
    return (
      <div className="max-w-xl mx-auto p-6 rounded-2xl bg-rose-950/20 border border-rose-800/40 text-center">
        <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-white mb-2">Seating Plan Unavailable</h2>
        <p className="text-xs text-rose-300 mb-6">{error || 'Event not found.'}</p>
        <Link
          to="/events"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-semibold hover:bg-slate-700 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Return to Events
        </Link>
      </div>
    );
  }

  const currentSectionData = sections[activeSection] || null;

  return (
    <div className="space-y-6">
      {/* Top Header / Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <Link
            to={`/events/${eventId}`}
            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition mb-2 font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Event Details
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight">{eventData.name}</h1>
            {socketConnected && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Live Sync
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 mt-1">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-500" /> {eventData.venue}, {eventData.city}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-500" /> {new Date(eventData.date).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* 10-Minute Lock Timer Banner */}
        {myLockedSeats.length > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-amber-200">
            <Clock className="w-6 h-6 text-amber-400 animate-pulse" />
            <div>
              <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                Holding Reservation
              </div>
              <div className="text-xl font-black font-mono text-white">
                {formatTimer(timeLeft)}
              </div>
            </div>
            <div className="text-[10px] text-amber-300/80 max-w-[130px] leading-tight">
              Atomic Redis Lock expires in 10 minutes.
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Seat Map on Left, Sidebar Drawer on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (8 cols): Stadium Map */}
        <div className="lg:col-span-8 space-y-6">
          {/* Pitch / Stage Visual Orientation Banner */}
          <div className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-950 border border-emerald-700/50 flex flex-col items-center justify-center text-center shadow-lg shadow-emerald-950/50">
            <div className="text-xs font-black tracking-widest text-emerald-300 uppercase flex items-center gap-2">
              <span>🏏</span>
              <span>GROUND PITCH / STAGE DIRECTION</span>
              <span>🎸</span>
            </div>
            <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5">
              All seats face towards this boundary line
            </div>
          </div>

          {/* Section Selection Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {Object.keys(sections).map((secName) => {
              const sec = sections[secName];
              const isSelected = activeSection === secName;
              return (
                <button
                  key={secName}
                  onClick={() => setActiveSection(secName)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition border ${
                    isSelected
                      ? 'bg-emerald-600 text-slate-950 border-emerald-500 shadow-md shadow-emerald-600/30'
                      : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{secName}</span>
                    <span className="text-[10px] opacity-80">
                      (Rs. {Number(sec.tierPrice).toLocaleString()})
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Seating Grid Canvas */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-x-auto">
            {currentSectionData ? (
              <div className="min-w-[550px] space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Section: {currentSectionData.sectionName}
                    </h3>
                    <p className="text-[11px] text-emerald-400">
                      Tier: {currentSectionData.tierName} • Rs. {Number(currentSectionData.tierPrice).toLocaleString()} per seat
                    </p>
                  </div>
                  <div className="text-xs text-slate-400">
                    Click seat to reserve (10m lock)
                  </div>
                </div>

                {/* Rows & Seats */}
                <div className="space-y-3 py-2">
                  {Object.keys(currentSectionData.rows)
                    .sort()
                    .map((rowLetter) => (
                      <div key={rowLetter} className="flex items-center gap-3">
                        {/* Row Label */}
                        <div className="w-7 text-xs font-extrabold text-slate-400 text-right select-none">
                          {rowLetter}
                        </div>

                        {/* Seat Icons */}
                        <div className="flex flex-wrap gap-2">
                          {currentSectionData.rows[rowLetter].map((seat) => {
                            const isMine = seat.isLockedByMe;
                            const isSold = seat.status === 'SOLD';
                            const isLockedOther = seat.status === 'LOCKED' && !isMine;
                            const isBlocked = seat.status === 'BLOCKED';
                            const isAvailable = seat.status === 'AVAILABLE';

                            // Determine seat styling
                            let seatClass = 'bg-emerald-950/80 text-emerald-400 border-emerald-600/70 hover:bg-emerald-500 hover:text-slate-950 hover:scale-110 cursor-pointer';
                            let tooltip = `Row ${seat.row} - Seat ${seat.seatNumber} (Available)`;

                            if (isMine) {
                              seatClass = 'bg-cyan-500 text-slate-950 border-cyan-300 ring-2 ring-cyan-400 animate-pulse font-black cursor-pointer shadow-lg shadow-cyan-500/40';
                              tooltip = `Row ${seat.row} - Seat ${seat.seatNumber} (Locked by You)`;
                            } else if (isSold) {
                              seatClass = 'bg-rose-950/40 text-rose-500 border-rose-900/60 opacity-60 cursor-not-allowed';
                              tooltip = `Row ${seat.row} - Seat ${seat.seatNumber} (Sold NFT)`;
                            } else if (isLockedOther) {
                              seatClass = 'bg-amber-950/60 text-amber-400 border-amber-600/60 cursor-not-allowed animate-pulse';
                              tooltip = `Row ${seat.row} - Seat ${seat.seatNumber} (Locked by someone else)`;
                            } else if (isBlocked) {
                              seatClass = 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed';
                              tooltip = `Row ${seat.row} - Seat ${seat.seatNumber} (Blocked)`;
                            }

                            return (
                              <button
                                key={seat.id}
                                disabled={actionLoading || isSold || isLockedOther || isBlocked}
                                onClick={() => handleSeatClick(seat)}
                                title={tooltip}
                                className={`w-9 h-9 rounded-lg border text-xs font-bold flex flex-col items-center justify-center transition-all duration-150 select-none ${seatClass}`}
                              >
                                <span>{seat.seatNumber}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-xs text-center py-8">Select a section above to view seats.</p>
            )}
          </div>

          {/* Color Legend */}
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-emerald-950 border border-emerald-600"></div>
              <span className="text-slate-300">Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-cyan-500 border border-cyan-300 ring-2 ring-cyan-400"></div>
              <span className="text-slate-200 font-semibold">Selected by You</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-amber-950 border border-amber-500"></div>
              <span className="text-slate-300">Locked (10m TTL)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-rose-950 border border-rose-800 opacity-60"></div>
              <span className="text-slate-400">Sold (NFT Minted)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-slate-800 border border-slate-700"></div>
              <span className="text-slate-400">Blocked</span>
            </div>
          </div>
        </div>

        {/* Right Column (4 cols): Summary & Selected Seats Drawer */}
        <div className="lg:col-span-4 space-y-6">
          {/* Reservation Summary Card */}
          <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-emerald-400" />
                Selected Seats ({myLockedSeats.length})
              </h2>
              {myLockedSeats.length > 0 && (
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/80 px-2 py-0.5 rounded">
                  Lock Active
                </span>
              )}
            </div>

            {/* List of User's Locked Seats */}
            {myLockedSeats.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <Ticket className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">No seats selected yet.</p>
                <p className="text-[11px] text-slate-500">
                  Click on any green seat from the map to lock it for 10 minutes.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                {myLockedSeats.map((seat) => (
                  <div
                    key={seat.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-white">
                        {seat.section} • Row {seat.row}, Seat {seat.seatNumber}
                      </div>
                      <div className="text-[10px] text-emerald-400">
                        {seat.tier?.name || 'Standard'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-mono font-bold text-white">
                        Rs. {Number(seat.tier?.price || 0).toLocaleString()}
                      </div>
                      <button
                        onClick={() => handleSeatClick(seat)}
                        title="Remove seat"
                        className="text-slate-500 hover:text-rose-400 transition"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Price Calculations */}
            {myLockedSeats.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Subtotal ({myLockedSeats.length} seats)</span>
                  <span className="font-mono text-white">Rs. {totalPrice.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Gas & Blockchain Verification</span>
                  <span className="font-mono text-emerald-400">Free (Sponsored)</span>
                </div>
                <div className="flex items-center justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                  <span>Total Amount</span>
                  <span className="font-mono text-emerald-400 text-lg">
                    Rs. {totalPrice.toLocaleString()}
                  </span>
                </div>

                {/* Proceed to Checkout Button */}
                <button
                  onClick={() => {
                    navigate('/checkout', {
                      state: {
                        eventId,
                        event: eventData,
                        seats: myLockedSeats,
                        totalPrice,
                      },
                    });
                  }}
                  className="w-full mt-4 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
                >
                  <span>Proceed to Checkout</span>
                  <ChevronRight className="w-4 h-4 font-bold" />
                </button>
              </div>
            )}

            {/* Redis & Anti-Scalping Note */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1 text-[11px] text-slate-400">
              <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Anti-Scalping Architecture
              </div>
              <p className="text-[10px] leading-relaxed">
                Seats are secured with atomic Redis locks with 10-minute TTL. Bot collisions are blocked at microsecond precision to guarantee fair ticket distribution.
              </p>
            </div>
          </div>

          {/* Stadium Capacity Stats */}
          {summary && (
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-slate-400" /> Venue Capacity Breakdown
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500">Available</div>
                  <div className="text-sm font-bold text-emerald-400">{summary.available}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500">Locked (TTL)</div>
                  <div className="text-sm font-bold text-amber-400">{summary.locked}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500">Sold (NFTs)</div>
                  <div className="text-sm font-bold text-rose-400">{summary.sold}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] text-slate-500">Total Capacity</div>
                  <div className="text-sm font-bold text-white">{summary.total}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
