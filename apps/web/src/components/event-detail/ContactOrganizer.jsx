import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Mail, MessageSquare } from 'lucide-react';

/**
 * "Contact organizer" button with a small menu: email the organizer (opens the mail app with the event name
 * as the subject) or copy the address. The address is the event's own contact email, else the organizer's.
 */
export default function ContactOrganizer({ email, eventName, organizer }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!email) return null;
  const mailto = `mailto:${email}?subject=${encodeURIComponent(`Question about ${eventName}`)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the address is shown in the menu */
    }
  };

  return (
    <div className="tl-dt-contact" ref={rootRef}>
      <button type="button" className="tl-dt-contact-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)}>
        <MessageSquare className="w-4 h-4" aria-hidden="true" /> Contact organizer
      </button>
      {open && (
        <div className="tl-dt-contact-pop" role="menu" aria-label="Contact the organizer">
          <p className="tl-dt-contact-who">
            <span>{organizer || 'Organizer'}</span>
            <strong>{email}</strong>
          </p>
          <a role="menuitem" href={mailto} className="tl-dt-contact-item" onClick={() => setOpen(false)}>
            <Mail className="w-4 h-4" aria-hidden="true" /> Email the organizer
          </a>
          <button type="button" role="menuitem" className="tl-dt-contact-item" onClick={copy}>
            {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy email address'}
          </button>
        </div>
      )}
    </div>
  );
}
