import bcrypt from 'bcryptjs';
import prisma from './config/prisma.js';

export async function seedUsers() {
  console.log('🌱 Seeding demo users for TicketLedger...');

  const defaultPassword = 'Password@123';
  const salt = await bcrypt.genSalt(10);
  const commonPasswordHash = await bcrypt.hash(defaultPassword, salt);

  const demoUsers = [
    {
      name: 'Syed Hamza (Super Admin)',
      email: 'admin@ticketledger.pk',
      phone: '+923001234560',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      walletAddress: '0x1111111111111111111111111111111111111111',
      emailVerifiedAt: new Date(),
    },
    {
      name: 'Tariq Events Lahore (Organizer)',
      email: 'organizer@ticketledger.pk',
      phone: '+923001234561',
      role: 'ORGANIZER',
      status: 'ACTIVE',
      walletAddress: '0x2222222222222222222222222222222222222222',
      emailVerifiedAt: new Date(),
    },
    {
      name: 'Bilal Khan (Gaddafi Gate Staff)',
      email: 'staff@ticketledger.pk',
      phone: '+923001234562',
      role: 'GATE_STAFF',
      status: 'ACTIVE',
      walletAddress: '0x3333333333333333333333333333333333333333',
      emailVerifiedAt: new Date(),
    },
    {
      name: 'Ali Raza (Customer)',
      email: 'customer@ticketledger.pk',
      phone: '+923001234563',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      walletAddress: '0x71C84183F33d3419186661a47B7777174452aa82',
      emailVerifiedAt: new Date(),
    },
    {
      name: 'Kamran Frozen (Frozen Customer)',
      email: 'frozen@ticketledger.pk',
      phone: '+923001234564',
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      walletAddress: '0x4444444444444444444444444444444444444444',
      emailVerifiedAt: new Date(),
    },
    {
      name: 'Scalper Blacklisted (Blacklisted)',
      email: 'blacklisted@ticketledger.pk',
      phone: '+923001234565',
      role: 'CUSTOMER',
      status: 'BANNED',
      walletAddress: '0x5555555555555555555555555555555555555555',
      emailVerifiedAt: null,
    },
    {
      name: 'Fahad Sports & Music (Pending Org)',
      email: 'pending_organizer@ticketledger.pk',
      phone: '+923001234566',
      role: 'ORGANIZER',
      status: 'ACTIVE',
      walletAddress: '0x6666666666666666666666666666666666666666',
      emailVerifiedAt: new Date(),
    },
  ];

  for (const u of demoUsers) {
    const existing = await prisma.user.findUnique({
      where: { email: u.email },
    });

    if (existing) {
      await prisma.user.update({
        where: { email: u.email },
        data: {
          name: u.name,
          phone: u.phone,
          role: u.role,
          status: u.status,
          walletAddress: u.walletAddress,
          emailVerifiedAt: u.emailVerifiedAt,
          passwordHash: commonPasswordHash,
        },
      });
      console.log(`   Updated user: ${u.email} [${u.role} - ${u.status}]`);
    } else {
      await prisma.user.create({
        data: {
          ...u,
          passwordHash: commonPasswordHash,
        },
      });
      console.log(`   Created user: ${u.email} [${u.role} - ${u.status}]`);
    }
  }

  console.log('✅ Demo users seeded successfully!');
  console.log('   All accounts have default password: Password@123');

  // Seed Companies
  console.log('🌱 Seeding demo companies for organizers...');
  const org1 = await prisma.user.findUnique({ where: { email: 'organizer@ticketledger.pk' } });
  if (org1) {
    await prisma.company.upsert({
      where: { userId: org1.id },
      update: {
        companyName: 'PCB Events Management Lahore',
        ownerName: 'Tariq Mehmood',
        phone: '+923001234561',
        email: 'tariq@pcbevents.pk',
        city: 'Lahore',
        ntnCnic: '1234567-8',
        documentUrl: '/uploads/company_docs/pcb_events_ntn.pdf',
        status: 'APPROVED',
        reviewedBy: 'admin@ticketledger.pk',
        reviewedAt: new Date(),
      },
      create: {
        userId: org1.id,
        companyName: 'PCB Events Management Lahore',
        ownerName: 'Tariq Mehmood',
        phone: '+923001234561',
        email: 'tariq@pcbevents.pk',
        city: 'Lahore',
        ntnCnic: '1234567-8',
        documentUrl: '/uploads/company_docs/pcb_events_ntn.pdf',
        status: 'APPROVED',
        reviewedBy: 'admin@ticketledger.pk',
        reviewedAt: new Date(),
      },
    });
    console.log('   Created/Updated company: PCB Events Management Lahore [APPROVED]');
  }

  const org2 = await prisma.user.findUnique({ where: { email: 'pending_organizer@ticketledger.pk' } });
  if (org2) {
    await prisma.company.upsert({
      where: { userId: org2.id },
      update: {
        companyName: 'Karachi Kings Sports & Festivals',
        ownerName: 'Fahad Salman',
        phone: '+923001234566',
        email: 'info@karachikingsfest.pk',
        city: 'Karachi',
        ntnCnic: '42101-9876543-1',
        documentUrl: '/uploads/company_docs/karachi_kings_registration.pdf',
        status: 'PENDING',
      },
      create: {
        userId: org2.id,
        companyName: 'Karachi Kings Sports & Festivals',
        ownerName: 'Fahad Salman',
        phone: '+923001234566',
        email: 'info@karachikingsfest.pk',
        city: 'Karachi',
        ntnCnic: '42101-9876543-1',
        documentUrl: '/uploads/company_docs/karachi_kings_registration.pdf',
        status: 'PENDING',
      },
    });
    console.log('   Created/Updated company: Karachi Kings Sports & Festivals [PENDING]');
  }

  // Seed 3 Authentic Pakistani Events
  console.log('🌱 Seeding demo events and ticket tiers...');
  const approvedCompany = await prisma.company.findFirst({ where: { status: 'APPROVED' } });
  if (approvedCompany) {
    const demoEvents = [
      {
        name: 'Lahore Qalandars vs Karachi Kings - PSL 2026 Final',
        description: 'The monumental final match of the Pakistan Super League 2026. High-intensity rivalry featuring world-class international and Pakistani cricketers under floodlights at Gaddafi Stadium.',
        type: 'CRICKET_MATCH',
        status: 'PUBLISHED',
        date: new Date('2026-10-15T19:00:00Z'),
        time: '7:00 PM PST',
        city: 'Lahore',
        venue: 'Gaddafi Stadium, Ferozepur Road, Lahore',
        bannerUrl: '/event-banners/psl-2026-final.png',
        tiers: [
          { name: 'General Enclosure', price: 1500, totalQuantity: 1000 },
          { name: 'First Class Enclosure', price: 3500, totalQuantity: 500 },
          { name: 'VIP Imran Khan Enclosure', price: 8000, totalQuantity: 200 },
          { name: 'VVIP PCB Gallery', price: 15000, totalQuantity: 50 },
        ],
      },
      {
        name: 'Atif Aslam Live in Concert Lahore',
        description: 'An unforgettable musical evening with Pakistan’s biggest global music icon, Atif Aslam. Experience breathtaking acoustic arrangements, soul-stirring melodies, and legendary anthems.',
        type: 'MUSIC_CONCERT',
        status: 'PUBLISHED',
        date: new Date('2026-10-25T20:00:00Z'),
        time: '8:00 PM PST',
        city: 'Lahore',
        venue: 'Alhamra Open Air Theatre, Cultural Complex, Lahore',
        bannerUrl: '/event-banners/live-in-concert.png',
        tiers: [
          { name: 'Silver Pass', price: 3000, totalQuantity: 600 },
          { name: 'Gold Front Row', price: 6000, totalQuantity: 300 },
          { name: 'Platinum Fan Pit VIP', price: 12000, totalQuantity: 100 },
        ],
      },
      {
        name: 'Karachi Sufi & Qawwali Music Festival 2026',
        description: 'A grand celebration of mystic poetry, rich Sufi heritage, and transcendental Qawwali performances featuring celebrated maestros from all four provinces of Pakistan.',
        type: 'MUSIC_FESTIVAL',
        status: 'PUBLISHED',
        date: new Date('2026-11-05T18:30:00Z'),
        time: '6:30 PM PST',
        city: 'Karachi',
        venue: 'Arts Council of Pakistan, M.R. Kiyani Road, Karachi',
        bannerUrl: '/event-banners/qawwali-night.png',
        tiers: [
          { name: 'Standard Festival Pass', price: 2500, totalQuantity: 800 },
          { name: 'Executive Sufi Lounge', price: 5500, totalQuantity: 250 },
        ],
      },
    ];

    for (const ev of demoEvents) {
      const existingEv = await prisma.event.findFirst({
        where: { name: ev.name, companyId: approvedCompany.id },
      });

      if (!existingEv) {
        const created = await prisma.event.create({
          data: {
            companyId: approvedCompany.id,
            name: ev.name,
            description: ev.description,
            type: ev.type,
            status: ev.status,
            date: ev.date,
            time: ev.time,
            city: ev.city,
            venue: ev.venue,
            bannerUrl: ev.bannerUrl,
          },
        });

        for (const t of ev.tiers) {
          await prisma.ticketTier.create({
            data: {
              eventId: created.id,
              name: t.name,
              price: t.price,
              totalQuantity: t.totalQuantity,
              availableQuantity: t.totalQuantity,
            },
          });
        }
        console.log(`   Created event: ${ev.name} with ${ev.tiers.length} tiers`);
      } else {
        console.log(`   Event exists: ${ev.name}`);
      }
    }

    // Seed Stadium & Venue Seats
    console.log('🌱 Seeding interactive stadium seat maps...');
    const allEvents = await prisma.event.findMany({ include: { tiers: true } });

    for (const ev of allEvents) {
      for (const tier of ev.tiers) {
        // Create 2 rows with 10 seats each per tier
        for (let r = 1; r <= 2; r++) {
          const rowLetter = String.fromCharCode(64 + r); // A, B
          for (let s = 1; s <= 10; s++) {
            const seatNumber = `${s}`;

            // Make seat 3 in Row A SOLD, seat 5 in Row A BLOCKED for demo variety
            let status = 'AVAILABLE';
            if (r === 1 && s === 3) status = 'SOLD';
            if (r === 1 && s === 5) status = 'BLOCKED';

            await prisma.seat.upsert({
              where: {
                eventId_section_row_seatNumber: {
                  eventId: ev.id,
                  section: tier.name,
                  row: rowLetter,
                  seatNumber,
                },
              },
              update: { tierId: tier.id },
              create: {
                eventId: ev.id,
                section: tier.name,
                row: rowLetter,
                seatNumber,
                tierId: tier.id,
                status,
              },
            });
          }
        }
      }
      console.log(`   Generated seat map for: ${ev.name}`);
    }
  }
}

// Run standalone if executed directly
if (process.argv[1]?.endsWith('seed.js')) {
  seedUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
