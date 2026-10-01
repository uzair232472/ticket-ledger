import React, { useId } from 'react';
import { shapePath } from '@venue-core';
import VenueFeature, { VenueDefs } from '../VenueFeature';
import { layoutBox } from '../venueTheme';

/** Static thumbnail of a layout (template cards, saved layouts). */
export default function MiniPlan({ layout, tiers = {}, className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const b = layoutBox(layout);
  const hintColor = { premium: '#16a34a', standard: '#0d9488', value: '#2563eb' };
  return (
    <svg className={`tl-vm-svg ${className}`} viewBox={`${b.x - 10} ${b.y - 10} ${b.w + 20} ${b.h + 20}`} aria-hidden="true" style={{ cursor: 'inherit' }}>
      <VenueDefs uid={uid} />
      <rect className="tl-vm-site" x={0} y={0} width={layout.coordinate.width} height={layout.coordinate.height} rx={28} />
      <VenueFeature feature={{ ...layout.feature, label: undefined }} uid={uid} />
      {layout.sections.map((s) => (
        <path
          key={s.id}
          d={shapePath(s.shape)}
          className="tl-vm-shape"
          style={{ '--tier': tiers[s.tierId]?.color || hintColor[s.tierHint] || '#16a34a', cursor: 'inherit' }}
        />
      ))}
    </svg>
  );
}
