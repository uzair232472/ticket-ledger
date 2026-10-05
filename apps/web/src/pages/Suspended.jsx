import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldOff, Mail } from 'lucide-react';

import { SUPPORT_EMAIL } from '../lib/site';

export default function Suspended() {
  return (
    <div className="max-w-lg mx-auto my-12 sm:my-20 px-4">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
          <ShieldOff className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900">Account suspended</h1>
        <p className="text-sm text-slate-600">Your account has been suspended. Contact support.</p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex items-center gap-2 text-sm font-bold text-[#16a34a] hover:underline"
        >
          <Mail className="w-4 h-4" /> {SUPPORT_EMAIL}
        </a>
        <div className="pt-4 border-t border-slate-100">
          <Link to="/" className="text-xs text-slate-500 hover:text-slate-800">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
