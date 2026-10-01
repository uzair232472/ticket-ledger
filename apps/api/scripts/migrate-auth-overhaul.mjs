/**
 * One-off migration for the Login & Signup overhaul (Oct 2026).
 *
 * The project uses `prisma db push`, which cannot rename enum values or move data on its own, so this
 * script runs in three idempotent phases:
 *   1. Pre-push SQL: rename AccountStatus values (FROZEN -> SUSPENDED, BLACKLISTED -> BANNED), add the new
 *      values, and copy User.isVerified into the new emailVerifiedAt column.
 *   2. `prisma db push --accept-data-loss`: creates OtpCode, RefreshToken, StaffInvite and
 *      StaffEventAssignment, adds User.companyId, and drops the old isVerified / otpCode / otpExpiresAt columns
 *      (their data was carried over in phase 1; pending OTP codes are short-lived and simply re-requested).
 *   3. Post-push SQL: unverified ACTIVE users become PENDING_VERIFICATION, and each organizer's companyId is
 *      set to the company they own.
 *
 * Usage (from apps/api, with the API server stopped):
 *   node scripts/migrate-auth-overhaul.mjs && npx prisma generate
 */
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

const columnExists = async (table, column) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    table,
    column
  );
  return rows.length > 0;
};

const enumHasValue = async (enumName, value) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 AND e.enumlabel = $2`,
    enumName,
    value
  );
  return rows.length > 0;
};

async function prePush() {
  console.log('Phase 1: enum values and emailVerifiedAt');

  const renames = [['FROZEN', 'SUSPENDED'], ['BLACKLISTED', 'BANNED']];
  for (const [from, to] of renames) {
    if ((await enumHasValue('AccountStatus', from)) && !(await enumHasValue('AccountStatus', to))) {
      await prisma.$executeRawUnsafe(`ALTER TYPE "AccountStatus" RENAME VALUE '${from}' TO '${to}'`);
      console.log(`  renamed AccountStatus.${from} -> ${to}`);
    }
  }
  // ADD VALUE cannot run inside a transaction block; each $executeRawUnsafe call autocommits
  for (const value of ['PENDING_VERIFICATION', 'DEACTIVATED']) {
    if (!(await enumHasValue('AccountStatus', value))) {
      await prisma.$executeRawUnsafe(`ALTER TYPE "AccountStatus" ADD VALUE '${value}'`);
      console.log(`  added AccountStatus.${value}`);
    }
  }

  if (!(await columnExists('User', 'emailVerifiedAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3)`);
    console.log('  added User.emailVerifiedAt');
  }
  if (await columnExists('User', 'isVerified')) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt") WHERE "isVerified" = true`
    );
    console.log(`  backfilled emailVerifiedAt for ${n} verified users`);
  }
}

function push() {
  console.log('Phase 2: prisma db push');
  // `prisma generate` is run separately afterwards: on Windows this process holds the query engine DLL open
  execSync('npx prisma db push --accept-data-loss --skip-generate', { stdio: 'inherit' });
}

async function postPush() {
  console.log('Phase 3: statuses and company links');
  const pending = await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "status" = 'PENDING_VERIFICATION' WHERE "status" = 'ACTIVE' AND "emailVerifiedAt" IS NULL`
  );
  console.log(`  ${pending} unverified users set to PENDING_VERIFICATION`);

  const linked = await prisma.$executeRawUnsafe(
    `UPDATE "User" u SET "companyId" = c."id" FROM "Company" c WHERE c."userId" = u."id" AND u."companyId" IS NULL`
  );
  console.log(`  ${linked} organizers linked to their company`);
}

try {
  await prePush();
  await prisma.$disconnect();
  push();
  await postPush();
  console.log('Done.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
