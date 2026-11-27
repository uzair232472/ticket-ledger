import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../utils/api';

/** The admins' site-wide banner (System settings), on every page until the visitor closes it. */
export default function SiteBanner() {
  const [banner, setBanner] = useState(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem('tl_banner_closed') || '';
    } catch {
      return '';
    }
  });
  useEffect(() => { api.get('/site-config').then((r) => setBanner(r.data.data.banner)).catch(() => {}); }, []);
  if (!banner?.message || hidden === banner.message) return null;
  const colors = { info: ['#e0f2fe', '#075985'], warn: ['#fef3c7', '#92400e'], bad: ['#fee2e2', '#991b1b'] }[banner.tone] || ['#e0f2fe', '#075985'];
  return (
    <div role="status" style={{ background: colors[0], color: colors[1], padding: '8px 16px', fontSize: 14, fontWeight: 600, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <span>{banner.message}</span>
      <button type="button" aria-label="Close" onClick={() => { setHidden(banner.message); try { sessionStorage.setItem('tl_banner_closed', banner.message); } catch { /* ignore */ } }} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}><X className="w-4 h-4" /></button>
    </div>
  );
}
