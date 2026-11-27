import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './pager.css';

export const PAGE_SIZE = 10;

/** The rows of `list` on `page` (0-based), and the page actually shown (clamped after a delete or refresh). */
export function pageOf(list, page, size = PAGE_SIZE) {
  const last = Math.max(0, Math.ceil(list.length / size) - 1);
  const now = Math.min(Math.max(0, page), last);
  return { rows: list.slice(now * size, (now + 1) * size), page: now };
}

/** Previous / next pager under a list: which rows are shown, and buttons to move a page at a time. */
export default function Pager({ page, total, onPage, label, size = PAGE_SIZE }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  return (
    <nav className="tl-pager" aria-label={`${label} pages`}>
      <p aria-live="polite">{from}–{to} of {total}</p>
      <div>
        <button type="button" className="tl-aov-pill" onClick={() => onPage(page - 1)} disabled={page === 0}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Previous
        </button>
        <span className="tl-pager-page">Page {page + 1} of {pages}</span>
        <button type="button" className="tl-aov-pill" onClick={() => onPage(page + 1)} disabled={page >= pages - 1}>
          Next <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
