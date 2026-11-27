import { useEffect, useState } from 'react';
import api from '../utils/api';

/**
 * Which payment methods the server can take a payment with right now (GET /api/payments/methods):
 * { STRIPE: { available, test, reason }, ... }, or null while loading. The server enforces the same rules;
 * this only keeps unavailable methods from being offered. On an error nothing is offered as available.
 */
export default function usePaymentMethods() {
  const [methods, setMethods] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/payments/methods')
      .then((r) => { if (alive) setMethods(Object.fromEntries((r.data?.data?.methods || []).map((m) => [m.method, m]))); })
      .catch(() => { if (alive) setMethods({}); });
    return () => { alive = false; };
  }, []);
  return methods;
}

/** The first available method of `order` (null when none is). */
export const firstAvailable = (methods, order) => order.find((m) => methods?.[m]?.available) || null;
