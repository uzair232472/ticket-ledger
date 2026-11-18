/**
 * Gate device authentication rollout flag.
 *
 *   GATE_DEVICE_AUTH=enforce  every scanner request (scan, sync, pack, heartbeat) needs a server-issued device token
 *   GATE_DEVICE_AUTH=warn     migration: enrolled devices must use their token; devices that never enrolled still
 *                             work with their device id, and every such request is counted on the device
 *                             (legacyRequests) so supervisors can see who hasn't moved over yet
 *   GATE_DEVICE_AUTH=off      emergency rollback: tokens are ignored (a device id is still required, and revoked
 *                             devices are still refused)
 *
 * GATE_DEVICE_AUTH_DEADLINE (ISO date) ends the migration: from then on `warn` and `off` behave as `enforce`, so the
 * unauthenticated path can't stay open by accident. An unknown value means `enforce`.
 * Env is read per call (ES module imports run before dotenv.config(), and tests switch modes).
 */
export const DEFAULT_DEVICE_AUTH_DEADLINE = '2026-12-31T23:59:59Z';
const MODES = ['off', 'warn', 'enforce'];

export function deviceAuthDeadline() {
  const d = new Date(process.env.GATE_DEVICE_AUTH_DEADLINE || DEFAULT_DEVICE_AUTH_DEADLINE);
  return Number.isNaN(d.getTime()) ? new Date(DEFAULT_DEVICE_AUTH_DEADLINE) : d;
}

/** The mode in force now: 'off' | 'warn' | 'enforce'. */
export function deviceAuthMode(now = new Date()) {
  const raw = String(process.env.GATE_DEVICE_AUTH || 'warn').trim().toLowerCase();
  const mode = MODES.includes(raw) ? raw : 'enforce';
  if (mode !== 'enforce' && now >= deviceAuthDeadline()) return 'enforce';
  return mode;
}

export const deviceAuthStatus = (now = new Date()) => {
  const configured = String(process.env.GATE_DEVICE_AUTH || 'warn').trim().toLowerCase();
  return { mode: deviceAuthMode(now), configured, deadline: deviceAuthDeadline().toISOString() };
};
