import React, { useState } from 'react';
import { FileText, Lock, Paperclip, Send } from 'lucide-react';
import { API_URL } from '../../lib/session';
import './support.css';

/*
 * A support ticket's conversation: customer and agent messages, system history lines (status, assignment,
 * escalation) and attachments, then the reply box. Agents also see internal notes (yellow) and can write them.
 */

const when = (v) => new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const isImage = (a) => a.mimeType?.startsWith('image/');
// Attachment links are signed API paths (private files): open them on the API's origin
const fileUrl = (u) => (u?.startsWith('/api/') ? `${API_URL}${u}` : u);

export function StatusPill({ status, label }) {
  return <span className="tl-sp-pill" data-s={status}>{label || String(status).replace(/_/g, ' ').toLowerCase()}</span>;
}

/** viewer: 'customer' | 'agent' | 'organizer' (`agent` kept for older callers). */
export function Thread({ messages, agent, viewer = agent ? 'agent' : 'customer' }) {
  const label = (m) => {
    if (m.authorType === 'AGENT') return `${m.author?.name || 'Support'} · TicketLedger support`;
    if (m.authorType === 'ORGANIZER') return `${m.author?.name ? `${m.author.name} · ` : ''}${m.organization || 'Organizer'} (event organizer)`;
    return viewer === 'customer' ? 'You' : `${m.author?.name || 'Customer'} (customer)`;
  };
  return (
    <div className="tl-sp-thread">
      {messages.map((m) => (m.authorType === 'SYSTEM' ? (
        <p key={m.id} className="tl-sp-system">{m.body} <span>· {when(m.createdAt)}</span>{viewer === 'agent' && m.internal && <span> · <Lock className="w-3 h-3 inline" aria-hidden="true" /> staff only</span>}</p>
      ) : (
        <article key={m.id} className={`tl-sp-msg${m.authorType === 'AGENT' ? ' is-agent' : ''}${m.authorType === 'ORGANIZER' ? ' is-org' : ''}${m.internal ? ' is-internal' : ''}`}>
          <header>
            <span>
              <strong>{label(m)}</strong>
              {m.internal && <> · <Lock className="w-3 h-3 inline" aria-hidden="true" /> Internal note</>}
            </span>
            <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
          </header>
          <p>{m.body}</p>
          {m.attachments?.length > 0 && (
            <div className="tl-sp-files">
              {m.attachments.map((a) => (
                <a key={a.id} href={fileUrl(a.url)} target="_blank" rel="noreferrer" title={a.fileName}>
                  {isImage(a) ? <img src={fileUrl(a.url)} alt={a.fileName} /> : <><FileText className="w-4 h-4" aria-hidden="true" /> {a.fileName}</>}
                </a>
              ))}
            </div>
          )}
        </article>
      )))}
    </div>
  );
}

/** Reply box. `onSend(formData)` returns a promise; agents get "internal note" and a next status. */
export function ReplyBox({ agent, disabled, disabledText, onSend, maxFiles = 5 }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  if (disabled) return <p className="tl-sp-empty" style={{ marginTop: 18 }}>{disabledText}</p>;
  const send = async (e) => {
    e.preventDefault();
    if (body.trim().length < 2) return;
    const fd = new FormData();
    fd.append('body', body.trim());
    if (agent && internal) fd.append('internal', 'true');
    if (agent && !internal && status) fd.append('status', status);
    files.slice(0, maxFiles).forEach((f) => fd.append('attachments', f));
    setBusy(true);
    const ok = await onSend(fd);
    setBusy(false);
    if (ok) {
      setBody('');
      setFiles([]);
      setStatus('');
      setKey((k) => k + 1);
    }
  };
  return (
    <form className="tl-sp-reply" onSubmit={send}>
      <label className="sr-only" htmlFor="sp-reply">Your reply</label>
      <textarea id="sp-reply" placeholder={internal ? 'Internal note — only support staff can see this' : 'Write a reply…'} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      <div className="tl-sp-reply-row">
        <label className="text-sm inline-flex items-center gap-2">
          <Paperclip className="w-4 h-4" aria-hidden="true" />
          <input key={key} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFiles([...(e.target.files || [])])} aria-label="Attach screenshots or PDFs" />
        </label>
        {agent && (
          <span className="flex flex-wrap gap-3 items-center text-sm">
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>
            {!internal && (
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status after the reply" className="tl-dash-select">
                <option value="">Then: waiting on customer</option>
                <option value="IN_PROGRESS">Then: in progress</option>
                <option value="RESOLVED">Then: resolved</option>
              </select>
            )}
          </span>
        )}
        <button type="submit" className="tl-info-btn is-primary" disabled={busy || body.trim().length < 2}><Send className="w-4 h-4" aria-hidden="true" /> {busy ? 'Sending…' : internal ? 'Add note' : 'Send reply'}</button>
      </div>
      {files.length > maxFiles && <p className="tl-sp-notice is-bad">Only the first {maxFiles} files are sent.</p>}
    </form>
  );
}
