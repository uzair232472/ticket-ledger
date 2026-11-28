import React from 'react';
import { Search, X } from 'lucide-react';
import './accountSearch.css';

/** Lower-cased text of the given values, for a simple "contains" search. */
export const haystack = (...values) => values.filter((v) => v != null && v !== '').join(' ').toLowerCase();

/** True when every word of the query appears in the text. */
export const matchesQuery = (text, query) => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => text.includes(w));
};

/** Search field for the account pages (wallet, NFT tickets, orders), with a result count and a clear button. */
export default function AccountSearch({ id, value, onChange, placeholder, shown, total, noun = 'results' }) {
  return (
    <div className="tl-asearch" role="search">
      <label className="tl-asearch-field" htmlFor={id}>
        <Search className="tl-asearch-ico" aria-hidden="true" />
        <span className="tl-sr">Search</span>
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onChange('')}
          placeholder={placeholder}
          autoComplete="off"
        />
        {value && (
          <button type="button" className="tl-asearch-clear" onClick={() => onChange('')} aria-label="Clear search">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </label>
      {value.trim() && (
        <p className="tl-asearch-count" role="status">
          {shown} of {total} {noun}
        </p>
      )}
    </div>
  );
}
