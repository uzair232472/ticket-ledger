import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Check, Copy, MapPin, MoreHorizontal, Search, ShieldCheck, Tag, Ticket, X } from 'lucide-react';
import { categoryName } from '../home/homeData';
import { getEventVisual } from '../../utils/eventMedia';
import { formatEventDate } from '../../utils/eventTime';
import { seatParts } from './WalletPass';

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;

/**
 * On-chain ticket card: event photo with a "Verified ticket" badge, then event, seat strip, original and
 * maximum resale price (110% cap) and the resale action. Stacks on narrow screens.
 */
export default function NftTicketCard({ ticket: t, onList, onCancelListing, onRelist, cancelling, onExplorer }) {
  const { event = {}, seat, blockchain } = t;
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);
  const sp = seatParts(seat);

  useEffect(() => {
    if (!menu) return undefined;
    const down = (e) => !menuRef.current?.contains(e.target) && setMenu(false);
    const key = (e) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);

  const copyTx = () => {
    if (!blockchain?.txHash) return;
    navigator.clipboard?.writeText(blockchain.txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const listing = t.activeResaleListing;
  const canList = t.status === 'ACTIVE' && !listing;

  return (
    <article className="tl-nft" data-reveal aria-label={`NFT ticket for ${event.name}`}>
      <div className="tl-nft-media">
        <img src={getEventVisual(event).imageUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        <span className="tl-nft-badge"><ShieldCheck className="w-5 h-5" aria-hidden="true" /> Verified ticket</span>
        {blockchain?.tokenId != null && <span className="tl-nft-token">TLT #{blockchain.tokenId}</span>}
      </div>

      <div className="tl-nft-body">
        <div className="tl-nft-top">
          <p className="tl-nft-kicker">{[categoryName(event.type, event.categoryLabel), event.city].filter(Boolean).join(' • ')}</p>
          <div ref={menuRef} className="tl-nft-menu-wrap">
            <button type="button" className="tl-nft-dots" aria-label="More options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal className="w-6 h-6" aria-hidden="true" />
            </button>
            {menu && (
              <div className="tl-pass-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onExplorer(); }}>
                  <Search className="w-4 h-4" aria-hidden="true" /> On-chain receipt
                </button>
                <button type="button" role="menuitem" onClick={copyTx} disabled={!blockchain?.txHash}>
                  {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy transaction hash'}
                </button>
              </div>
            )}
          </div>
        </div>

        <h3 className="tl-nft-title">{event.name}</h3>
        <p className="tl-nft-meta">
          <span><MapPin className="w-5 h-5" aria-hidden="true" /> {[event.venue, event.city].filter(Boolean).join(', ')}</span>
          {event.date && <><span className="tl-pass-sep" aria-hidden="true" /><span><Calendar className="w-5 h-5" aria-hidden="true" /> {formatEventDate(event.date)}</span></>}
        </p>

        <div className="tl-nft-seat">
          <span className="tl-nft-seat-icon"><Ticket className="w-6 h-6" aria-hidden="true" /></span>
          <strong>{seat?.tierName || 'Ticket'}</strong>
          <span className="tl-pass-sep" aria-hidden="true" />
          <span>{sp.general ? `General admission · No. ${sp.seat}` : `Row ${sp.row} · Seat ${sp.seat}`}</span>
        </div>

        <div className="tl-nft-prices">
          <div>
            <p>Original price</p>
            <strong>{pkr(t.price)}</strong>
          </div>
          <div>
            <p>Maximum resale price</p>
            <strong>{pkr(t.resalePriceCap)}</strong>
            <span className="tl-nft-cap">110% limit</span>
          </div>
        </div>

        <div className="tl-nft-foot">
          <span className="tl-nft-protected"><ShieldCheck className="w-6 h-6" aria-hidden="true" /> Resale protected</span>
          {listing?.status === 'PAUSED' ? (
            <div className="tl-nft-listed">
              <span>Listing paused: the event moved</span>
              <button type="button" className="tl-pass-btn tl-pass-btn--primary" onClick={() => onRelist?.(listing.id)} disabled={cancelling}>
                <Tag className="w-4 h-4" aria-hidden="true" /> Relist
              </button>
              <button type="button" className="tl-pass-btn tl-pass-btn--outline" onClick={() => onCancelListing(listing.id)} disabled={cancelling}>
                <X className="w-4 h-4" aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel listing'}
              </button>
            </div>
          ) : listing ? (
            <div className="tl-nft-listed">
              <span>Listed at {pkr(listing.resalePrice)}</span>
              <button type="button" className="tl-pass-btn tl-pass-btn--outline" onClick={() => onCancelListing(listing.id)} disabled={cancelling}>
                <X className="w-4 h-4" aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel listing'}
              </button>
            </div>
          ) : canList ? (
            <button type="button" className="tl-pass-btn tl-pass-btn--primary" onClick={onList}>
              <Tag className="w-5 h-5" aria-hidden="true" /> List for resale
            </button>
          ) : (
            <span className="tl-nft-state">{t.status?.toLowerCase()}</span>
          )}
        </div>
      </div>
    </article>
  );
}
