import fs from 'fs/promises';
import path from 'path';

/*
 * A4 ticket PDF in the TicketLedger look: brand header, dark green event banner (with the event photo),
 * a notched seat panel, the gate QR next to a "Verified pass" stamp, and arrival notes.
 * Everything is drawn with PDFKit primitives; the logo is the brand mark's own vector paths.
 */

// Brand mark (same paths as apps/web/src/components/brand/markPaths.js)
const MARK = {
  box: { x: 131, y: 211, w: 760, h: 604 },
  gradient: { x1: 238.56, y1: 512.87, x2: 882.95, y2: 512.87, from: '#0175fe', to: '#3d3ffc' },
  back: 'M139.15,521.13v-116.25s-.48-10,9.5-25.09c5.12-7.75,12.3-13.92,20.61-18.06l284.8-142.04c.29-.14.58-.24.9-.3.14-.02.31-.05.5-.08,11.54-1.67,21.8,7.51,21.8,19.17v26.6s-.53,16.38-11.87,30.78c-3.84,4.87-8.94,8.59-14.57,11.19l-216.58,100.11s-11.52,5.25-20.54,18.74c-5.95,8.89-8.83,19.49-8.87,30.19l-.45,110.48c-.01,2.54-2.77,4.11-4.95,2.82l-53.83-31.65c-.18-.1-.34-.22-.5-.36-1.15-1.03-5.96-5.99-5.96-16.25Z',
  ticket: 'M880.95,559.42l-28.97-77.29c-79.04,21.64-103.71-49.01-103.71-49.01-22.05-74.07,52.79-107.91,52.79-107.91l-30.63-83.9c-.99-2.7-2.29-5.29-3.98-7.61-13.57-18.59-32.59-15.86-38.87-14.32-1.16.28-2.29.69-3.38,1.18l-464.6,209.81c-3.35,1.51-6.45,3.54-9.05,6.13-7.3,7.28-10.18,16.14-11.3,21.45-.48,2.28-.7,4.61-.7,6.95v98.78s203.37-98.65,203.37-98.65l2.02,342.44,423.89-205.82c.32-.15.64-.32.94-.5,16.55-9.7,14.63-30.14,13.36-37.38-.26-1.48-.67-2.93-1.19-4.33ZM549.57,404.85l-11.52-30.38c-2.71-7.2.89-15.24,8.09-17.97,1.61-.6,3.27-.89,4.91-.89,5.62,0,10.95,3.42,13.06,8.99l11.49,30.38c2.74,7.2-.89,15.24-8.09,17.97-7.17,2.74-15.24-.89-17.94-8.09ZM583.77,487.82l-11.49-30.38c-2.74-7.2.89-15.24,8.09-17.97,1.61-.6,3.27-.89,4.91-.89,5.62,0,10.92,3.42,13.03,8.99l11.52,30.38c2.71,7.2-.92,15.24-8.09,17.97-7.2,2.71-15.24-.89-17.97-8.09ZM617.22,569.36l-11.52-30.38c-2.74-7.17.89-15.24,8.09-17.94,1.64-.63,3.3-.92,4.94-.92,5.62,0,10.92,3.45,13,9.02l11.52,30.38c2.74,7.2-.89,15.24-8.09,17.94-7.2,2.74-15.24-.89-17.94-8.09ZM669.12,659.02c-7.2,2.71-15.24-.89-17.97-8.09l-11.52-30.38c-2.71-7.2.92-15.24,8.09-17.97,1.64-.62,3.3-.89,4.94-.89,5.62,0,10.92,3.42,13.03,8.99l11.52,30.38c2.71,7.2-.92,15.24-8.09,17.97Z',
  base: 'M238.24,691.4v-65.99c0-7.88,2.25-15.67,6.89-22.04,3-4.12,7.23-8.32,13.12-11.45l150.44-79.05v293.45l-154.75-88.9s-13.08-5.61-15.46-21.86c-.2-1.37-.24-2.77-.24-4.15Z',
};

// Line icons (24×24, Lucide)
const ICONS = {
  pin: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', 'M15 10a3 3 0 1 1-6 0a3 3 0 1 1 6 0'],
  calendar: ['M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M16 2v4', 'M8 2v4', 'M3 10h18', 'M8 14h.01', 'M12 14h.01', 'M16 14h.01', 'M8 18h.01', 'M12 18h.01'],
  clipboard: ['M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M12 11h4', 'M12 16h4', 'M8 11h.01', 'M8 16h.01'],
  ticketCheck: ['M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z', 'm9 12 2 2 4-4'],
};

const C = {
  paper: '#f7f8f4',
  ink: '#0b1a10',
  muted: '#55645a',
  green: '#15803d',
  greenDark: '#0d2a1b',
  greenSoft: '#eaf2ea',
  line: '#c9d8cb',
  white: '#ffffff',
};

const CATEGORY = {
  CRICKET_MATCH: 'Cricket', MUSIC_CONCERT: 'Live music', MUSIC_FESTIVAL: 'Festival', FOOTBALL_MATCH: 'Football',
  KABADDI: 'Kabaddi', BOXING: 'Boxing', HOCKEY_MATCH: 'Hockey', QAWWALI: 'Qawwali', THEATRE: 'Theatre',
  CONFERENCE: 'Conference', GENERAL_ADMISSION: 'General admission',
};

// Fallback banner photos per category (Unsplash, already used by the web app)
const unsplash = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1000&q=70&fm=jpg`;
const FALLBACK_PHOTO = {
  CRICKET_MATCH: unsplash('1540747913346-19e32dc3e97e'),
  MUSIC_CONCERT: unsplash('1470229722913-7c0e2dbbafd3'),
  MUSIC_FESTIVAL: unsplash('1514525253161-7a46d19cd819'),
  FOOTBALL_MATCH: unsplash('1522778119026-d647f0596c20'),
  BOXING: unsplash('1549719386-74dfcbf7dbed'),
  default: unsplash('1501386761578-eac5c94b800a'),
};

const isImage = (buf) =>
  buf && buf.length > 8 && ((buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47));

/** Event photo as a JPEG/PNG buffer: organizer upload first, then the category photo; null if none loads. */
export async function loadEventPhoto(event) {
  const candidates = [event?.bannerUrl, event?.cardImageUrl, FALLBACK_PHOTO[event?.type] || FALLBACK_PHOTO.default].filter(Boolean);
  for (const url of candidates) {
    try {
      let buf;
      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) continue;
        buf = Buffer.from(await res.arrayBuffer());
      } else {
        // Local uploads are served from <api>/uploads
        buf = await fs.readFile(path.join(process.cwd(), url.replace(/^\/+/, '')));
      }
      if (isImage(buf)) return buf;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const drawIcon = (doc, name, x, y, size, color, width = 2) => {
  doc.save().translate(x, y).scale(size / 24);
  ICONS[name].forEach((d) => doc.path(d).lineWidth(width).lineCap('round').lineJoin('round').stroke(color));
  doc.restore();
};

const drawMark = (doc, x, y, height) => {
  const s = height / MARK.box.h;
  doc.save().translate(x, y).scale(s).translate(-MARK.box.x, -MARK.box.y);
  doc.path(MARK.back).fill('#051a3d');
  const g = doc.linearGradient(MARK.gradient.x1, MARK.gradient.y1, MARK.gradient.x2, MARK.gradient.y2);
  g.stop(0, MARK.gradient.from).stop(1, MARK.gradient.to);
  doc.path(MARK.ticket).fill(g);
  doc.path(MARK.base).fill('#051a3d');
  doc.restore();
  return (MARK.box.w / MARK.box.h) * height;
};

/** Text along a circle: `from`→`to` in degrees (0° = right, clockwise), `outside` flips for the lower arc. */
const arcText = (doc, text, cx, cy, r, from, to, { size = 11, color = C.green, lower = false } = {}) => {
  doc.font('Helvetica-Bold').fontSize(size).fillColor(color);
  const chars = [...text];
  const step = chars.length > 1 ? (to - from) / (chars.length - 1) : 0;
  chars.forEach((ch, i) => {
    const deg = from + step * i;
    const rad = (deg * Math.PI) / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    const w = doc.widthOfString(ch);
    doc.save().rotate(lower ? deg - 90 : deg + 90, { origin: [x, y] });
    doc.text(ch, x - w / 2, y - size / 2, { lineBreak: false });
    doc.restore();
  });
};

const star = (doc, cx, cy, r, color) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  doc.polygon(...pts).fill(color);
};

const label = (doc, text, x, y, opts = {}) =>
  doc.font('Helvetica-Bold').fontSize(8).fillColor(opts.color || C.green).text(text.toUpperCase(), x, y, { characterSpacing: 1.6, lineBreak: false, ...opts });

const STATUS_STYLE = {
  ACTIVE: { fg: C.green, bg: '#e7f4ea', border: '#86c79a' },
  SCANNED: { fg: '#475569', bg: '#eef1f4', border: '#b6c0cb' },
  RESOLD: { fg: '#b42318', bg: '#fdecea', border: '#f1a8a1' },
  TRANSFERRED: { fg: '#b42318', bg: '#fdecea', border: '#f1a8a1' },
};

/**
 * Draws the whole ticket on `doc` (A4, 595×842 pt). `qrBuffer` is the signed gate QR (PNG);
 * `photo` the event image buffer or null.
 */
export function drawTicketPdf(doc, ticket, { qrBuffer, photo, manualCode }) {
  const ev = ticket.event || {};
  const seat = ticket.seat || {};
  const W = 595;
  const M = 36;
  const inner = W - M * 2;

  doc.rect(0, 0, W, 842).fill(C.paper);

  /* ---------- Header: logo, tagline, status ---------- */
  const markH = 38;
  doc.font('Helvetica-Bold').fontSize(30);
  const wTicket = doc.widthOfString('Ticket');
  const wLedger = doc.widthOfString('Ledger');
  const markW = (MARK.box.w / MARK.box.h) * markH;
  const groupW = markW + 10 + wTicket + wLedger;
  const gx = (W - groupW) / 2;
  drawMark(doc, gx, 34, markH);
  doc.fillColor(C.ink).text('Ticket', gx + markW + 10, 40, { lineBreak: false });
  doc.fillColor(C.green).text('Ledger', gx + markW + 10 + wTicket, 40, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink);
  const tag = 'YOUR OFFICIAL EVENT PASS';
  const tagW = doc.widthOfString(tag, { characterSpacing: 2.2 });
  doc.text(tag, (W - tagW) / 2, 78, { characterSpacing: 2.2, lineBreak: false });

  const status = ticket.status || 'ACTIVE';
  const st = STATUS_STYLE[status] || STATUS_STYLE.SCANNED;
  doc.font('Helvetica-Bold').fontSize(10);
  const pillW = doc.widthOfString(status, { characterSpacing: 1.2 }) + 36;
  const px = W - M - pillW;
  doc.roundedRect(px, 40, pillW, 26, 8).fillAndStroke(st.bg, st.border);
  doc.circle(px + 14, 53, 3.5).fill(st.fg);
  doc.fillColor(st.fg).text(status, px + 24, 48.5, { characterSpacing: 1.2, lineBreak: false });

  /* ---------- Event banner ---------- */
  const bY = 104;
  const bH = 210;
  doc.save().roundedRect(M, bY, inner, bH, 14).clip();
  doc.rect(M, bY, inner, bH).fill(C.greenDark);
  if (photo) {
    try {
      const ix = M + inner * 0.42;
      // "cover" scales without clipping, so clip to the photo's own box first
      doc.save().rect(ix, bY, inner * 0.58, bH).clip();
      doc.image(photo, ix, bY, { cover: [inner * 0.58, bH], align: 'center', valign: 'center' });
      doc.restore();
      // Green wash and a fade from the text side into the photo
      doc.rect(ix, bY, inner * 0.58, bH).fillOpacity(0.45).fill(C.greenDark).fillOpacity(1);
      // (thin strips of falling opacity: gradient transparency renders unevenly across PDF viewers)
      const fadeW = inner * 0.3;
      const steps = 40;
      for (let i = 0; i < steps; i++) {
        doc.rect(ix + (fadeW / steps) * i, bY, fadeW / steps, bH).fillOpacity(1 - i / steps).fill(C.greenDark);
      }
      doc.fillOpacity(1);
    } catch {
      // unsupported image: keep the plain banner
    }
  }
  doc.restore();

  const tx = M + 26;
  const kicker = [CATEGORY[ev.type] || 'Event', ev.city].filter(Boolean).join(' • ').toUpperCase();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#d6e7da');
  doc.text(kicker, tx, bY + 24, { characterSpacing: 2.4, lineBreak: false });
  const kW = doc.widthOfString(kicker, { characterSpacing: 2.4 });
  doc.moveTo(tx + kW + 12, bY + 29).lineTo(M + inner - 26, bY + 29).lineWidth(0.6).stroke('#5f8a6c');

  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.white);
  doc.text(ev.name || 'Live event', tx, bY + 44, { width: inner * 0.62, lineGap: -2, height: 66, ellipsis: true });

  const infoY = bY + 118;
  drawIcon(doc, 'pin', tx, infoY, 20, '#4ade80', 1.8);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text(ev.venue || 'Venue to be announced', tx + 32, infoY, { width: inner * 0.5, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(11).fillColor('#c5d6ca').text(ev.city || 'Pakistan', tx + 32, infoY + 17, { lineBreak: false });

  const dateY = infoY + 44;
  drawIcon(doc, 'calendar', tx, dateY, 20, '#4ade80', 1.8);
  const dateText = ev.date
    ? new Date(ev.date).toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' })
    : 'Date to be announced';
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text(dateText, tx + 32, dateY, { lineBreak: false });
  if (ev.time) doc.text(`${ev.time} PKT`, tx + 32, dateY + 17, { lineBreak: false });

  /* ---------- Seat panel (notched ticket edge) ---------- */
  const sY = bY + bH + 10;
  const sH = 128;
  doc.roundedRect(M, sY, inner, sH, 6).fillAndStroke(C.greenSoft, C.line);
  // Notches on both sides
  [M, M + inner].forEach((nx) => doc.circle(nx, sY + sH / 2, 11).fillAndStroke(C.paper, C.line));
  doc.rect(M - 12, sY + sH / 2 - 12, 11.5, 24).fill(C.paper);
  doc.rect(M + inner + 0.5, sY + sH / 2 - 12, 12, 24).fill(C.paper);

  const general = seat.kind === 'GA_SLOT';
  const colA = M + 30;
  const colB = M + inner * 0.56;
  const colC = M + inner * 0.8;
  label(doc, 'Enclosure', colA, sY + 18);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.ink).text(seat.tier?.name || seat.section || 'General', colA, sY + 32, { width: colB - colA - 20, lineBreak: false, ellipsis: true });
  label(doc, general ? 'Entry' : 'Row', colB, sY + 18);
  doc.font('Helvetica-Bold').fontSize(18).text(general ? 'General' : String(seat.row ?? '—'), colB, sY + 32, { lineBreak: false });
  label(doc, general ? 'No.' : 'Seat', colC, sY + 18);
  doc.font('Helvetica-Bold').fontSize(18).text(String(seat.seatNumber ?? '—'), colC, sY + 32, { lineBreak: false });
  [colB - 18, colC - 18].forEach((lx) => doc.moveTo(lx, sY + 16).lineTo(lx, sY + 56).lineWidth(0.6).stroke(C.line));

  doc.moveTo(colA, sY + 66).lineTo(M + inner - 30, sY + 66).lineWidth(0.6).stroke(C.line);
  label(doc, 'Ticket holder', colA, sY + 78);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(C.ink).text(ticket.user?.name || 'Ticket holder', colA, sY + 92, { width: colB - colA - 20, lineBreak: false, ellipsis: true });
  label(doc, 'Paid', colB, sY + 78);
  doc.font('Helvetica-Bold').fontSize(14).text(`PKR ${Number(ticket.price || 0).toLocaleString('en-PK')}`, colB, sY + 92, { lineBreak: false });
  doc.moveTo(colB - 18, sY + 76).lineTo(colB - 18, sY + 112).lineWidth(0.6).stroke(C.line);

  /* ---------- Tear line ---------- */
  const tY = sY + sH + 14;
  doc.moveTo(M, tY).lineTo(M + inner, tY).lineWidth(1).dash(5, { space: 4 }).stroke('#9db8a3').undash();

  /* ---------- QR + verified stamp ---------- */
  const qY = tY + 16;
  const qS = 170;
  const qX = M + 50;
  doc.roundedRect(qX - 8, qY - 8, qS + 16, qS + 16, 6).fillAndStroke(C.white, C.line);
  doc.image(qrBuffer, qX, qY, { width: qS, height: qS });
  // Manual code under the QR, for when the gate camera can't read it
  if (manualCode) {
    doc.font('Courier-Bold').fontSize(13).fillColor(C.ink);
    doc.text(manualCode, qX + qS / 2 - doc.widthOfString(manualCode) / 2, qY + qS + 12, { lineBreak: false });
  }
  doc.font('Helvetica').fontSize(8).fillColor(C.muted);
  const cap = 'Manual entry code  •  Turn screen brightness up';
  doc.text(cap, qX + qS / 2 - doc.widthOfString(cap) / 2, qY + qS + (manualCode ? 30 : 14), { lineBreak: false });

  doc.moveTo(M + inner * 0.5, qY - 4).lineTo(M + inner * 0.5, qY + qS + 24).lineWidth(0.6).stroke(C.line);

  const rx = M + inner * 0.5;
  const rw = inner * 0.5;
  const ready = 'Ready for entry';
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.ink).text(ready, rx + (rw - doc.widthOfString(ready)) / 2, qY - 2, { lineBreak: false });
  doc.font('Helvetica').fontSize(11).fillColor(C.muted);
  const sub = 'Present your ticket at the venue gate.';
  doc.text(sub, rx + (rw - doc.widthOfString(sub)) / 2, qY + 26, { lineBreak: false });

  const cx = rx + rw / 2;
  const cy = qY + 112;
  doc.circle(cx, cy, 62).lineWidth(3).stroke(C.green);
  doc.circle(cx, cy, 55).lineWidth(0.8).stroke(C.green);
  doc.circle(cx, cy, 34).lineWidth(1.5).stroke(C.green);
  arcText(doc, 'TICKETLEDGER', cx, cy, 45, -150, -30, { size: 10.5 });
  arcText(doc, 'VERIFIED PASS', cx, cy, 45, 148, 32, { size: 10.5, lower: true });
  star(doc, cx - 45, cy, 4, C.green);
  star(doc, cx + 45, cy, 4, C.green);
  drawIcon(doc, 'ticketCheck', cx - 17, cy - 17, 34, C.green, 2);

  const ref = `TL-${ticket.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text(ref, cx - doc.widthOfString(ref) / 2, cy + 70, { lineBreak: false });

  /* ---------- Before you arrive ---------- */
  const aY = qY + qS + 44;
  const aH = 96;
  doc.roundedRect(M, aY, inner, aH, 8).fillAndStroke(C.greenSoft, C.line);
  drawIcon(doc, 'clipboard', M + 28, aY + 24, 46, C.ink, 1.6);
  doc.moveTo(M + 100, aY + 14).lineTo(M + 100, aY + aH - 14).lineWidth(0.6).stroke(C.line);
  label(doc, 'Before you arrive', M + 120, aY + 14, { color: C.ink });
  ['Keep your ticket ready at the entrance.', 'Each ticket admits one person.', 'Transfers and resale must use TicketLedger.'].forEach((line, i) => {
    const ly = aY + 34 + i * 20;
    doc.circle(M + 128, ly + 5, 7.5).fill(C.green);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white).text(String(i + 1), M + 125.4, ly + 1, { lineBreak: false });
    doc.font('Helvetica').fontSize(11).fillColor(C.ink).text(line, M + 146, ly, { lineBreak: false });
  });

  /* ---------- Footer ---------- */
  const fY = aY + aH + 26;
  doc.font('Helvetica-Bold').fontSize(11);
  const fA = 'TicketLedger';
  const fB = '  •  Secure event ticketing';
  const fAw = doc.widthOfString(fA);
  doc.font('Helvetica').fontSize(10);
  const fBw = doc.widthOfString(fB);
  const fx = (W - fAw - fBw) / 2;
  doc.moveTo(M, fY + 6).lineTo(fx - 14, fY + 6).lineWidth(0.6).stroke(C.line);
  doc.moveTo(fx + fAw + fBw + 14, fY + 6).lineTo(M + inner, fY + 6).stroke(C.line);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.green).text(fA, fx, fY, { lineBreak: false });
  doc.font('Helvetica').fontSize(10).fillColor(C.muted).text(fB, fx + fAw, fY + 1, { lineBreak: false });
}
