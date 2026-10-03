import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

const hideBroken = (e) => e.currentTarget.classList.add('is-broken');

/** One category panel (homepage strip and the All Categories page). `count` is undefined while loading. */
export default function CategoryCard({ cat, index, count }) {
  const ready = count !== undefined;
  return (
    <Link
      to={`/events?type=${cat.type}`}
      className="tl-category"
      style={{ '--panel': cat.panel, '--strip': cat.strip, '--ink': cat.ink }}
      aria-label={`${cat.name}: ${ready ? `${count} upcoming event${count === 1 ? '' : 's'}` : 'browse events'}`}
    >
      {/* The face grows below the row on hover/focus without changing the page layout */}
      <span className="tl-category-face">
        <span className="tl-category-media" aria-hidden="true">
          <img src={cat.image} alt="" loading="lazy" decoding="async" onError={hideBroken} />
        </span>
        <span className="tl-category-num">{String(index + 1).padStart(2, '0')}</span>
        <span className="tl-category-foot">
          {ready && <span className="tl-category-count">{count ? `${count} upcoming` : 'Nothing scheduled yet'}</span>}
          <span className="tl-category-label">
            {cat.name}
            <ArrowUpRight className="w-5 h-5" aria-hidden="true" />
          </span>
        </span>
      </span>
    </Link>
  );
}
