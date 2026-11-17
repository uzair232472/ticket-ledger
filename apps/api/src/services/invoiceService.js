import PDFDocument from 'pdfkit';
import prisma from '../config/prisma.js';
import { drawMark, PDF_COLORS as C } from './ticketPdf.js';

/*
 * Booking invoices. A paid order gets an invoice number (INV-2026-000123) from one database sequence when it is
 * confirmed; the PDF is drawn on demand from the order's stored figures (never recalculated), in the ticket
 * PDF's look. The organizer is the seller (with their NTN and tax registration); TicketLedger sells on their behalf.
 */

/** Next invoice number, inside the confirming transaction. */
export async function nextInvoiceNumber(tx = prisma) {
  const [row] = await tx.$queryRaw`SELECT nextval('invoice_number_seq') AS n`;
  return `INV-${new Date().getFullYear()}-${String(Number(row.n)).padStart(6, '0')}`;
}

const pkr = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d) => new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
const METHOD = { STRIPE: 'Card (Stripe)', JAZZCASH: 'JazzCash', EASYPAISA: 'EasyPaisa', MOCK: 'Test payment' };
const STATUS = { SUCCESSFUL: 'PAID', REFUNDED: 'REFUNDED', PARTIALLY_REFUNDED: 'PARTLY REFUNDED' };

/** The order as an invoice, if this user may have it (the buyer, or a Super Admin). */
export async function loadInvoiceOrder(user, orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      event: { include: { company: { select: { companyName: true, address: true, city: true, email: true, phone: true, ntnCnic: true, taxLabel: true, taxRegistrationNumber: true } } } },
      tickets: { include: { seat: { include: { tier: true } } } },
      discountCode: { select: { code: true } },
      refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } },
    },
  });
  if (!order || (order.userId !== user.id && user.role !== 'SUPER_ADMIN')) return { error: 404, message: 'Booking not found.' };
  if (!order.invoiceNumber || !STATUS[order.status]) return { error: 409, message: 'An invoice is available once the booking is paid.' };
  return { order };
}

/** Draws the invoice into a PDFKit document. */
export function drawInvoice(doc, order) {
  const W = doc.page.width;
  const M = 48;
  const company = order.event.company;
  doc.rect(0, 0, W, doc.page.height).fill(C.paper);

  // Header: brand + invoice block
  drawMark(doc, M, 44, 30);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(C.ink).text('TicketLedger', M + 46, 50, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('Tickets sold on behalf of the organizer', M + 46, 70, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(24).fillColor(C.ink).text('Invoice', W - M - 200, 44, { width: 200, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(C.muted)
    .text(order.invoiceNumber, W - M - 200, 74, { width: 200, align: 'right' })
    .text(`Issued ${dateText(order.updatedAt)}`, W - M - 200, 88, { width: 200, align: 'right' });
  const status = STATUS[order.status];
  doc.roundedRect(W - M - 110, 106, 110, 22, 11).fill(status === 'PAID' ? '#e7f4ea' : '#fef3c7');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(status === 'PAID' ? C.green : '#92400e').text(status, W - M - 110, 113, { width: 110, align: 'center', characterSpacing: 1.2 });

  // Seller and customer
  const top = 150;
  const col = (W - 2 * M) / 2;
  const block = (x, title, lines) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.green).text(title.toUpperCase(), x, top, { characterSpacing: 1.4 });
    let y = top + 16;
    lines.filter(Boolean).forEach((l, i) => {
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 12 : 10).fillColor(i === 0 ? C.ink : C.muted).text(l, x, y, { width: col - 16 });
      y += i === 0 ? 17 : 14;
    });
  };
  block(M, 'Sold by', [company.companyName, [company.address, company.city].filter(Boolean).join(', '), company.email, company.ntnCnic && `NTN / CNIC: ${company.ntnCnic}`, company.taxRegistrationNumber && `${company.taxLabel} registration: ${company.taxRegistrationNumber}`]);
  block(M + col, 'Billed to', [order.user.name, order.user.email, order.user.phone]);

  // Event
  let y = top + 108;
  doc.rect(M, y, W - 2 * M, 54).fill(C.greenDark);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text(order.event.name, M + 16, y + 12, { width: W - 2 * M - 32, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(10).fillColor('#c5d6ca').text(`${dateText(order.event.startsAt || order.event.date)} · ${order.event.venue}, ${order.event.city} · Booking #${order.id.slice(0, 8).toUpperCase()}`, M + 16, y + 32, { width: W - 2 * M - 32, lineBreak: false, ellipsis: true });
  y += 74;

  // Lines: one per ticket type
  const groups = {};
  for (const t of order.tickets) {
    const k = t.seat?.tier?.name || 'Ticket';
    groups[k] = groups[k] || { qty: 0, unit: Number(t.price), total: 0 };
    groups[k].qty += 1;
    groups[k].total += Number(t.price);
  }
  const cols = [M, M + 260, M + 330, W - M - 110];
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted);
  ['DESCRIPTION', 'QTY', 'UNIT PRICE', 'AMOUNT'].forEach((h, i) => doc.text(h, cols[i], y, { width: i === 3 ? 110 : 200, align: i === 3 ? 'right' : 'left', characterSpacing: 1.2 }));
  y += 16;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(1).stroke(C.line);
  y += 8;
  for (const [name, g] of Object.entries(groups)) {
    doc.font('Helvetica').fontSize(11).fillColor(C.ink).text(`${name} ticket`, cols[0], y, { width: 250 });
    doc.text(String(g.qty), cols[1], y).text(pkr(g.unit), cols[2], y);
    doc.text(pkr(g.total), cols[3], y, { width: 110, align: 'right' });
    y += 22;
  }
  doc.moveTo(M, y).lineTo(W - M, y).stroke(C.line);
  y += 12;

  // Totals (stored on the order when it was placed)
  const row = (label, value, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 11).fillColor(bold ? C.ink : C.muted).text(label, W - M - 300, y, { width: 180 });
    doc.fillColor(C.ink).text(value, W - M - 120, y, { width: 120, align: 'right' });
    y += bold ? 24 : 18;
  };
  row('Tickets', pkr(order.subtotalAmount ?? order.totalAmount));
  if (Number(order.discountAmount) > 0) row(`Discount${order.discountCode ? ` (${order.discountCode.code})` : ''}`, `− ${pkr(order.discountAmount)}`);
  if (Number(order.groupDiscountAmount) > 0) row('Group discount', `− ${pkr(order.groupDiscountAmount)}`);
  if (Number(order.serviceFeeAmount) > 0) row('Service fee', pkr(order.serviceFeeAmount));
  if (Number(order.taxAmount) > 0) row(`${company.taxLabel} (${Number(order.taxPercent)}%)`, pkr(order.taxAmount));
  doc.moveTo(W - M - 300, y).lineTo(W - M, y).stroke(C.ink);
  y += 8;
  row('Total paid', pkr(order.totalAmount), true);
  const refunded = order.refunds.reduce((n, r) => n + Number(r.amount), 0);
  if (refunded > 0) row('Refunded', `− ${pkr(refunded)}`);

  // Payment
  y += 10;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.green).text('PAYMENT', M, y, { characterSpacing: 1.4 });
  doc.font('Helvetica').fontSize(10).fillColor(C.muted)
    .text(`${METHOD[order.paymentMethod] || order.paymentMethod}${order.paymentTxId ? ` · reference ${order.paymentTxId}` : ''}`, M, y + 14, { width: W - 2 * M });

  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(
    'This invoice was generated by TicketLedger for a booking paid on ticketledger. Amounts are in Pakistani rupees. Keep it for your records; it is not a ticket and does not admit entry.',
    M, doc.page.height - 70, { width: W - 2 * M, align: 'center' },
  );
}

/** The invoice as a PDF buffer. */
export function invoicePdf(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice ${order.invoiceNumber}`, Author: 'TicketLedger' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawInvoice(doc, order);
    doc.end();
  });
}
