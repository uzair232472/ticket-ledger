/*
 * Typed confirmation for destructive admin actions. The API refuses such a request with 428
 * CONFIRMATION_REQUIRED and the phrase to type (the account's email, the company name, CHANGE…). These helpers
 * show a small dialog asking for it, then send the request again with `confirm`. The axios client uses it for
 * every request (utils/api.js); pages that call fetch use confirmedFetch.
 */
import './typedConfirm.css';

/** Shows the dialog; resolves with what was typed, or null when cancelled. */
export function askTypedConfirmation({ message, phrase }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'tl-tc';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <form class="tl-tc-card">
        <h2>Please confirm</h2>
        <p class="tl-tc-msg"></p>
        <label>Type <b class="tl-tc-phrase"></b> to continue
          <input autocomplete="off" spellcheck="false" />
        </label>
        <div class="tl-tc-actions">
          <button type="button" class="tl-tc-cancel">Cancel</button>
          <button type="submit" class="tl-tc-go" disabled>Confirm</button>
        </div>
      </form>`;
    wrap.querySelector('.tl-tc-msg').textContent = message || 'This action is hard to undo.';
    wrap.querySelector('.tl-tc-phrase').textContent = phrase;
    const input = wrap.querySelector('input');
    const go = wrap.querySelector('.tl-tc-go');
    const done = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => e.key === 'Escape' && done(null);
    input.addEventListener('input', () => { go.disabled = input.value.trim().toLowerCase() !== String(phrase).trim().toLowerCase(); });
    wrap.querySelector('.tl-tc-cancel').addEventListener('click', () => done(null));
    wrap.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!go.disabled) done(input.value.trim());
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    setTimeout(() => input.focus(), 30);
  });
}

/** fetch that handles a 428 confirmation request once (JSON bodies). */
export async function confirmedFetch(url, init = {}) {
  const res = await fetch(url, init);
  if (res.status !== 428) return res;
  const body = await res.clone().json().catch(() => null);
  if (body?.code !== 'CONFIRMATION_REQUIRED') return res;
  const typed = await askTypedConfirmation({ message: body.message, phrase: body.confirmPhrase });
  if (typed == null) return res;
  const payload = { ...(init.body ? JSON.parse(init.body) : {}), confirm: typed };
  return fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }, body: JSON.stringify(payload) });
}

/** axios: retries a 428 confirmation request once with the typed phrase. */
export function installTypedConfirm(instance) {
  instance.interceptors.response.use(undefined, async (error) => {
    const r = error.response;
    const cfg = error.config;
    if (r?.status !== 428 || r.data?.code !== 'CONFIRMATION_REQUIRED' || cfg?._typedConfirm) throw error;
    const typed = await askTypedConfirmation({ message: r.data.message, phrase: r.data.confirmPhrase });
    if (typed == null) throw error;
    const data = typeof cfg.data === 'string' ? JSON.parse(cfg.data || '{}') : cfg.data || {};
    return instance.request({ ...cfg, _typedConfirm: true, data: { ...data, confirm: typed } });
  });
}
