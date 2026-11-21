// node scripts/db-fingerprint.mjs  (DATABASE_URL = the database). Read-only. Used before/after migrations:
// name|rows|md5 of every row's text, in sorted order (read-only)
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const tables = (await p.$queryRawUnsafe(`select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations' order by 1`)).map((r) => r.tablename);
for (const t of tables) {
  const [r] = await p.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x.r, E'\n' order by x.r)), 'empty') h from (select t::text r from "${t}" t) x`);
  console.log(`${t}|${r.n}|${r.h}`);
}
await p.$disconnect();
