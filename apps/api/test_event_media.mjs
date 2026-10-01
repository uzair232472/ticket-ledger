import assert from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import app from './src/app.js';
import prisma from './src/config/prisma.js';
import { inspectImage } from './src/utils/imageInspect.js';

// ---------- Real image files built in memory (no image library needed) ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** Valid RGB PNG; `noise` makes it incompressible (for size-limit tests). */
function png(width, height, { noise = false, rgb = [34, 197, 94] } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = noise ? crypto.randomBytes((1 + width * 3) * height) : Buffer.concat(Array.from({ length: height }, () => row));
  if (noise) for (let y = 0; y < height; y++) raw[y * (1 + width * 3)] = 0;
  const idat = zlib.deflateSync(raw, { level: noise ? 0 : 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const file = (buf, name, type = 'image/png') => new Blob([buf], { type });
const IMG = {
  banner: () => file(png(2400, 1080), 'banner.png'),
  card: () => file(png(1600, 1200), 'card.png'),
  wide: () => file(png(2400, 1200), 'wide.png'),
  square: (rgb) => file(png(1200, 1200, { rgb }), 'square.png'),
};

test('Organizer-managed event details & images', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const baseUrl = `${origin}/api`;

  const login = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password@123' }),
    });
    const body = await res.json();
    assert.ok(body.data?.token, `login failed for ${email}: ${body.message}`);
    return body.data.token;
  };

  // A second, approved organizer who does NOT own the test event
  const otherEmail = `media.other.${Date.now()}@ticketledger.pk`;
  const otherUser = await prisma.user.create({
    data: {
      name: 'Other Organizer',
      email: otherEmail,
      passwordHash: await bcrypt.hash('Password@123', 10),
      role: 'ORGANIZER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.company.create({
    data: {
      userId: otherUser.id,
      companyName: 'Other Promotions (media test)',
      ownerName: 'Other',
      phone: '03000000000',
      email: otherEmail,
      city: 'Lahore',
      ntnCnic: `NTN-${Date.now()}`,
      documentUrl: '/uploads/company_docs/media_test.pdf',
      status: 'APPROVED',
    },
  });

  const ownerToken = await login('organizer@ticketledger.pk');
  const adminToken = await login('admin@ticketledger.pk');
  const otherToken = await login(otherEmail);
  const customerToken = await login('customer@ticketledger.pk');
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const mediaDir = path.resolve('uploads', 'event_media');
  const filesBefore = new Set(fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []);
  const seededBefore = await prisma.event.findMany({ select: { id: true, bannerUrl: true, cardImageUrl: true }, orderBy: { id: 'asc' } });
  const createdIds = [];
  let eventId;

  const baseForm = () => {
    const f = new FormData();
    f.append('name', 'Media Test Night');
    f.append('description', 'An event created by the organizer media test suite.');
    f.append('type', 'MUSIC_CONCERT');
    f.append('date', '2027-03-20');
    f.append('time', '8:00 PM');
    f.append('city', 'Lahore');
    f.append('venue', 'Alhamra Arts Council');
    f.append('status', 'DRAFT');
    f.append('tiers', JSON.stringify([{ name: 'General', price: 2000, totalQuantity: 50 }]));
    return f;
  };
  const createWith = async (fill) => {
    const f = baseForm();
    fill?.(f);
    const res = await fetch(`${baseUrl}/events`, { method: 'POST', headers: auth(ownerToken), body: f });
    const body = await res.json();
    if (body.data?.event?.id) createdIds.push(body.data.event.id);
    return { res, body };
  };
  const put = async (token, fill) => {
    const f = new FormData();
    fill(f);
    const res = await fetch(`${baseUrl}/events/${eventId}`, { method: 'PUT', headers: auth(token), body: f });
    return { res, body: await res.json() };
  };
  const load = () => prisma.event.findUnique({ where: { id: eventId }, include: { galleryImages: { orderBy: { position: 'asc' } } } });

  try {
    await t.test('inspector reads real bytes, not names', () => {
      assert.deepStrictEqual(
        (({ format, width, height }) => ({ format, width, height }))(inspectImage(png(640, 480))),
        { format: 'png', width: 640, height: 480 }
      );
      // Minimal JPEG header: SOI, APP0, SOF0 (height 300, width 400)
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      assert.deepStrictEqual([inspectImage(jpeg).width, inspectImage(jpeg).height], [400, 300]);
      // WebP VP8X: canvas 1200 × 1200 stored as (n-1) 24-bit LE
      const webp = Buffer.alloc(30);
      webp.write('RIFF', 0);
      webp.write('WEBPVP8X', 8);
      webp.writeUIntLE(1199, 24, 3);
      webp.writeUIntLE(1199, 27, 3);
      assert.deepStrictEqual([inspectImage(webp).width, inspectImage(webp).height], [1200, 1200]);
      assert.strictEqual(inspectImage(Buffer.from('MZ not an image at all, just text pretending')), null);
    });

    await t.test('create with all images; gallery order is kept', async () => {
      const { res, body } = await createWith((f) => {
        f.append('banner', IMG.banner(), 'banner.png');
        f.append('cardImage', IMG.card(), 'card.png');
        f.append('galleryWide', IMG.wide(), 'wide.png');
        f.append('galleryImages', IMG.square([255, 0, 0]), 'g1.png');
        f.append('galleryImages', IMG.square([0, 255, 0]), 'g2.png');
        f.append('galleryImages', IMG.square([0, 0, 255]), 'g3.png');
      });
      assert.strictEqual(res.status, 201, body.message);
      const ev = body.data.event;
      eventId = ev.id;
      assert.match(ev.bannerUrl, /^(\/uploads\/event_media\/.+\.png|https:\/\/)/);
      assert.ok(ev.cardImageUrl && ev.galleryWideUrl);
      assert.deepStrictEqual(ev.galleryImages.map((g) => g.position), [0, 1, 2]);

      // Files are actually served
      if (ev.bannerUrl.startsWith('/uploads/')) {
        const img = await fetch(`${origin}${ev.bannerUrl}`);
        assert.strictEqual(img.status, 200);
        assert.strictEqual(img.headers.get('content-type'), 'image/png');
      }
    });

    await t.test('public event endpoint returns ordered gallery', async () => {
      const res = await fetch(`${baseUrl}/events/${eventId}`);
      const body = await res.json();
      assert.strictEqual(body.data.event.galleryImages.length, 3);
      assert.ok(body.data.event.cardImageUrl);
    });

    await t.test('create without images stores no stock banner', async () => {
      const { res, body } = await createWith();
      assert.strictEqual(res.status, 201, body.message);
      assert.strictEqual(body.data.event.bannerUrl, null);
      assert.strictEqual(body.data.event.cardImageUrl, null);
    });

    await t.test('JSON create (no files) still works, with an existing banner URL', async () => {
      const res = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: { ...auth(ownerToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Media Test JSON',
          description: 'Created through the JSON body as older clients do.',
          type: 'CRICKET_MATCH',
          date: '2027-04-01T14:00:00Z',
          time: '2:00 PM',
          city: 'Karachi',
          venue: 'National Stadium',
          status: 'DRAFT',
          bannerUrl: '/event-banners/psl-2026-final.png',
          tiers: [{ name: 'General', price: 1000, totalQuantity: 10 }],
        }),
      });
      const body = await res.json();
      if (body.data?.event?.id) createdIds.push(body.data.event.id);
      assert.strictEqual(res.status, 201, body.message);
      assert.strictEqual(body.data.event.bannerUrl, '/event-banners/psl-2026-final.png');
    });

    await t.test('invalid uploads are rejected with clear messages', async () => {
      const cases = [
        ['wrong ratio', (f) => f.append('cardImage', file(png(1600, 900)), 'c.png'), /4:3/],
        ['below minimum', (f) => f.append('cardImage', file(png(400, 300)), 'c.png'), /minimum/],
        ['fake PNG (text bytes)', (f) => f.append('banner', file(Buffer.from('hello, I am not an image'), 'x', 'image/png'), 'banner.png'), /not a valid JPEG, PNG or WebP/],
        ['over the size limit', (f) => f.append('banner', file(png(1700, 1700, { noise: true })), 'big.png'), /larger than|maximum/],
        ['too many gallery images', (f) => { for (let i = 0; i < 13; i++) f.append('galleryImages', IMG.square(), `g${i}.png`); }, /12/],
        ['blob: preview URL as banner', (f) => f.append('bannerUrl', 'blob:http://localhost:5173/abc'), /http\(s\) URL/],
      ];
      for (const [label, fill, message] of cases) {
        const { res, body } = await createWith(fill);
        assert.strictEqual(res.status, 400, `${label}: expected 400, got ${res.status} (${body.message})`);
        assert.match(body.message, message, label);
      }
    });

    await t.test('owner edits details, replaces banner, removes wide image, reorders gallery', async () => {
      const before = await load();
      const [g1, g2, g3] = before.galleryImages;
      const { res, body } = await put(ownerToken, (f) => {
        f.append('name', 'Media Test Night (Updated)');
        f.append('venue', 'Lahore Expo Centre');
        f.append('banner', IMG.banner(), 'banner2.png');
        f.append('galleryWideAction', 'remove');
        f.append('galleryImages', IMG.square([9, 9, 9]), 'new.png');
        // g3 first, new upload second, g1 third; g2 dropped
        f.append('galleryOrder', JSON.stringify([{ id: g3.id }, { upload: 0 }, { id: g1.id }]));
      });
      assert.strictEqual(res.status, 200, body.message);
      const after = await load();
      assert.strictEqual(after.name, 'Media Test Night (Updated)');
      assert.strictEqual(after.venue, 'Lahore Expo Centre');
      assert.strictEqual(after.description, before.description, 'untouched fields stay');
      assert.notStrictEqual(after.bannerUrl, before.bannerUrl);
      assert.strictEqual(after.cardImageUrl, before.cardImageUrl, 'kept image stays');
      assert.strictEqual(after.galleryWideUrl, null);
      assert.deepStrictEqual(after.galleryImages.map((g) => g.id).filter((id) => id !== after.galleryImages[1].id), [g3.id, g1.id]);
      assert.deepStrictEqual(after.galleryImages.map((g) => g.position), [0, 1, 2]);
      assert.ok(!after.galleryImages.some((g) => g.id === g2.id));
      // The previous banner file is left in place (pages cached with it keep working)
      if (before.bannerUrl.startsWith('/uploads/')) {
        assert.strictEqual((await fetch(`${origin}${before.bannerUrl}`)).status, 200);
      }
    });

    await t.test('a failed save changes nothing', async () => {
      const before = await load();
      const { res } = await put(ownerToken, (f) => {
        f.append('name', 'Should Not Be Saved');
        f.append('banner', IMG.banner(), 'ok.png');
        f.append('cardImage', file(png(1000, 1000)), 'bad-ratio.png');
        f.append('galleryOrder', JSON.stringify([]));
      });
      assert.strictEqual(res.status, 400);
      const after = await load();
      assert.strictEqual(after.name, before.name);
      assert.strictEqual(after.bannerUrl, before.bannerUrl);
      assert.strictEqual(after.galleryImages.length, before.galleryImages.length);
    });

    await t.test('gallery order cannot reference another event\'s images', async () => {
      const other = await prisma.eventGalleryImage.findFirst({ where: { NOT: { eventId } } });
      const foreignId = other?.id || crypto.randomUUID();
      const { res } = await put(ownerToken, (f) => f.append('galleryOrder', JSON.stringify([{ id: foreignId }])));
      assert.strictEqual(res.status, 400);
    });

    await t.test('ownership: other organizer, customer and guests cannot edit; admin can', async () => {
      assert.strictEqual((await put(otherToken, (f) => f.append('name', 'Hijacked'))).res.status, 403);
      assert.strictEqual((await fetch(`${baseUrl}/events/${eventId}/manage`, { headers: auth(otherToken) })).status, 403);
      assert.strictEqual((await put(customerToken, (f) => f.append('name', 'Hijacked'))).res.status, 403);
      const guest = await fetch(`${baseUrl}/events/${eventId}`, { method: 'PUT', body: new FormData() });
      assert.strictEqual(guest.status, 401);
      assert.notStrictEqual((await load()).name, 'Hijacked');

      const admin = await put(adminToken, (f) => f.append('description', 'Description updated by the Super Admin.'));
      assert.strictEqual(admin.res.status, 200, admin.body.message);
      assert.strictEqual((await fetch(`${baseUrl}/events/${eventId}/manage`, { headers: auth(ownerToken) })).status, 200);
    });

    await t.test('existing events keep their images', async () => {
      const seededAfter = await prisma.event.findMany({
        where: { id: { in: seededBefore.map((e) => e.id) } },
        select: { id: true, bannerUrl: true, cardImageUrl: true },
        orderBy: { id: 'asc' },
      });
      assert.deepStrictEqual(seededAfter, seededBefore);
    });
  } finally {
    // Remove everything this suite created (rows and local files)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: createdIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.company.deleteMany({ where: { userId: otherUser.id } });
    await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {});
    if (fs.existsSync(mediaDir)) {
      for (const name of fs.readdirSync(mediaDir)) if (!filesBefore.has(name)) fs.rmSync(path.join(mediaDir, name), { force: true });
    }
    server.close();
    await prisma.$disconnect();
  }
});
