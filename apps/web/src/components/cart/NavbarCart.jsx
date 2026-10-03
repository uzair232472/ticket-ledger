import React from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { useCartHolds } from '../../hooks/useCartHolds';

/**
 * Permanent Navbar Cart icon linking directly to /cart page.
 * Displays real-time held seat count badge with countdown synchronization.
 */
export default function NavbarCart() {
  const { totalCount, first, secondsLeft } = useCartHolds();
  const hasItems = totalCount > 0 && first && secondsLeft > 0;

  return (
    <Link
      to="/cart"
      className={`relative inline-flex items-center justify-center p-2 rounded-xl transition duration-150 ${
        hasItems
          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-sm hover:bg-emerald-100 ring-2 ring-emerald-400/30'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      }`}
      aria-label={hasItems ? `Cart: ${totalCount} tickets reserved` : 'Shopping cart'}
      title={hasItems ? `${totalCount} seats held: Complete booking` : 'Shopping Cart'}
    >
      <ShoppingBag className="w-4 h-4" />
      {hasItems && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-[#16a34a] text-white text-[11px] font-black rounded-full flex items-center justify-center shadow-md animate-pulse">
          {totalCount}
        </span>
      )}
    </Link>
  );
}
