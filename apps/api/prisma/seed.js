import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { publishAllLayouts } from '../seed_venue_layouts.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting TicketLedger Database Seeding...');

  const passwordHash = await bcrypt.hash('Password@123', 10);

  // -------------------------------------------------------------
  // 1. Super Admin
  // -------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ticketledger.pk' },
    update: { passwordHash, status: 'ACTIVE', role: 'SUPER_ADMIN' },
    create: {
      email: 'admin@ticketledger.pk',
      name: 'TicketLedger Super Admin',
      phone: '+923001112233',
      passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      walletAddress: '0x1111111111111111111111111111111111111111',
      city: 'Islamabad',
      emailVerifiedAt: new Date(),
    },
  });
  console.log('✓ Super Admin seeded:', admin.email);

  // -------------------------------------------------------------
  // 2. Approved Organizer
  // -------------------------------------------------------------
  const approvedOrgUser = await prisma.user.upsert({
    where: { email: 'organizer@ticketledger.pk' },
    update: { passwordHash, status: 'ACTIVE', role: 'ORGANIZER' },
    create: {
      email: 'organizer@ticketledger.pk',
      name: 'PCB Events Official',
      phone: '+923004445566',
      passwordHash,
      role: 'ORGANIZER',
      status: 'ACTIVE',
      walletAddress: '0x2222222222222222222222222222222222222222',
      city: 'Lahore',
      emailVerifiedAt: new Date(),
    },
  });

  const approvedCompany = await prisma.company.upsert({
    where: { userId: approvedOrgUser.id },
    update: { status: 'APPROVED' },
    create: {
      userId: approvedOrgUser.id,
      companyName: 'Pakistan Cricket Board & Entertainment Ltd',
      ownerName: 'Wasim Khan',
      phone: '+923004445566',
      email: 'pcb.events@ticketledger.pk',
      city: 'Lahore',
      ntnCnic: '9876543-2',
      documentUrl: '/uploads/company_docs/pcb_ntn_verified.pdf',
      status: 'APPROVED',
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    },
  });
  console.log('✓ Approved Organizer & Company seeded:', approvedCompany.companyName);

  // -------------------------------------------------------------
  // 3. Pending Organizer
  // -------------------------------------------------------------
  const pendingOrgUser = await prisma.user.upsert({
    where: { email: 'pending.organizer@ticketledger.pk' },
    update: { passwordHash, status: 'ACTIVE', role: 'ORGANIZER' },
    create: {
      email: 'pending.organizer@ticketledger.pk',
      name: 'Lahore Live Entertainment',
      phone: '+923007778899',
      passwordHash,
      role: 'ORGANIZER',
      status: 'ACTIVE',
      walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      city: 'Lahore',
      emailVerifiedAt: new Date(),
    },
  });

  const pendingCompany = await prisma.company.upsert({
    where: { userId: pendingOrgUser.id },
    update: { status: 'PENDING' },
    create: {
      userId: pendingOrgUser.id,
      companyName: 'Lahore Sufi & Rock Promotions',
      ownerName: 'Ali Raza',
      phone: '+923007778899',
      email: 'lahore.live@ticketledger.pk',
      city: 'Lahore',
      ntnCnic: '1234567-8',
      documentUrl: '/uploads/company_docs/lahore_live_ntn.pdf',
      status: 'PENDING',
    },
  });
  console.log('✓ Pending Organizer seeded:', pendingCompany.companyName);

  const pendingOrgUserUnderscore = await prisma.user.upsert({
    where: { email: 'pending_organizer@ticketledger.pk' },
    update: { passwordHash, status: 'ACTIVE', role: 'ORGANIZER' },
    create: {
      email: 'pending_organizer@ticketledger.pk',
      name: 'Lahore Live Entertainment',
      phone: '+923007778890',
      passwordHash,
      role: 'ORGANIZER',
      status: 'ACTIVE',
      walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
      city: 'Lahore',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.company.upsert({
    where: { userId: pendingOrgUserUnderscore.id },
    update: { status: 'PENDING', companyName: 'Karachi Kings Sports & Festivals' },
    create: {
      userId: pendingOrgUserUnderscore.id,
      companyName: 'Karachi Kings Sports & Festivals',
      ownerName: 'Ali Raza',
      phone: '+923007778890',
      email: 'lahore.live.pending@ticketledger.pk',
      city: 'Lahore',
      ntnCnic: '1234567-9',
      documentUrl: '/uploads/company_docs/lahore_live_ntn.pdf',
      status: 'PENDING',
    },
  });

  // -------------------------------------------------------------
  // 4. Gate Staff
  // -------------------------------------------------------------
  const gateStaff = await prisma.user.upsert({
    where: { email: 'staff@ticketledger.pk' },
    update: { passwordHash, status: 'ACTIVE', role: 'GATE_STAFF' },
    create: {
      email: 'staff@ticketledger.pk',
      name: 'Gaddafi Gate Attendant',
      phone: '+923215556677',
      passwordHash,
      role: 'GATE_STAFF',
      status: 'ACTIVE',
      walletAddress: '0x3333333333333333333333333333333333333333',
      city: 'Lahore',
      emailVerifiedAt: new Date(),
    },
  });
  console.log('✓ Gate Staff seeded:', gateStaff.email);

  // -------------------------------------------------------------
  // 5. Five Registered Customers
  // -------------------------------------------------------------
  const customersData = [
    {
      email: 'customer@ticketledger.pk',
      name: 'Hamza Khan',
      phone: '+923011112233',
      city: 'Lahore',
      walletAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    {
      email: 'customer2@ticketledger.pk',
      name: 'Ayesha Tariq',
      phone: '+923022223344',
      city: 'Karachi',
      walletAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
    },
    {
      email: 'customer3@ticketledger.pk',
      name: 'Bilal Ahmed',
      phone: '+923033334455',
      city: 'Rawalpindi',
      walletAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
    },
    {
      email: 'customer4@ticketledger.pk',
      name: 'Zainab Fatima',
      phone: '+923044445566',
      city: 'Islamabad',
      walletAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
    {
      email: 'customer5@ticketledger.pk',
      name: 'Usman Ali',
      phone: '+923055556677',
      city: 'Multan',
      walletAddress: '0xffffffffffffffffffffffffffffffffffffffff',
    },
  ];

  const customers = [];
  for (const c of customersData) {
    const cust = await prisma.user.upsert({
      where: { email: c.email },
      update: { passwordHash, status: 'ACTIVE', role: 'CUSTOMER', walletAddress: c.walletAddress },
      create: {
        email: c.email,
        name: c.name,
        phone: c.phone,
        passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        walletAddress: c.walletAddress,
        city: c.city,
        emailVerifiedAt: new Date(),
      },
    });
    customers.push(cust);
  }
  console.log(`✓ 5 Customers seeded (${customers.map((c) => c.email).join(', ')})`);

  // -------------------------------------------------------------
  // 6. Fraud-like Bot User (Flagged with 92/100 ML score)
  // -------------------------------------------------------------
  const fraudUser = await prisma.user.upsert({
    where: { email: 'scalper.bot@proxyfarm.com' },
    update: { passwordHash, status: 'SUSPENDED', role: 'CUSTOMER' },
    create: {
      email: 'scalper.bot@proxyfarm.com',
      name: 'Scalper Bot Ring Alpha',
      phone: '+923999999999',
      passwordHash,
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      city: 'Karachi',
      walletAddress: '0x9999999999999999999999999999999999999999',
      emailVerifiedAt: null,
    },
  });
  console.log('✓ Fraud-like Bot User seeded (Status: SUSPENDED):', fraudUser.email);

  await prisma.user.upsert({
    where: { email: 'frozen@ticketledger.pk' },
    update: { passwordHash, status: 'SUSPENDED', role: 'CUSTOMER' },
    create: {
      email: 'frozen@ticketledger.pk',
      name: 'Frozen Test User',
      phone: '+923999999998',
      passwordHash,
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      city: 'Lahore',
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.user.upsert({
    where: { email: 'blacklisted@ticketledger.pk' },
    update: { passwordHash, status: 'BANNED', role: 'CUSTOMER' },
    create: {
      email: 'blacklisted@ticketledger.pk',
      name: 'Blacklisted Test User',
      phone: '+923999999997',
      passwordHash,
      role: 'CUSTOMER',
      status: 'BANNED',
      city: 'Karachi',
      emailVerifiedAt: new Date(),
    },
  });

  // -------------------------------------------------------------
  // 7. Abandoned Checkout User (Ready for 1-Click Recovery)
  // -------------------------------------------------------------
  const abandonedUser = await prisma.user.upsert({
    where: { email: 'omer.abandoned@gmail.com' },
    update: { passwordHash, status: 'ACTIVE', role: 'CUSTOMER' },
    create: {
      email: 'omer.abandoned@gmail.com',
      name: 'Omer Farooq',
      phone: '+923331234567',
      passwordHash,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      city: 'Lahore',
      walletAddress: '0x8888888888888888888888888888888888888888',
      emailVerifiedAt: new Date(),
    },
  });
  console.log('✓ Abandoned Checkout User seeded:', abandonedUser.email);

  // -------------------------------------------------------------
  // 8. Three Pakistani Events
  // -------------------------------------------------------------
  const now = new Date();

  // Event 1: PSL Match
  let pslEvent = await prisma.event.findFirst({
    where: { name: 'PSL 10 Final: Lahore Qalandars vs Karachi Kings' },
  });
  if (!pslEvent) {
    const pslDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    pslEvent = await prisma.event.create({
      data: {
        companyId: approvedCompany.id,
        name: 'PSL 10 Final: Lahore Qalandars vs Karachi Kings',
        description: 'The monumental grand final of Pakistan Super League season 10 under the floodlights of Gaddafi Stadium.',
        type: 'CRICKET_MATCH',
        status: 'PUBLISHED',
        date: pslDate,
        time: '19:30',
        city: 'Lahore',
        venue: 'Gaddafi Stadium, Ferozepur Road',
        bannerUrl: '/event-banners/psl-2026-final.png',
      },
    });
  }

  // Tiers for PSL Event
  let pslTiers = await prisma.ticketTier.findMany({ where: { eventId: pslEvent.id } });
  if (pslTiers.length === 0) {
    pslTiers = await Promise.all([
      prisma.ticketTier.create({
        data: {
          eventId: pslEvent.id,
          name: 'VIP Imran Khan Enclosure',
          price: 5000,
          totalQuantity: 200,
          availableQuantity: 196,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: pslEvent.id,
          name: 'Fazal Mahmood Pavilion',
          price: 3000,
          totalQuantity: 500,
          availableQuantity: 497,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: pslEvent.id,
          name: 'First Class Enclosure',
          price: 1500,
          totalQuantity: 1000,
          availableQuantity: 1000,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: pslEvent.id,
          name: 'General Stand (Wasim Akram)',
          price: 800,
          totalQuantity: 2500,
          availableQuantity: 2500,
        },
      }),
    ]);
  }

  // Event 2: Lahore Concert (Atif Aslam)
  let concertEvent = await prisma.event.findFirst({
    where: { name: 'Atif Aslam Live in Concert — Soul of Lahore' },
  });
  if (!concertEvent) {
    const concertDate = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
    concertEvent = await prisma.event.create({
      data: {
        companyId: approvedCompany.id,
        name: 'Atif Aslam Live in Concert — Soul of Lahore',
        description: 'An unforgettable evening of soulful sufi rock and iconic Pakistani melodies at Alhamra Open Air.',
        type: 'MUSIC_CONCERT',
        status: 'PUBLISHED',
        date: concertDate,
        time: '20:00',
        city: 'Lahore',
        venue: 'Alhamra Arts Council Open Air, The Mall',
        bannerUrl: '/event-banners/live-in-concert.png',
      },
    });

    await Promise.all([
      prisma.ticketTier.create({
        data: {
          eventId: concertEvent.id,
          name: 'Diamond Lounge (Front Row)',
          price: 8000,
          totalQuantity: 100,
          availableQuantity: 100,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: concertEvent.id,
          name: 'Gold Enclosure',
          price: 4500,
          totalQuantity: 300,
          availableQuantity: 300,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: concertEvent.id,
          name: 'Silver Enclosure',
          price: 2000,
          totalQuantity: 600,
          availableQuantity: 600,
        },
      }),
    ]);
  }

  // Event 3: Karachi Music Festival
  let festEvent = await prisma.event.findFirst({
    where: { name: 'Karachi Winter Music Festival 2026' },
  });
  if (!festEvent) {
    const festDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    festEvent = await prisma.event.create({
      data: {
        companyId: approvedCompany.id,
        name: 'Karachi Winter Music Festival 2026',
        description: 'A 2-day multi-artist beachside music extravaganza featuring pop, electronic, and folk performances.',
        type: 'MUSIC_FESTIVAL',
        status: 'PUBLISHED',
        date: festDate,
        time: '18:00',
        city: 'Karachi',
        venue: 'Beach View Park, Clifton Block 4',
        bannerUrl: '/event-banners/qawwali-night.png',
      },
    });

    await Promise.all([
      prisma.ticketTier.create({
        data: {
          eventId: festEvent.id,
          name: 'All Access VIP Pass',
          price: 10000,
          totalQuantity: 150,
          availableQuantity: 150,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: festEvent.id,
          name: 'Premium Fan Pit',
          price: 6000,
          totalQuantity: 400,
          availableQuantity: 400,
        },
      }),
      prisma.ticketTier.create({
        data: {
          eventId: festEvent.id,
          name: 'General Arena',
          price: 2500,
          totalQuantity: 1200,
          availableQuantity: 1200,
        },
      }),
    ]);
  }

  // Link organizers and gate staff to their company, and assign the demo gate staff to the approved company's events
  await prisma.user.update({ where: { id: approvedOrgUser.id }, data: { companyId: approvedCompany.id } });
  await prisma.user.update({ where: { id: pendingOrgUser.id }, data: { companyId: pendingCompany.id } });
  await prisma.user.update({ where: { id: gateStaff.id }, data: { companyId: approvedCompany.id } });
  for (const ev of [pslEvent, concertEvent, festEvent]) {
    if (ev.companyId !== approvedCompany.id) continue;
    await prisma.staffEventAssignment.upsert({
      where: { staffId_eventId: { staffId: gateStaff.id, eventId: ev.id } },
      update: {},
      create: { staffId: gateStaff.id, eventId: ev.id, assignedById: approvedOrgUser.id },
    });
  }
  console.log('✓ Gate staff assigned to', approvedCompany.companyName, 'events');

  console.log('✓ 3 Pakistani Events & Tiers seeded:');
  console.log(`  1. ${pslEvent.name} (${pslEvent.city})`);
  console.log(`  2. ${concertEvent.name} (${concertEvent.city})`);
  console.log(`  3. ${festEvent.name} (${festEvent.city})`);

  // -------------------------------------------------------------
  // 9. Seats Generation for PSL Event
  // -------------------------------------------------------------
  const existingSeats = await prisma.seat.findMany({ where: { eventId: pslEvent.id } });
  let createdSeats = existingSeats;

  if (existingSeats.length === 0) {
    const vipTier = pslTiers[0];
    const pavTier = pslTiers[1];
    const seatsToInsert = [];

    // VIP Row A, B, C (6 seats each)
    for (let r = 1; r <= 3; r++) {
      const rowChar = String.fromCharCode(64 + r);
      for (let s = 1; s <= 6; s++) {
        seatsToInsert.push({
          eventId: pslEvent.id,
          tierId: vipTier.id,
          section: 'VIP_ENCLOSURE',
          row: rowChar,
          seatNumber: `${s}`,
          status: 'AVAILABLE',
        });
      }
    }

    // Pavilion Row G, H (6 seats each)
    for (let r = 1; r <= 2; r++) {
      const rowChar = String.fromCharCode(70 + r);
      for (let s = 1; s <= 6; s++) {
        seatsToInsert.push({
          eventId: pslEvent.id,
          tierId: pavTier.id,
          section: 'PAVILION',
          row: rowChar,
          seatNumber: `${s}`,
          status: 'AVAILABLE',
        });
      }
    }

    createdSeats = [];
    for (const s of seatsToInsert) {
      const seat = await prisma.seat.create({ data: s });
      createdSeats.push(seat);
    }
  }
  console.log(`✓ ${createdSeats.length} Seats verified for ${pslEvent.name}`);

  // -------------------------------------------------------------
  // 10. Completed Orders & Active NFT Tickets
  // -------------------------------------------------------------
  const hamza = customers[0];
  const ayesha = customers[1];
  const bilal = customers[2];

  let order1 = await prisma.order.findFirst({ where: { userId: hamza.id, eventId: pslEvent.id } });
  let ticket1 = null;
  if (!order1) {
    const seat1 = createdSeats[0];
    await prisma.seat.update({ where: { id: seat1.id }, data: { status: 'SOLD' } });
    order1 = await prisma.order.create({
      data: {
        userId: hamza.id,
        eventId: pslEvent.id,
        totalAmount: 5000,
        status: 'SUCCESSFUL',
        paymentMethod: 'JAZZCASH',
        paymentTxId: 'JC_TXN_9823412093',
      },
    });

    ticket1 = await prisma.ticket.create({
      data: {
        orderId: order1.id,
        eventId: pslEvent.id,
        seatId: seat1.id,
        userId: hamza.id,
        price: 5000,
        status: 'ACTIVE',
        tokenId: 101,
        txHash: '0xabc123789fed4560000000000000000000000000000000000000000000000101',
        contractAddress: '0x62957777413D3ebB340d87fa06E982F72d34F234',
        ownerWallet: hamza.walletAddress,
        qrNonce: 'qr_nonce_hamza_101',
        qrSignature: 'sig_hmac_hamza_psl_final_valid',
        qrVersion: 1,
      },
    });
  }

  let order2 = await prisma.order.findFirst({ where: { userId: ayesha.id, eventId: pslEvent.id } });
  let ticket2 = null;
  if (!order2) {
    const seat2 = createdSeats[1];
    await prisma.seat.update({ where: { id: seat2.id }, data: { status: 'SOLD' } });
    order2 = await prisma.order.create({
      data: {
        userId: ayesha.id,
        eventId: pslEvent.id,
        totalAmount: 5000,
        status: 'SUCCESSFUL',
        paymentMethod: 'EASYPAISA',
        paymentTxId: 'EP_TXN_783419024',
      },
    });

    ticket2 = await prisma.ticket.create({
      data: {
        orderId: order2.id,
        eventId: pslEvent.id,
        seatId: seat2.id,
        userId: ayesha.id,
        price: 5000,
        status: 'ACTIVE',
        tokenId: 102,
        txHash: '0xdef456123abc7890000000000000000000000000000000000000000000000102',
        contractAddress: '0x62957777413D3ebB340d87fa06E982F72d34F234',
        ownerWallet: ayesha.walletAddress,
        qrNonce: 'qr_nonce_ayesha_102',
        qrSignature: 'sig_hmac_ayesha_psl_final_valid',
        qrVersion: 1,
      },
    });
  } else {
    ticket2 = await prisma.ticket.findFirst({ where: { orderId: order2.id } });
  }

  let order3 = await prisma.order.findFirst({ where: { userId: bilal.id, eventId: pslEvent.id } });
  let ticket3 = null;
  if (!order3) {
    const seat3 = createdSeats[2];
    await prisma.seat.update({ where: { id: seat3.id }, data: { status: 'SOLD' } });
    order3 = await prisma.order.create({
      data: {
        userId: bilal.id,
        eventId: pslEvent.id,
        totalAmount: 3000,
        status: 'SUCCESSFUL',
        paymentMethod: 'STRIPE',
        paymentTxId: 'pi_3MtwxAE2eZvKYlo2Czzs2v9T',
      },
    });

    ticket3 = await prisma.ticket.create({
      data: {
        orderId: order3.id,
        eventId: pslEvent.id,
        seatId: seat3.id,
        userId: bilal.id,
        price: 3000,
        status: 'SCANNED',
        tokenId: 103,
        txHash: '0x999456123abc7890000000000000000000000000000000000000000000000103',
        contractAddress: '0x62957777413D3ebB340d87fa06E982F72d34F234',
        ownerWallet: bilal.walletAddress,
        qrNonce: 'qr_nonce_bilal_103',
        qrSignature: 'sig_hmac_bilal_psl_scanned',
        qrVersion: 1,
      },
    });
  } else {
    ticket3 = await prisma.ticket.findFirst({ where: { orderId: order3.id } });
  }
  console.log('✓ Orders & Polygon Amoy NFT Tickets verified');

  // -------------------------------------------------------------
  // 11. Gate Scan Logs (Valid Scan & Duplicate Scan Flag)
  // -------------------------------------------------------------
  if (ticket3) {
    const existingScans = await prisma.gateScan.count({ where: { ticketId: ticket3.id } });
    if (existingScans === 0) {
      await prisma.gateScan.create({
        data: {
          ticketId: ticket3.id,
          staffId: gateStaff.id,
          result: 'VALID_FIRST_SCAN',
          gateNumber: 'Gate 4 (Imran Khan Enclosure)',
          notes: 'Turnstile admitted attendee smoothly on first validation',
        },
      });

      await prisma.gateScan.create({
        data: {
          ticketId: ticket3.id,
          staffId: gateStaff.id,
          result: 'ALREADY_SCANNED',
          gateNumber: 'Gate 4 (Imran Khan Enclosure)',
          notes: 'Second entry attempt with duplicate QR token intercepted and rejected',
        },
      });
      console.log('✓ Gate scan logs seeded');
    }
  }

  // -------------------------------------------------------------
  // 12. P2P Resale Marketplace Listing (Capped at <= 110%)
  // -------------------------------------------------------------
  if (ticket2) {
    const existingListing = await prisma.resaleListing.findFirst({ where: { ticketId: ticket2.id } });
    if (!existingListing) {
      const listing = await prisma.resaleListing.create({
        data: {
          ticketId: ticket2.id,
          sellerId: ayesha.id,
          originalPrice: 5000,
          resalePrice: 5500,
          maxResalePrice: 5500,
          status: 'ACTIVE',
        },
      });
      console.log('✓ P2P Resale Listing seeded:', listing.id, '(PKR 5,500 <= 110% cap)');
    }
  }

  // -------------------------------------------------------------
  // 13. Telemetry for Abandoned Checkout User (Omer Farooq)
  // -------------------------------------------------------------
  const existingAbandoned = await prisma.behaviorEvent.findFirst({
    where: { userId: abandonedUser.id, action: 'checkout_abandoned' },
  });
  if (!existingAbandoned) {
    const abandonedSession = 'sess_omer_farooq_dropoff_123';
    await prisma.behaviorEvent.createMany({
      data: [
        {
          userId: abandonedUser.id,
          sessionId: abandonedSession,
          action: 'event_view',
          eventId: pslEvent.id,
          metadata: { source: 'social_instagram', city: 'Lahore' },
          createdAt: new Date(now.getTime() - 25 * 60 * 1000),
        },
        {
          userId: abandonedUser.id,
          sessionId: abandonedSession,
          action: 'seat_selected',
          eventId: pslEvent.id,
          metadata: { seatId: createdSeats[3]?.id || 'seat_sample', section: 'VIP_ENCLOSURE' },
          createdAt: new Date(now.getTime() - 20 * 60 * 1000),
        },
        {
          userId: abandonedUser.id,
          sessionId: abandonedSession,
          action: 'checkout_started',
          eventId: pslEvent.id,
          metadata: { cartValue: 7500, tierName: 'VIP Enclosure' },
          createdAt: new Date(now.getTime() - 15 * 60 * 1000),
        },
        {
          userId: abandonedUser.id,
          sessionId: abandonedSession,
          action: 'checkout_abandoned',
          eventId: pslEvent.id,
          metadata: { reason: 'payment_hesitation', cartValue: 7500 },
          createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      ],
    });
    console.log('✓ Abandoned checkout clickstream telemetry seeded for Omer Farooq');
  }

  // -------------------------------------------------------------
  // 14. Telemetry for Fraud Bot User (Scalper Bot Ring Alpha)
  // -------------------------------------------------------------
  const existingBotFlag = await prisma.behaviorEvent.findFirst({
    where: { userId: fraudUser.id, action: 'bot_risk_flagged' },
  });
  if (!existingBotFlag) {
    const botSession = 'sess_scalper_bot_proxy_999';
    await prisma.behaviorEvent.createMany({
      data: [
        {
          userId: fraudUser.id,
          sessionId: botSession,
          action: 'bot_risk_flagged',
          eventId: pslEvent.id,
          metadata: {
            fraudScore: 92,
            isBot: true,
            anomalyFactors: ['Clicks exceeded 120/min', 'Rapid seat locking across multiple tabs', 'Proxy IP rotation detected'],
            ip: '103.255.4.19',
          },
          createdAt: new Date(now.getTime() - 5 * 60 * 1000),
        },
        {
          userId: fraudUser.id,
          sessionId: botSession,
          action: 'rapid_clicks',
          eventId: pslEvent.id,
          metadata: { clickRate: 145, durationSeconds: 8 },
          createdAt: new Date(now.getTime() - 4 * 60 * 1000),
        },
      ],
    });
    console.log('✓ Fraud telemetry & bot alerts seeded for Scalper Bot Ring Alpha');
  }

  // -------------------------------------------------------------
  // 15. Initial Audit Logs
  // -------------------------------------------------------------
  const existingAudit = await prisma.auditLog.findFirst({ where: { action: 'SYSTEM_INITIALIZED' } });
  if (!existingAudit) {
    await prisma.auditLog.createMany({
      data: [
        {
          userId: admin.id,
          action: 'SYSTEM_INITIALIZED',
          targetType: 'System',
          targetId: 'INIT_2026',
          details: { version: 'Phase 2 FYP', modulesCount: 20 },
        },
        {
          userId: admin.id,
          action: 'COMPANY_APPROVED',
          targetType: 'Company',
          targetId: approvedCompany.id,
          details: { companyName: approvedCompany.companyName, ntn: approvedCompany.ntnCnic },
        },
        {
          userId: admin.id,
          action: 'USER_SUSPENDED',
          targetType: 'User',
          targetId: fraudUser.id,
          details: { reason: 'Automated anti-scalp bot interception' },
        },
      ],
    });
    console.log('✓ Initial security audit logs seeded');
  }

  await publishAllLayouts();

  console.log('\n🎉 TicketLedger Database Seeding Completed Successfully!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
