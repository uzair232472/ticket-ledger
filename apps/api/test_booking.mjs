import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'http://localhost:5000/api';

test('MODULE 7 - Ticket Booking, Multi-Gateway Payment & Inventory Deduction Tests', async (t) => {
  let customerToken = null;
  let customerId = null;
  let eventId = null;
  let availableSeats = [];
  let pendingOrderId = null;
  let confirmedOrderId = null;

  // 1. Authenticate Customer
  await t.test('1. Authenticate Customer', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@ticketledger.pk',
        password: 'Password@123',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    customerToken = data.data.token;
    customerId = data.data.user.id;
    assert.ok(customerToken);
  });

  // 2. Fetch Event and Available Seats
  await t.test('2. Retrieve published event and identify available seats', async () => {
    const eventRes = await fetch(`${BASE_URL}/events?search=PSL`);
    const eventData = await eventRes.json();
    assert.equal(eventRes.status, 200);
    assert.ok(eventData.data.events.length > 0);
    eventId = eventData.data.events[0].id;

    // Fetch seat map
    const seatRes = await fetch(`${BASE_URL}/seats/event/${eventId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const seatData = await seatRes.json();
    assert.equal(seatRes.status, 200);

    availableSeats = seatData.data.seats.filter((s) => s.status === 'AVAILABLE');
    assert.ok(availableSeats.length >= 4, 'Should have at least 4 available seats');
  });

  const post = (path, body) => fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify(body),
  });
  const lock = async (seat) => assert.equal((await post('/seats/lock', { seatId: seat.id })).status, 200);

  // 3. Reject Booking without Active Lock
  await t.test('3. Rejection: Customer cannot initiate booking without holding an active Redis lock', async () => {
    const res = await post('/bookings/initiate', { eventId, seatIds: [availableSeats[0].id], paymentMethod: 'MOCK' });
    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.success, false);
    assert.match(data.message, /reservation lock.*expired or was not acquired/i);
  });

  // 4. Card payments fail closed without Stripe credentials (this environment has none)
  await t.test('4. Card payment without Stripe credentials is refused (fail-closed); a pending order is created with the test checkout', async () => {
    const seatToLock = availableSeats[0];
    await lock(seatToLock);
    const card = await post('/bookings/initiate', { eventId, seatIds: [seatToLock.id], paymentMethod: 'STRIPE' });
    const cardData = await card.json();
    assert.equal(card.status, 503);
    assert.equal(cardData.code, 'PAYMENT_PROVIDER_UNAVAILABLE');
    assert.ok(!cardData.data?.paymentParams, 'no simulated client secret is handed out');

    const bookingRes = await post('/bookings/initiate', { eventId, seatIds: [seatToLock.id], paymentMethod: 'MOCK' });
    const bookingData = await bookingRes.json();
    assert.equal(bookingRes.status, 201);
    assert.equal(bookingData.success, true);
    assert.ok(bookingData.data.orderId);
    assert.equal(bookingData.data.paymentMethod, 'MOCK');
    assert.equal(bookingData.data.currency, 'PKR');
    pendingOrderId = bookingData.data.orderId;
  });

  // 5. Cancel Booking and Verify Seats Restored
  await t.test('5. Cancel pending booking before payment and verify seats released', async () => {
    const cancelRes = await post('/bookings/cancel', { orderId: pendingOrderId });
    const cancelData = await cancelRes.json();
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelData.success, true);
    const seatRes = await fetch(`${BASE_URL}/seats/event/${eventId}`, { headers: { Authorization: `Bearer ${customerToken}` } });
    const seatData = await seatRes.json();
    const releasedSeat = seatData.data.seats.find((s) => s.id === availableSeats[0].id);
    assert.equal(releasedSeat.status, 'AVAILABLE');
  });

  // 6. JazzCash / EasyPaisa are future integrations: refused, never simulated
  let jazzCashSeats = [];
  await t.test('6. JazzCash and EasyPaisa are not available: refused before any order exists', async () => {
    jazzCashSeats = [availableSeats[1], availableSeats[2]];
    for (const s of jazzCashSeats) await lock(s);
    for (const paymentMethod of ['JAZZCASH', 'EASYPAISA']) {
      const res = await post('/bookings/initiate', { eventId, seatIds: jazzCashSeats.map((s) => s.id), paymentMethod, customerPhone: '03001234567' });
      const data = await res.json();
      assert.equal(res.status, 400, paymentMethod);
      assert.equal(data.code, 'PAYMENT_METHOD_UNAVAILABLE');
    }
    const bookingRes = await post('/bookings/initiate', { eventId, seatIds: jazzCashSeats.map((s) => s.id), paymentMethod: 'MOCK' });
    const bookingData = await bookingRes.json();
    assert.equal(bookingRes.status, 201);
    assert.equal(bookingData.data.seats.length, 2);
    confirmedOrderId = bookingData.data.orderId;
  });

  // 7. The checkout pages are told which methods can take a payment
  await t.test('7. Payment methods: card unavailable without Stripe credentials, wallets not integrated, test checkout development-only', async () => {
    const res = await fetch(`${BASE_URL}/payments/methods`);
    const { data } = await res.json();
    const m = Object.fromEntries(data.methods.map((x) => [x.method, x]));
    assert.equal(m.STRIPE.available, false);
    assert.equal(m.JAZZCASH.available, false);
    assert.equal(m.EASYPAISA.available, false);
    assert.deepEqual([m.MOCK.available, m.MOCK.test], [true, true]);
  });

  // 8. Confirm the test payment and transition seats to SOLD
  await t.test('8. Payment Verification: confirm the test payment and transition seats to SOLD', async () => {
    const confirmRes = await post('/bookings/confirm', { orderId: confirmedOrderId, paymentDetails: { paymentTxId: `MOCK_${Date.now()}` } });
    const confirmData = await confirmRes.json();
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmData.success, true);
    assert.equal(confirmData.data.order.status, 'SUCCESSFUL');
    assert.equal(confirmData.data.paymentReceipt.gateway, 'MOCK');
    assert.ok(confirmData.data.paymentReceipt.transactionId);
    const seatRes = await fetch(`${BASE_URL}/seats/event/${eventId}`);
    const seatData = await seatRes.json();
    for (const bookedSeat of jazzCashSeats) {
      assert.equal(seatData.data.seats.find((s) => s.id === bookedSeat.id).status, 'SOLD');
    }
  });

  // 9. Prevent Double-Booking on SOLD seats
  await t.test('9. Anti-Scalping: Attempting to lock or rebook now-SOLD seats is strictly rejected', async () => {
    const soldSeat = jazzCashSeats[0];
    const lockRes = await fetch(`${BASE_URL}/seats/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ seatId: soldSeat.id }),
    });

    const lockData = await lockRes.json();
    assert.equal(lockRes.status, 409);
    assert.match(lockData.message, /already been sold/i);
  });

  // 10. Fetch Customer Booking History & Receipt
  await t.test('10. Customer retrieves their booking history and specific order receipt', async () => {
    const myBookingsRes = await fetch(`${BASE_URL}/bookings/my-bookings`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const myBookingsData = await myBookingsRes.json();
    assert.equal(myBookingsRes.status, 200);
    assert.ok(myBookingsData.data.orders.length > 0);

    const targetOrder = myBookingsData.data.orders.find((o) => o.id === confirmedOrderId);
    assert.ok(targetOrder);
    assert.equal(targetOrder.status, 'SUCCESSFUL');
    assert.equal(targetOrder.tickets.length, 2);

    // Fetch individual receipt
    const singleRes = await fetch(`${BASE_URL}/bookings/${confirmedOrderId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const singleData = await singleRes.json();
    assert.equal(singleRes.status, 200);
    assert.equal(singleData.data.order.id, confirmedOrderId);
    assert.equal(singleData.data.order.tickets.length, 2);
  });
});
