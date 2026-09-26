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

  // 3. Reject Booking without Active Lock
  await t.test('3. Rejection: Customer cannot initiate booking without holding an active Redis lock', async () => {
    const unreservedSeat = availableSeats[0];
    const res = await fetch(`${BASE_URL}/bookings/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        eventId,
        seatIds: [unreservedSeat.id],
        paymentMethod: 'STRIPE',
      }),
    });

    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.success, false);
    assert.match(data.message, /reservation lock.*expired or was not acquired/i);
  });

  // 4. Lock Seats and Initiate Booking with Stripe
  await t.test('4. Lock seat and initiate booking with Stripe payment intent', async () => {
    const seatToLock = availableSeats[0];

    // Lock seat
    const lockRes = await fetch(`${BASE_URL}/seats/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ seatId: seatToLock.id }),
    });
    assert.equal(lockRes.status, 200);

    // Initiate Booking
    const bookingRes = await fetch(`${BASE_URL}/bookings/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        eventId,
        seatIds: [seatToLock.id],
        paymentMethod: 'STRIPE',
      }),
    });

    const bookingData = await bookingRes.json();
    assert.equal(bookingRes.status, 201);
    assert.equal(bookingData.success, true);
    assert.ok(bookingData.data.orderId);
    assert.equal(bookingData.data.paymentMethod, 'STRIPE');
    assert.ok(bookingData.data.paymentParams.clientSecret);
    assert.equal(bookingData.data.currency, 'PKR');

    pendingOrderId = bookingData.data.orderId;
  });

  // 5. Cancel Booking and Verify Seats Restored
  await t.test('5. Cancel pending booking before payment and verify seats released', async () => {
    const cancelRes = await fetch(`${BASE_URL}/bookings/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ orderId: pendingOrderId }),
    });

    const cancelData = await cancelRes.json();
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelData.success, true);

    // Check seat is available again
    const seatRes = await fetch(`${BASE_URL}/seats/event/${eventId}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const seatData = await seatRes.json();
    const releasedSeat = seatData.data.seats.find((s) => s.id === availableSeats[0].id);
    assert.equal(releasedSeat.status, 'AVAILABLE');
  });

  // 6. Lock 2 Seats and Initiate Booking with JazzCash
  let jazzCashSeats = [];
  await t.test('6. Lock 2 seats and initiate booking with JazzCash payment challenge', async () => {
    jazzCashSeats = [availableSeats[1], availableSeats[2]];

    for (const s of jazzCashSeats) {
      const lockRes = await fetch(`${BASE_URL}/seats/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ seatId: s.id }),
      });
      assert.equal(lockRes.status, 200);
    }

    const bookingRes = await fetch(`${BASE_URL}/bookings/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        eventId,
        seatIds: jazzCashSeats.map((s) => s.id),
        paymentMethod: 'JAZZCASH',
        customerPhone: '03001234567',
      }),
    });

    const bookingData = await bookingRes.json();
    assert.equal(bookingRes.status, 201);
    assert.equal(bookingData.success, true);
    assert.equal(bookingData.data.paymentMethod, 'JAZZCASH');
    assert.ok(bookingData.data.paymentParams.ppTxnRefNo);
    assert.equal(bookingData.data.seats.length, 2);

    confirmedOrderId = bookingData.data.orderId;
  });

  // 7. Reject JazzCash Payment with Invalid OTP
  await t.test('7. Payment Verification: Reject JazzCash authorization with invalid OTP', async () => {
    const confirmRes = await fetch(`${BASE_URL}/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        orderId: confirmedOrderId,
        paymentDetails: {
          otpCode: '999', // Invalid length
        },
      }),
    });

    const confirmData = await confirmRes.json();
    assert.equal(confirmRes.status, 400);
    assert.equal(confirmData.success, false);
    assert.match(confirmData.message, /invalid jazzcash mpin/i);
  });

  // 8. Confirm JazzCash Payment Successfully
  await t.test('8. Payment Verification: Authorize payment with valid OTP and transition seats to SOLD', async () => {
    const confirmRes = await fetch(`${BASE_URL}/bookings/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        orderId: confirmedOrderId,
        paymentDetails: {
          otpCode: '123456',
          ppTxnRefNo: `JC_MOCK_${Date.now()}`,
        },
      }),
    });

    const confirmData = await confirmRes.json();
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmData.success, true);
    assert.equal(confirmData.data.order.status, 'SUCCESSFUL');
    assert.equal(confirmData.data.paymentReceipt.gateway, 'JAZZCASH');
    assert.ok(confirmData.data.paymentReceipt.transactionId);

    // Verify seats are now SOLD
    const seatRes = await fetch(`${BASE_URL}/seats/event/${eventId}`);
    const seatData = await seatRes.json();
    for (const bookedSeat of jazzCashSeats) {
      const currentSeat = seatData.data.seats.find((s) => s.id === bookedSeat.id);
      assert.equal(currentSeat.status, 'SOLD');
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
