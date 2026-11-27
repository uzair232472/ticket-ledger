/**
 * Registers the models listed in the ML service's registry.json as SHADOW models.
 *
 *   node scripts/ml-register-models.mjs [path/to/registry.json]
 *   (default: ../ml-service/models/v0/registry.json, or $ML_ARTIFACT_DIR/registry.json)
 *
 * - Never sets ACTIVE or READY: registration only ever creates SHADOW rows. No promotion path exists yet.
 * - A newer artifact for the same model retires the previous SHADOW row (kept for the record).
 * - Re-running with the same registry changes nothing.
 * - Rollback: `--restore` re-activates (as SHADOW, never more) a previously registered artifact that was retired,
 *   retiring the current SHADOW model of that name. Without --restore a retired artifact stays retired.
 *
 *   node scripts/ml-register-models.mjs <registry.json> [--restore]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../src/config/prisma.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
  || (process.env.ML_ARTIFACT_DIR ? path.join(process.env.ML_ARTIFACT_DIR, 'registry.json') : path.join(here, '../../ml-service/models/v0/registry.json'));

export async function registerModels(registry, { restore = false } = {}) {
  const results = [];
  for (const m of registry.models) {
    const existing = await prisma.mlModel.findUnique({ where: { name_sha256: { name: m.name, sha256: m.sha256 } } });
    if (existing && restore && existing.status === 'RETIRED') {
      await prisma.$transaction(async (tx) => {
        await tx.mlModel.updateMany({ where: { name: m.name, status: 'SHADOW' }, data: { status: 'RETIRED', retiredAt: new Date() } });
        await tx.mlModel.update({ where: { id: existing.id }, data: { status: 'SHADOW', retiredAt: null, mayServeDecisions: false } });
      });
      results.push({ name: m.name, action: 'restored', status: 'SHADOW' });
      continue;
    }
    if (existing) {
      results.push({ name: m.name, action: 'unchanged', status: existing.status });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.mlModel.updateMany({ where: { name: m.name, status: 'SHADOW' }, data: { status: 'RETIRED', retiredAt: new Date() } });
      await tx.mlModel.create({
        data: {
          name: m.name, version: m.version, sha256: m.sha256, file: m.file, source: m.source,
          status: 'SHADOW', mayServeDecisions: false, // shadow registration never serves decisions
          evaluationStatus: m.evaluation_status, evaluation: m.evaluation, features: m.features, shadowDecision: m.shadow_decision ?? undefined,
        },
      });
    });
    results.push({ name: m.name, action: 'registered', status: 'SHADOW' });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  registerModels(registry, { restore: process.argv.includes('--restore') })
    .then((r) => { console.table(r); })
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
