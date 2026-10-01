/**
 * Creates (or promotes) a Super Admin account. Super Admins can never be created through the API.
 *
 * Usage (from apps/api):
 *   ADMIN_PASSWORD='...' node scripts/create-super-admin.mjs --email admin@example.com --name "Jane Admin"
 *
 * The password is read from the ADMIN_PASSWORD env variable so it does not end up in shell history.
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
const password = process.env.ADMIN_PASSWORD;

if (!email || !name || !password) {
  console.error('Usage: ADMIN_PASSWORD=... node scripts/create-super-admin.mjs --email <email> --name "<full name>"');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error('ADMIN_PASSWORD must be at least 8 characters with at least 1 letter and 1 number.');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date(), companyId: null },
    create: { email, name, passwordHash, role: 'SUPER_ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  // A changed password must end any existing sessions
  await prisma.refreshToken.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
  console.log(`Super Admin ready: ${admin.email}`);
} catch (error) {
  console.error('Failed to create Super Admin:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
