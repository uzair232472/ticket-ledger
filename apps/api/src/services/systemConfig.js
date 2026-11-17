import prisma from '../config/prisma.js';

/*
 * System settings that admins change from the console (no deploy). Each has a default, a type and limits; values
 * are cached for 30 seconds. Code reads them with getSetting(key).
 */

export const SETTINGS = {
  platformFeePercent: { label: 'Platform fee (% of ticket sales)', type: 'number', min: 0, max: 30, default: 5, confirm: true },
  supportFirstResponseHours: { label: 'Support: escalate if no answer within (hours)', type: 'number', min: 1, max: 168, default: 24 },
  supportReplyHours: { label: 'Support: escalate if a customer reply waits (hours)', type: 'number', min: 1, max: 336, default: 48 },
  recoveryCooldownDays: { label: 'Abandoned-checkout reminders: at most one per customer and event every (days)', type: 'number', min: 1, max: 60, default: 7 },
  organizerRegistrationOpen: { label: 'New organizers can register', type: 'boolean', default: true, confirm: true },
  siteBanner: { label: 'Site-wide banner', type: 'banner', default: { active: false, message: '', tone: 'info' } },
};

let cache = null;
let cachedAt = 0;
const TTL = 30 * 1000;

async function all() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const rows = await prisma.systemSetting.findMany();
  cache = Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, rows.find((r) => r.key === k)?.value ?? d.default]));
  cachedAt = Date.now();
  return cache;
}
export const invalidateConfig = () => {
  cache = null;
};
export async function getSetting(key) {
  return (await all())[key];
}
export async function getAllSettings() {
  const values = await all();
  const rows = await prisma.systemSetting.findMany({ select: { key: true, updatedAt: true, updatedById: true } });
  return Object.entries(SETTINGS).map(([key, d]) => ({ key, label: d.label, type: d.type, min: d.min, max: d.max, default: d.default, confirm: Boolean(d.confirm), value: values[key], updatedAt: rows.find((r) => r.key === key)?.updatedAt || null }));
}

/** Checks a new value against the setting's type and limits; returns the cleaned value. */
export function cleanValue(key, value) {
  const d = SETTINGS[key];
  if (!d) throw Object.assign(new Error('Unknown setting.'), { status: 404 });
  if (d.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < d.min || n > d.max) throw Object.assign(new Error(`${d.label} must be ${d.min}–${d.max}.`), { status: 400 });
    return n;
  }
  if (d.type === 'boolean') return Boolean(value);
  if (d.type === 'banner') {
    const v = value || {};
    const message = String(v.message || '').trim().slice(0, 300);
    if (v.active && !message) throw Object.assign(new Error('Write the banner message.'), { status: 400 });
    return { active: Boolean(v.active), message, tone: ['info', 'warn', 'bad'].includes(v.tone) ? v.tone : 'info' };
  }
  return value;
}

export async function setSetting(key, value, adminId, db = prisma) {
  await db.systemSetting.upsert({ where: { key }, update: { value, updatedById: adminId }, create: { key, value, updatedById: adminId } });
  invalidateConfig();
}

/** What every visitor's browser needs (no sign-in). */
export async function publicConfig() {
  const v = await all();
  return { banner: v.siteBanner?.active ? v.siteBanner : null, organizerRegistrationOpen: v.organizerRegistrationOpen };
}
