import assert from 'node:assert/strict';
import test from 'node:test';

const { eventTiming, entryRefusal, moveRefusal } = await import('./src/services/eventTiming.js');
const { ticketStates } = await import('./src/services/ticketStatus.js');
const prisma = (await import('./src/config/prisma.js')).default;
test.after(() => prisma.$disconnect());

// An event on 10 Jan 2027, 19:00-22:00 Pakistan time (14:00-17:00 UTC)
const ev = { id: 'e', name: 'Concert', status: 'PUBLISHED', startsAt: new Date('2027-01-10T14:00:00Z'), endsAt: new Date('2027-01-10T17:00:00Z') };
const at = (iso) => new Date(iso);

test('phases: upcoming, doors open (6 h before), live, ended', () => {
  assert.equal(eventTiming(ev, at('2027-01-09T12:00:00Z')).phase, 'UPCOMING');
  assert.equal(eventTiming(ev, at('2027-01-10T09:00:00Z')).phase, 'DOORS_OPEN');
  assert.equal(eventTiming(ev, at('2027-01-10T15:00:00Z')).phase, 'LIVE');
  assert.equal(eventTiming(ev, at('2027-01-10T17:00:00Z')).phase, 'ENDED');
  assert.equal(eventTiming({ ...ev, status: 'COMPLETED' }, at('2027-01-10T15:00:00Z')).phase, 'ENDED');
});

test('gate entry: refused after the end and before the gates open, allowed in between', () => {
  assert.equal(entryRefusal(ev, at('2027-01-11T10:00:00Z')).code, 'EVENT_ENDED');
  assert.equal(entryRefusal(ev, at('2027-01-09T10:00:00Z')).code, 'TOO_EARLY');
  assert.equal(entryRefusal(ev, at('2027-01-10T13:30:00Z')), null);
  assert.equal(entryRefusal(ev, at('2027-01-10T16:59:00Z')), null);
});

test('no end time stored: the event lasts 3 hours from its date and time', () => {
  const legacy = { id: 'l', name: 'Old', status: 'PUBLISHED', date: new Date('2026-10-25T00:00:00Z'), time: '19:00' };
  assert.equal(eventTiming(legacy, at('2026-10-25T16:59:00Z')).phase, 'LIVE');   // 21:59 PKT
  assert.equal(eventTiming(legacy, at('2026-10-25T17:01:00Z')).phase, 'ENDED');  // 22:01 PKT
  assert.equal(entryRefusal(legacy, at('2026-11-23T10:00:00Z')).code, 'EVENT_ENDED');
});

test('transfer / resale: only before the start; never for ended or cancelled events', () => {
  assert.equal(moveRefusal(ev, 'transferred', at('2027-01-10T13:59:00Z')), null);
  assert.match(moveRefusal(ev, 'transferred', at('2027-01-10T14:01:00Z')), /already started/);
  assert.match(moveRefusal(ev, 'resold', at('2027-01-12T00:00:00Z')), /has ended/);
  assert.match(moveRefusal({ ...ev, status: 'CANCELLED' }, 'resold', at('2027-01-01T00:00:00Z')), /cancelled/);
});

test('ticket states: an unused ticket of an ended event is EXPIRED and cannot be moved', () => {
  const past = { ...ev, startsAt: new Date('2020-01-10T14:00:00Z'), endsAt: new Date('2020-01-10T17:00:00Z') };
  const s = ticketStates({ status: 'ACTIVE', event: past }, { status: 'SUCCESSFUL' });
  assert.equal(s.entry.status, 'EXPIRED');
  assert.equal(s.entry.valid, false);
  assert.equal(s.actions.canTransfer, false);
  assert.equal(s.actions.canResell, false);
  const future = ticketStates({ status: 'ACTIVE', event: { ...ev, startsAt: new Date(Date.now() + 864e5 * 30), endsAt: new Date(Date.now() + 864e5 * 30 + 3 * 36e5) } }, { status: 'SUCCESSFUL' });
  assert.equal(future.entry.status, 'VALID');
  assert.equal(future.actions.canTransfer, true);
});
