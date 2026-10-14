/* ZYVORA WebApp core: API client, i18n, theme, toasts, modal, helpers. */

export const state = {
  lang: window.ZY.LANG || 'uz',
  pack: window.ZY.PACK || {},
  user: null,
  me: null,
  isTg: !!window.ZY.IS_TG,
  route: '',
};

export function t(key, kwargs) {
  let s = state.pack[key] || key;
  if (kwargs) for (const [k, v] of Object.entries(kwargs)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('zyvora_lang', lang); } catch (e) {}
  fetch(`/api/i18n/${lang}`).then(r => r.json()).then(d => { state.pack = d.pack; applyI18n(); });
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

/* ---------------- API ---------------- */
export class ApiError extends Error {
  constructor(status, data) { super((data && data.error) || `HTTP ${status}`); this.status = status; this.data = data; }
}

export async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
    opts = { ...opts, body: JSON.stringify(opts.body) };
    headers['Content-Type'] = 'application/json';
  }
  if (state.isTg && window.ZY.INIT_DATA) headers['X-Telegram-Init-Data'] = window.ZY.INIT_DATA;
  const csrf = document.cookie.match(/zyvora_csrf=([^;]+)/);
  if (csrf) headers['X-CSRF-Token'] = csrf[1];
  let resp;
  try {
    resp = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(0, { error: t('error.network') });
  }
  if (resp.status === 401 && !path.startsWith('/api/auth')) {
    showGate();
    throw new ApiError(401, { error: t('error.unauthorized') });
  }
  let data = {};
  try { data = await resp.json(); } catch (e) { /* non-json */ }
  if (!resp.ok) throw new ApiError(resp.status, data);
  return data;
}

/* ---------------- toasts / modal ---------------- */
export function toast(msg, kind = '', ms = 3200) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${kind === 'ok' ? '✅' : kind === 'err' ? '⚠️' : 'ℹ️'}</span><div>${escapeHtml(msg)}</div>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(html) {
  const back = document.getElementById('modalBack');
  const box = document.getElementById('modalBox');
  box.innerHTML = html;
  back.classList.add('open');
  const close = (e) => { if (e.target === back) closeModal(); };
  back.onclick = close;
  return box;
}
export function closeModal() {
  document.getElementById('modalBack').classList.remove('open');
}
export function confirmModal(text, okLabel) {
  return new Promise((resolve) => {
    const box = modal(`
      <p style="margin:0 0 1rem">${escapeHtml(text)}</p>
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn ghost" id="cmNo">${t('common.cancel')}</button>
        <button class="btn primary" id="cmYes">${okLabel || t('common.confirm')}</button>
      </div>`);
    box.querySelector('#cmNo').onclick = () => { closeModal(); resolve(false); };
    box.querySelector('#cmYes').onclick = () => { closeModal(); resolve(true); };
  });
}
export function promptModal(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const box = modal(`
      <h3>${escapeHtml(title)}</h3>
      <input class="input mb-2" id="pmIn" placeholder="${escapeHtml(placeholder || '')}" value="${escapeHtml(value)}">
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn ghost" id="pmNo">${t('common.cancel')}</button>
        <button class="btn primary" id="pmOk">${t('common.confirm')}</button>
      </div>`);
    const inp = box.querySelector('#pmIn');
    inp.focus(); inp.select();
    const ok = () => { const v = inp.value.trim(); closeModal(); resolve(v || null); };
    box.querySelector('#pmOk').onclick = ok;
    box.querySelector('#pmNo').onclick = () => { closeModal(); resolve(null); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}

/* ---------------- theme ---------------- */
export function setTheme(theme, persist = true) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (persist) { try { localStorage.setItem('zyvora_theme', theme); } catch (e) {} }
  if (state.user) api('/api/me', { method: 'PATCH', body: { theme } }).catch(() => {});
  window.dispatchEvent(new CustomEvent('zyvora:theme', { detail: theme }));
}

/* ---------------- helpers ---------------- */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(state.lang === 'uz' ? 'uz-UZ' : state.lang === 'ru' ? 'ru-RU' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }); }
  catch (e) { return iso || ''; }
}
export function debounce(fn, ms) {
  let h; return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); };
}
export function el(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}
export function showGate() {
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('gate').style.display = 'grid';
}
export function initials(name) {
  const parts = String(name || 'Z').trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

/* ---------------- bootstrapped chrome ---------------- */
export function initChrome() {
  // theme
  let theme = 'dark';
  try { theme = localStorage.getItem('zyvora_theme') || 'dark'; } catch (e) {}
  setTheme(theme, false);
  document.getElementById('themeBtn').addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // language
  const seg = document.getElementById('langSeg');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    setLang(b.dataset.lang);
    paintLangSeg();
    window.dispatchEvent(new CustomEvent('zyvora:lang'));
  });
  paintLangSeg();

  // burger
  document.getElementById('burger').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // avatar menu
  const menu = document.getElementById('userMenu');
  document.getElementById('avatarBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
  document.getElementById('menuProfile').addEventListener('click', () => { location.hash = '#/profile'; });
  document.getElementById('menuSite').addEventListener('click', () => window.open('/', '_blank'));
  document.getElementById('menuLogout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    if (state.isTg) { window.Telegram.WebApp.close(); } else { window.location = '/'; }
  });

  // notifications
  document.getElementById('notifBtn').addEventListener('click', openNotifications);
}

export function paintLangSeg() {
  document.querySelectorAll('#langSeg button').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === state.lang);
  });
}

async function openNotifications() {
  const box = modal(`<h3>${t('notif.title')}</h3><div id="ntList"><div class="empty">${t('common.loading')}</div></div>`);
  try {
    const data = await api('/api/notifications');
    await api('/api/notifications/read', { method: 'POST' });
    markNotifDot(false);
    const list = box.querySelector('#ntList');
    if (!data.items.length) { list.innerHTML = `<div class="empty">${t('notif.empty')}</div>`; }
    else {
      list.innerHTML = data.items.map(n => `
        <div class="row mb-1" style="align-items:flex-start">
          <span>${n.kind === 'job' ? (n.text.startsWith('✅') ? '✅' : '❌') : n.kind === 'credits' ? '💎' : 'ℹ️'}</span>
          <div class="grow"><div class="small">${escapeHtml(n.text)}</div><div class="small muted">${fmtDate(n.at)}</div></div>
        </div>`).join('');
    }
  } catch (e) { /* gate shown by api() */ }
}

export function markNotifDot(on) {
  document.getElementById('notifDot').classList.toggle('on', !!on);
}

export function setUserChrome(me) {
  state.me = me;
  state.user = me.user;
  if (me.csrf) state.csrf = me.csrf;
  const av = document.getElementById('avatarBtn');
  av.textContent = initials(me.user.full_name || me.user.email || 'Z');
  document.getElementById('menuName').textContent = me.user.full_name || me.user.email || '—';
  document.getElementById('creditsVal').textContent = me.user.credits;
  document.querySelectorAll('.admin-only').forEach(el => { el.style.display = me.is_admin ? 'flex' : 'none'; });
  if (me.user.theme) setTheme(me.user.theme, false);
}

export function pollNotifications() {
  api('/api/notifications').then(d => {
    markNotifDot(d.items.some(n => !n.read));
  }).catch(() => {});
  setTimeout(pollNotifications, 20000);
}
