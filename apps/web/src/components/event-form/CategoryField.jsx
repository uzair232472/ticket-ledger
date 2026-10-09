import React, { useEffect, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import api from '../../utils/api';

const ADD = '__add__';

/**
 * Event category: the fixed TicketLedger categories, plus categories organizers have added. When none fits,
 * "Add a new category…" creates one (shared with other organizers, never added to the fixed list); a name
 * that matches a fixed category is refused with a one-click switch to it.
 *
 * value: { type, customCategoryId }; onChange gets the same shape.
 */
export default function CategoryField({ id, value, onChange, error }) {
  const [categories, setCategories] = useState({ predefined: [], custom: [] });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [addError, setAddError] = useState(null); // { message, predefinedType? }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get('/events/categories')
      .then((res) => alive && setCategories(res.data.data))
      .catch(() => alive && setCategories((prev) => prev));
    return () => {
      alive = false;
    };
  }, []);

  const selected = value.type === 'OTHER' ? `custom:${value.customCategoryId || ''}` : value.type;

  const pick = (e) => {
    const v = e.target.value;
    if (v === ADD) {
      setAdding(true);
      setAddError(null);
      return;
    }
    setAdding(false);
    if (v.startsWith('custom:')) onChange({ type: 'OTHER', customCategoryId: v.slice(7) || null });
    else onChange({ type: v, customCategoryId: null });
  };

  const add = async () => {
    setSaving(true);
    setAddError(null);
    try {
      const res = await api.post('/events/categories', { name });
      const { category } = res.data.data;
      setCategories((prev) => ({
        ...prev,
        custom: prev.custom.some((c) => c.id === category.id) ? prev.custom : [...prev.custom, category].sort((a, b) => a.name.localeCompare(b.name)),
      }));
      onChange({ type: 'OTHER', customCategoryId: category.id });
      setAdding(false);
      setName('');
    } catch (err) {
      setAddError({ message: err.response?.data?.message || 'Could not add the category.', predefinedType: err.response?.data?.predefinedType });
    } finally {
      setSaving(false);
    }
  };

  const usePredefined = (type) => {
    onChange({ type, customCategoryId: null });
    setAdding(false);
    setName('');
    setAddError(null);
  };

  return (
    <>
      <select id={id} className="tl-wz-input" value={adding ? ADD : selected} onChange={pick} aria-invalid={Boolean(error)}>
        <optgroup label="TicketLedger categories">
          {categories.predefined.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
          {/* Until the list loads, keep the current value selectable */}
          {!categories.predefined.length && value.type !== 'OTHER' && <option value={value.type}>{value.type}</option>}
        </optgroup>
        {categories.custom.length > 0 && (
          <optgroup label="Added by organizers">
            {categories.custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}
          </optgroup>
        )}
        {value.type === 'OTHER' && !categories.custom.some((c) => c.id === value.customCategoryId) && (
          <option value={selected}>{value.customCategoryId ? 'Your category' : 'Choose a category'}</option>
        )}
        <option value={ADD}>+ Add a new category…</option>
      </select>
      {adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            className="tl-wz-input"
            style={{ flex: '1 1 200px' }}
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (name.trim().length >= 3) add();
              }
            }}
            placeholder="e.g. Poetry Night, Esports Tournament"
            aria-label="New category name"
            autoFocus
          />
          <button type="button" className="tl-wz-btn" style={{ minHeight: 44 }} onClick={add} disabled={saving || name.trim().length < 3}>
            <Plus className="w-4 h-4" /> {saving ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="tl-wz-btn" style={{ minHeight: 44 }} onClick={() => { setAdding(false); setAddError(null); }}>
            Cancel
          </button>
        </div>
      )}
      {adding && !addError && <p className="tl-wz-hint">Only add a category when none of the ones above fits. It is added for your events and other organizers can pick it too; the TicketLedger categories don’t change.</p>}
      {addError && (
        <p className="tl-wz-error" role="alert">
          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {addError.message}
          {addError.predefinedType && (
            <button type="button" onClick={() => usePredefined(addError.predefinedType)} style={{ marginLeft: 6, textDecoration: 'underline', fontWeight: 700 }}>
              Use it
            </button>
          )}
        </p>
      )}
    </>
  );
}
