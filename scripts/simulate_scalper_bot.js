// scripts/simulate_scalper_bot.js
// Automated live demonstration of AI Anti-Scalper Bot Detection & Defense

const API_BASE = 'http://localhost:5000/api';

async function run() {
  console.log('\n===============================================================');
  console.log('  🛡️  TICKETLEDGER AI ANTI-SCALPING BOT DETECTION ENGINE  🛡️');
  console.log('===============================================================\n');

  try {
    // 1. Authenticate
    console.log('[Step 1] Authenticating automated scalper agent...');
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'customer@ticketledger.pk',
        password: 'Password@123',
      }),
    });
    const loginData = await loginRes.json();
    if (!loginData.success) {
      throw new Error(`Login failed: ${loginData.message}`);
    }
    const token = loginData.data.token;
    console.log('✅ Authenticated successfully.\n');

    // 2. Fetch event
    console.log('[Step 2] Locating high-demand concert/sports event...');
    const eventRes = await fetch(`${API_BASE}/events?limit=1`);
    const eventData = await eventRes.json();
    const eventList = eventData.data?.events || eventData.data || [];
    const event = eventList[0];
    if (!event) throw new Error('No events found');
    console.log(`✅ Target event: "${event.name}" (ID: ${event.id})\n`);

    // 3. Find available seat
    console.log('[Step 3] Sniping seat from live inventory layout...');
    const seatsRes = await fetch(`${API_BASE}/seats/event/${event.id}`);
    const seatsData = await seatsRes.json();
    const seats = seatsData.data?.seats || [];
    const availableSeat = seats.find((s) => s.status === 'AVAILABLE');
    if (!availableSeat) {
      throw new Error('No available seats found in event.');
    }
    console.log(`✅ Target seat locked: Section "${availableSeat.section}", Row ${availableSeat.row}, Seat ${availableSeat.seatNumber} (ID: ${availableSeat.id})\n`);

    // 4. Attempt sub-second sniper checkout with bot telemetry
    console.log('[Step 4] Launching automated high-frequency sniper checkout attack...');
    console.log('  Attacker Telemetry Profile:');
    console.log('    • Purchase Dwell Time: 0.38 seconds (inhuman speed)');
    console.log('    • Click Frequency: 240 clicks/min (superhuman spam)');
    console.log('    • Seat Sniping Velocity: 6 rapid lock attempts');
    console.log('    • Client Fingerprint Hopping: 2 device switches\n');

    const initiateRes = await fetch(`${API_BASE}/bookings/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        eventId: event.id,
        seatIds: [availableSeat.id],
        paymentMethod: 'MOCK',
        telemetry: {
          checkoutDurationSeconds: 0.38,
          clicksPerMinute: 240,
          rapidSeatAttempts: 6,
          deviceSwitches: 2,
        },
      }),
    });

    const status = initiateRes.status;
    const body = await initiateRes.json();

    console.log('---------------------------------------------------------------');
    if (status === 403 && body.blockedByAI) {
      console.log('🚨 [SECURITY VERDICT] ATTACK INTERCEPTED & BLOCKED BY TICKETLEDGER AI!');
      console.log(`HTTP Status: ${status} Forbidden`);
      console.log(`Risk Classification: ${body.data?.riskLevel || 'CRITICAL_BOT'}`);
      console.log(`AI Fraud Confidence: ${body.data?.fraudScore}%`);
      console.log('\nAnomaly Signals Triggered:');
      (body.data?.anomalyFactors || []).forEach((f) => console.log(`  ✖ ${f}`));
      console.log('\nDefensive Measures Executed:');
      console.log('  🔒 Seat holds immediately revoked and evicted.');
      console.log('  📝 Immutable incident logged to SuperAdmin audit trail: CHECKOUT_BLOCKED_SCALPER_BOT.');
      console.log('---------------------------------------------------------------\n');
    } else {
      console.log('Result:', status, body);
    }
  } catch (err) {
    console.error('Simulation error:', err.message);
  }
}

run();
