import React, { forwardRef, memo, useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { DEG, shapeAnchor, shapePath } from '@venue-core';
import VenueFeature, { VenueDefs } from './VenueFeature';
import { generated, geometryBox, layoutBox, sectionBox } from './venueTheme';
import { useCamera } from './useCamera';
import { resolveMediaUrl } from '../../utils/eventMedia';

// Level of detail, from the on-screen seat radius in pixels
const lodFor = (seatPx) => (seatPx >= 7.5 ? 3 : seatPx >= 4.5 ? 2 : seatPx >= 2 ? 1 : 0);

function SeatSymbol({ state, r }) {
  const k = r * 0.5;
  if (state === 'mine') return <path className="tl-vm-sym" d={`M${-k} 0 L${-k * 0.25} ${k * 0.7} L${k} ${-k * 0.6}`} />;
  if (state === 'sold') return <path className="tl-vm-sym" d={`M${-k} ${-k}L${k} ${k}M${k} ${-k}L${-k} ${k}`} />;
  if (state === 'blocked') return <path className="tl-vm-sym" d={`M${-k} ${k}L${k} ${-k}`} />;
  if (state === 'held') return <path className="tl-vm-sym" d={`M0 ${-k}V0L${k * 0.7} ${k * 0.5}`} />;
  if (state === 'protected') return <path className="tl-vm-sym" d={`M${-k * 0.6} 0h${k * 1.2}v${k * 0.9}h${-k * 1.2}z M${-k * 0.35} 0v${-k * 0.4}a${k * 0.35} ${k * 0.35} 0 0 1 ${k * 0.7} 0v${k * 0.4}`} />;
  return null;
}

/** Seats (or tables) of one section. Memoised: re-renders only when its states or detail level change. */
const SectionDetail = memo(function SectionDetail({ section, states, lod, rovingKey, color, describeSeat, tableStates, mode }) {
  const g = generated(section);
  const r = g.seatRadius;
  const interactive = mode === 'book' || mode === 'blocking';
  return (
    <g className="tl-vm-detail" style={{ '--tier': color }}>
      {lod >= 1 &&
        g.rowLabels.map((row) => (
          <g key={row.label} className="tl-vm-rowlabel" aria-hidden="true">
            <text x={row.x} y={row.y} fontSize={r * 1.5}>{row.label}</text>
            <text x={row.x2} y={row.y2} fontSize={r * 1.5}>{row.label}</text>
          </g>
        ))}
      {g.tables.map((t) => {
        const ts = tableStates?.[t.key];
        return (
          <g
            key={t.key}
            className={`tl-vm-table${ts ? ` is-${ts}` : ''}`}
            data-table={t.key}
            role={tableStates ? 'button' : undefined}
            tabIndex={tableStates ? (rovingKey === t.key ? 0 : -1) : undefined}
            aria-label={tableStates ? describeSeat?.({ table: t, state: ts }) : undefined}
          >
            <circle cx={t.x} cy={t.y} r={t.r} />
            <text x={t.x} y={t.y} fontSize={Math.max(r * 1.6, t.r * 0.55)} aria-hidden="true">{t.number}</text>
          </g>
        );
      })}
      {g.seats.map((s) => {
        const state = states?.[s.key] || (s.blocked ? 'blocked' : 'available');
        const seatInteractive = interactive && !s.tableKey ? true : interactive && !tableStates;
        return (
          <g
            key={s.key}
            className={`tl-vm-seat is-${state}`}
            data-seat={s.key}
            transform={`translate(${s.x} ${s.y})`}
            role={seatInteractive ? 'button' : undefined}
            tabIndex={seatInteractive ? (rovingKey === s.key ? 0 : -1) : undefined}
            aria-label={seatInteractive ? describeSeat?.({ seat: s, state }) : undefined}
            aria-pressed={seatInteractive && mode === 'book' ? state === 'mine' : undefined}
          >
            <circle r={r} />
            {lod >= 2 && <SeatSymbol state={state} r={r} />}
            {lod >= 3 && (state === 'available' || state === 'pending') && (
              <text className="tl-vm-seatnum" fontSize={r * 0.95} aria-hidden="true">{s.number}</text>
            )}
          </g>
        );
      })}
    </g>
  );
});

/**
 * Venue plan renderer shared by the organizer editor, the organizer's attendee preview and booking.
 * Everything is drawn from the layout data in one coordinate system, so the overview, the zoomed
 * section and the editor show the same geometry. Only the focused section's seats are mounted.
 */
const VenueMap = forwardRef(function VenueMap(
  {
    layout,
    tiers,
    mode = 'book', // 'book' | 'edit' | 'blocking'
    focusId = null,
    dim = false,
    sectionMeta,
    seatStates,
    tableStates,
    rovingKey,
    describeSeat,
    describeSection,
    onSectionClick,
    onSeatClick,
    onTableClick,
    onBackgroundClick,
    onHover,
    onKeyDown,
    onZoom,
    shouldPan,
    overlay,
    fitTo = 'canvas', // 'canvas' (editor: the whole design space) | 'geometry' (booking: what is drawn)
    className = '',
    ariaLabel = 'Venue plan',
  },
  ref
) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const [lod, setLod] = useState(0);
  const content = useMemo(() => (fitTo === 'geometry' ? geometryBox(layout) : layoutBox(layout)), [layout, fitTo]);
  const focused = useMemo(() => layout.sections.find((s) => s.id === focusId) || null, [layout, focusId]);
  const focusRadius = useRef(3);
  focusRadius.current = focused ? generated(focused).seatRadius || 3 : 3;

  const zoomCb = useRef(onZoom);
  zoomCb.current = onZoom;
  const lastZoom = useRef(0);
  const onScale = useCallback((px) => {
    const next = lodFor(px * focusRadius.current);
    setLod((prev) => (prev === next ? prev : next));
    // Report zoom only on meaningful changes (keeps editor handles a constant on-screen size)
    if (!lastZoom.current || px / lastZoom.current > 1.12 || px / lastZoom.current < 0.89) {
      lastZoom.current = px;
      zoomCb.current?.(px);
    }
    if (svgRef.current) svgRef.current.dataset.zoomed = px > 2.2 ? 'true' : 'false';
  }, []);
  const camera = useCamera(svgRef, content, { onScale, shouldPan });

  const toClient = useCallback((x, y) => {
    const el = svgRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return { x: 0, y: 0 };
    const m = el.getScreenCTM();
    const pt = el.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const p = pt.matrixTransform(m);
    const r = wrap.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  }, []);

  useImperativeHandle(ref, () => ({
    fitAll: (opts) => camera.fit(content, opts),
    fitSection: (id, opts) => {
      const s = layout.sections.find((x) => x.id === id);
      return s ? camera.fit(sectionBox(s), { pad: 0.14, ...opts }) : Promise.resolve();
    },
    zoomIn: camera.zoomIn,
    zoomOut: camera.zoomOut,
    toSvg: camera.toSvg,
    toClient,
    wasDrag: camera.wasDrag,
    scale: camera.scale,
    svg: () => svgRef.current,
  }), [camera, content, layout, toClient]);

  const sectionById = useMemo(() => Object.fromEntries(layout.sections.map((s) => [s.id, s])), [layout]);

  const handleClick = (e) => {
    if (camera.wasDrag() || e.target.closest('[data-handle]')) return;
    const seatEl = e.target.closest('[data-seat]');
    const tableEl = e.target.closest('[data-table]');
    const secEl = e.target.closest('[data-section]');
    if (seatEl && focused) return onSeatClick?.(seatEl.dataset.seat, focused, e);
    if (tableEl && focused) return onTableClick?.(tableEl.dataset.table, focused, e);
    if (secEl) return onSectionClick?.(sectionById[secEl.dataset.section], e);
    return onBackgroundClick?.(e);
  };

  const hoverFrom = (e) => {
    if (!onHover) return;
    const secEl = e.target.closest?.('[data-section]');
    if (!secEl) return onHover(null);
    const r = wrapRef.current.getBoundingClientRect();
    onHover(sectionById[secEl.dataset.section], { x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const focusFrom = (e) => {
    const secEl = e.target.closest?.('[data-section]');
    if (!secEl || !onHover) return;
    const s = sectionById[secEl.dataset.section];
    const a = shapeAnchor(s.shape);
    onHover(s, toClient(a.x, a.y), true);
  };

  const background = layout.background;
  // Labels are sized to fit inside their own section (along the arc for curved stands)
  const labelSpace = (s) => {
    const sh = s.shape;
    if (sh.type === 'arc') return { w: ((sh.r0 + sh.r1) / 2) * (sh.a1 - sh.a0) * DEG, h: sh.r1 - sh.r0 };
    if (sh.type === 'rect') return { w: sh.w, h: sh.h };
    const b = sectionBox(s);
    return { w: b.w * 0.7, h: b.h * 0.7 };
  };
  const fitText = (text, width, max) => Math.min(max, (width * 0.84) / (Math.max(4, text.length) * 0.58));

  return (
    <div ref={wrapRef} className={`tl-vm ${className}`}>
      <svg
        ref={svgRef}
        className={`tl-vm-svg is-${mode}${focused ? ' has-focus' : ''}${dim && focused ? ' is-dimmed' : ''}`}
        data-lod={lod}
        role="group"
        aria-label={ariaLabel}
        onClick={handleClick}
        onPointerMove={hoverFrom}
        onPointerLeave={() => onHover?.(null)}
        onFocus={focusFrom}
        onBlur={() => onHover?.(null)}
        onKeyDown={onKeyDown}
        preserveAspectRatio="xMidYMid meet"
      >
        <VenueDefs uid={uid} />
        {background ? (
          <image href={resolveMediaUrl(background.url)} x={0} y={0} width={layout.coordinate.width} height={layout.coordinate.height} preserveAspectRatio="none" opacity={background.opacity ?? 0.9} />
        ) : (
          <rect className="tl-vm-site" x={0} y={0} width={layout.coordinate.width} height={layout.coordinate.height} rx={28} />
        )}

        {/* Concourse: a soft band around every stand, so sections read as built structures */}
        {!background && (
          <g className="tl-vm-concourse" aria-hidden="true">
            {layout.sections.map((s) => (
              <path key={s.id} d={shapePath(s.shape)} />
            ))}
          </g>
        )}
        <VenueFeature feature={layout.feature} uid={uid} />

        <g className="tl-vm-sections">
          {layout.sections.map((s) => {
            const tier = tiers[s.tierId];
            const meta = sectionMeta?.(s) || {};
            const isFocus = s.id === focusId;
            const anchor = shapeAnchor(s.shape);
            const space = labelSpace(s);
            const fs = Math.max(3, fitText(s.name, space.w, Math.min(24, space.h * 0.3)));
            const subFs = meta.sub ? Math.max(2.5, fitText(meta.sub, space.w, fs * 0.66)) : 0;
            return (
              <g
                key={s.id}
                className={`tl-vm-section${isFocus ? ' is-focus' : ''}${meta.status ? ` is-${meta.status}` : ''}${s.level > 1 ? ' is-upper' : ''}${tier ? '' : ' no-tier'}`}
                style={{ '--tier': tier?.color || '#94a3b8' }}
              >
                <path
                  className="tl-vm-shape"
                  d={shapePath(s.shape)}
                  data-section={s.id}
                  filter={isFocus ? `url(#${uid}-lift)` : undefined}
                  role="button"
                  tabIndex={mode === 'book' && isFocus ? -1 : 0}
                  aria-label={describeSection ? describeSection(s, meta) : s.name}
                  aria-current={isFocus ? 'true' : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSectionClick?.(s, e);
                    }
                  }}
                />
                {meta.status === 'soldout' && <path className="tl-vm-hatch" d={shapePath(s.shape)} fill={`url(#${uid}-hatch)`} aria-hidden="true" />}
                {(!isFocus || lod < 1) && (
                  <g className="tl-vm-label" transform={`translate(${anchor.x} ${anchor.y}) rotate(${anchor.angle})`} aria-hidden="true">
                    <text className="tl-vm-name" fontSize={fs} y={meta.sub ? -fs * 0.25 : fs * 0.1}>{s.name}</text>
                    {meta.sub && <text className="tl-vm-sub" fontSize={subFs} y={fs * 0.45 + subFs * 0.7}>{meta.sub}</text>}
                  </g>
                )}
              </g>
            );
          })}
        </g>

        {focused && (
          <SectionDetail
            section={focused}
            states={seatStates}
            tableStates={tableStates}
            lod={lod}
            rovingKey={rovingKey}
            color={tiers[focused.tierId]?.color || '#94a3b8'}
            describeSeat={describeSeat}
            mode={mode}
          />
        )}
        {overlay?.(camera)}
      </svg>
    </div>
  );
});

export default VenueMap;
