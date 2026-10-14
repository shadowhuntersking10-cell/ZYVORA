/* ZYVORA SPA: hash router + views. Modules: editor2d, studio3d, anim, admin. */
import { api, t, applyI18n, escapeHtml, fmtDate, el, initChrome, setUserChrome, pollNotifications, setLang, toast, confirmModal, promptModal, state, showGate } from './core.js';
import { mountEditor2D } from './editor2d.js';
import { mountStudio3D } from './studio3d.js';
import { mountAnim } from './anim.js';
import { mountAdmin } from './admin.js';

const content = document.getElementById('content');
let bootDone = false;

const KINDS = [
  { kind: '2d', icon: '🎨', label: 'studio.2d' },
  { kind: '3d', icon: '🧊', label: 'studio.3d' },
  { kind: 'animation', icon: '🎞', label: 'studio.animation' },
  { kind: 'character', icon: '🧑‍🎨', label: 'studio.character' },
];

/* ============================== router ============================== */
window.addEventListener('hashchange', route);
document.addEventListener('zyvora:lang', () => route());

async function route() {
  if (!state.me) return;
  const hash = location.hash || '#/dashboard';
  const parts = hash.slice(2).split('/'); // after '#/'
  const page = parts[0] || 'dashboard';
  state.route = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === page || (page === 'new' && n.dataset.nav === parts[1])));
  document.getElementById('sidebar').classList.remove('open');
  setSaveState(null);
  try {
    if (page === 'dashboard') await viewDashboard();
    else if (page === 'projects') await viewProjects();
    else if (page === 'new') await viewNewProject(parts[1]);
    else if (page === 'studio2d' && parts[1]) await viewStudio2D(+parts[1]);
    else if (page === 'studio3d' && parts[1]) await viewStudio3D(+parts[1]);
    else if (page === 'anim' && parts[1]) await viewAnim(+parts[1]);
    else if (page === 'character' && parts[1]) await viewCharacter(+parts[1]);
    else if (page === 'ai') await viewAI();
    else if (page === 'assistant') await viewAssistant();
    else if (page === 'assets') await viewAssets();
    else if (page === 'admin') await viewAdmin();
    else if (page === 'profile') await viewProfile();
    else await viewDashboard();
  } catch (e) {
    if (e && e.status === 401) return; // gate already shown
    content.innerHTML = `<div class="empty">⚠️ ${escapeHtml(e.message || t('error.generic'))}</div>`;
  }
}

function setTitle(key, fallback) {
  document.getElementById('viewTitle').textContent = key ? t(key) : (fallback || '');
}

/* ============================== save/gen state ============================== */
let saveTimer = null;
export function setSaveState(mode) {
  const elx = document.getElementById('saveState');
  clearTimeout(saveTimer);
  if (!mode) { elx.style.display = 'none'; return; }
  elx.style.display = 'inline-flex';
  if (mode === 'saving') { elx.className = 'badge'; elx.textContent = '💾 ' + t('common.saving'); }
  if (mode === 'saved') {
    elx.className = 'badge ok'; elx.textContent = '✅ ' + t('common.saved');
    saveTimer = setTimeout(() => { elx.style.display = 'none'; }, 2500);
  }
  if (mode === 'unsaved') { elx.className = 'badge warn'; elx.textContent = '● ' + t('common.unsaved'); }
}
export function setGenState(text) {
  const elx = document.getElementById('genState');
  if (!text) { elx.style.display = 'none'; return; }
  elx.style.display = 'inline-flex';
  elx.className = 'badge acc';
  elx.textContent = text;
}

/* ============================== dashboard ============================== */
async function viewDashboard() {
  setTitle('dash.title');
  const me = state.me;
  content.innerHTML = `
    <h2>${escapeHtml(t('dash.welcome', { name: (me.user.full_name || me.user.email || '👋').split(' ')[0] }))}</h2>
    <p class="muted small">${escapeHtml(t('hero.subtitle'))}</p>
    <div class="grid stats mb-2">
      <div class="card stat"><div class="num">${me.counts.projects}</div><div class="lbl">${t('dash.projects')}</div></div>
      <div class="card stat"><div class="num">${me.counts.jobs}</div><div class="lbl">${t('ai.jobs')}</div></div>
      <div class="card stat"><div class="num">${me.counts.assets}</div><div class="lbl">${t('up.title')}</div></div>
      <div class="card stat"><div class="num">💎 ${me.user.credits}</div><div class="lbl">${t('common.credits')}</div></div>
    </div>
    <h3>${t('dash.new_project')}</h3>
    <div class="grid cols-3 mb-2" id="quickNew">
      ${KINDS.map(k => `
        <div class="card feature-card" style="cursor:pointer" data-kind="${k.kind}">
          <div class="emoji">${k.icon}</div>
          <h3>${t(k.label)}</h3>
        </div>`).join('')}
    </div>
    <div class="grid cols-2">
      <div>
        <h3>${t('dash.projects')}</h3>
        <div id="dashProjects" class="empty">${t('common.loading')}</div>
      </div>
      <div>
        <h3>${t('dash.recent_jobs')}</h3>
        <div id="dashJobs" class="empty">${t('common.loading')}</div>
      </div>
    </div>`;
  content.querySelectorAll('#quickNew [data-kind]').forEach(card => {
    card.addEventListener('click', () => newProjectFlow(card.dataset.kind));
  });
  const [projects, jobs] = await Promise.all([api('/api/projects'), api('/api/gen?limit=5')]);
  const pl = document.getElementById('dashProjects');
  pl.className = '';
  pl.innerHTML = projects.items.length ? projects.items.slice(0, 6).map(p => `
    <div class="row mb-1 layer-row" style="box-shadow:var(--shadow-out-sm); background:var(--surface)">
      <span>${kindIcon(p.kind)}</span>
      <a class="nm grow" href="#/${kindRoute(p.kind)}/${p.id}" style="color:var(--text); text-decoration:none">${escapeHtml(p.name)}</a>
      <span class="muted small">${fmtDate(p.updated_at)}</span>
    </div>`).join('') : `<div class="empty">${t('proj.empty')}</div>`;
  const jl = document.getElementById('dashJobs');
  jl.className = '';
  jl.innerHTML = jobs.items.length ? jobs.items.map(j => `
    <div class="row mb-1 layer-row" style="box-shadow:var(--shadow-out-sm); background:var(--surface)">
      <span>${j.kind === 'image' ? '🖼' : j.kind === 'video' ? '🎬' : j.kind === '3d' ? '🧊' : '📝'}</span>
      <div class="grow" style="min-width:0"><div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(j.prompt || j.kind)}</div></div>
      ${statusBadge(j.status)}
    </div>`).join('') : `<div class="empty">${t('ai.jobs')} — 0</div>`;
}

function kindIcon(kind) { return { '2d': '🎨', '3d': '🧊', animation: '🎞', character: '🧑‍🎨' }[kind] || '🗂'; }
function kindRoute(kind) { return { '2d': 'studio2d', '3d': 'studio3d', animation: 'anim', character: 'character' }[kind] || 'projects'; }
function statusBadge(status) {
  const map = { completed: 'ok', failed: 'err', running: 'acc', queued: 'warn', canceled: '' };
  return `<span class="badge ${map[status] || ''}">${escapeHtml(t('ai.status.' + status))}</span>`;
}

/* ============================== projects ============================== */
async function viewProjects() {
  setTitle('dash.projects');
  content.innerHTML = `
    <div class="row wrap mb-2">
      <h2 class="grow">${t('dash.projects')}</h2>
      <button class="btn primary" id="newProjBtn">＋ ${t('dash.new_project')}</button>
    </div>
    <div class="seg mb-2" id="kindFilter">
      <button data-kind="" class="active">${t('common.all')}</button>
      ${KINDS.map(k => `<button data-kind="${k.kind}">${k.icon} ${t(k.label)}</button>`).join('')}
    </div>
    <div id="projList"></div>`;
  let filter = '';
  async function load() {
    const data = await api('/api/projects' + (filter ? `?kind=${filter}` : ''));
    const list = document.getElementById('projList');
    list.innerHTML = data.items.length ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${t('common.name')}</th><th>${t('proj.kind')}</th><th>${t('proj.version')}</th><th>${t('common.date')}</th><th>${t('common.actions')}</th></tr></thead>
      <tbody>${data.items.map(p => `
        <tr>
          <td><a href="#/${kindRoute(p.kind)}/${p.id}"><b>${escapeHtml(p.name)}</b></a></td>
          <td>${kindIcon(p.kind)} ${t('studio.' + (p.kind === '3d' ? '3d' : p.kind))}</td>
          <td>v${p.version}</td>
          <td class="muted small">${fmtDate(p.updated_at)}</td>
          <td><div class="btn-row">
            <button class="btn sm" data-act="open" data-id="${p.id}">${t('common.open')}</button>
            <button class="btn sm ghost" data-act="rename" data-id="${p.id}" data-name="${escapeHtml(p.name)}">✏️</button>
            <button class="btn sm danger" data-act="del" data-id="${p.id}" data-name="${escapeHtml(p.name)}">🗑</button>
          </div></td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('proj.empty')}</div>`;
    list.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.id;
      if (b.dataset.act === 'open') { location.hash = `#/${kindRoute(b.closest('tr').querySelector('td a').textContent ? b.dataset.kind || '' : '')}`; }
    }));
    // wire open/rename/delete via re-query (simpler: use row dataset)
    list.querySelectorAll('tbody tr').forEach(tr => {
      const link = tr.querySelector('a');
      const href = link.getAttribute('href');
      tr.querySelector('[data-act=open]').addEventListener('click', () => { location.hash = href; });
      tr.querySelector('[data-act=rename]').addEventListener('click', async () => {
        const name = await promptModal(t('common.rename'), t('proj.name_ph'), tr.dataset.name || link.textContent);
        if (name) { await api(`/api/projects/${tr.querySelector('[data-act=rename]').dataset.id}`, { method: 'PATCH', body: { name } }); load(); }
      });
      tr.querySelector('[data-act=del]').addEventListener('click', async () => {
        const ok = await confirmModal(t('proj.delete_confirm', { name: tr.querySelector('[data-act=del]').dataset.name }));
        if (ok) { await api(`/api/projects/${tr.querySelector('[data-act=del]').dataset.id}`, { method: 'DELETE' }); toast(t('common.success'), 'ok'); load(); refreshMe(); }
      });
    });
  }
  document.getElementById('newProjBtn').addEventListener('click', () => newProjectFlow());
  document.getElementById('kindFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#kindFilter button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    filter = b.dataset.kind;
    load();
  });
  await load();
}

async function refreshMe() {
  const me = await api('/api/me');
  setUserChrome(me);
}

export async function newProjectFlow(preferredKind) {
  const box = el(`<div>
    <h3>${t('dash.new_project')}</h3>
    <div class="field"><label>${t('proj.name_ph')}</label><input class="input" id="npName" value="${escapeHtml(t('common.new') + ' ' + (preferredKind ? t(preferredKind === '3d' ? 'studio.3d' : 'studio.' + preferredKind) : ''))}"></div>
    <div class="field"><label>${t('proj.kind')}</label>
      <div class="seg" id="npKind">
        ${KINDS.map(k => `<button type="button" data-kind="${k.kind}" class="${k.kind === (preferredKind || '2d') ? 'active' : ''}">${k.icon} ${t(k.label)}</button>`).join('')}
      </div>
    </div>
    <div class="btn-row" style="justify-content:flex-end">
      <button class="btn ghost" id="npCancel">${t('common.cancel')}</button>
      <button class="btn primary" id="npCreate">${t('common.create')}</button>
    </div>
  </div>`);
  const { modal, closeModal } = await import('./core.js');
  modal(box.outerHTML ? box : box);
  const m = document.getElementById('modalBox');
  m.querySelector('#npCancel').onclick = () => closeModal();
  m.querySelector('#npKind').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    m.querySelectorAll('#npKind button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
  m.querySelector('#npCreate').onclick = async () => {
    const name = m.querySelector('#npName').value.trim() || t('common.new');
    const kind = m.querySelector('#npKind button.active').dataset.kind;
    try {
      const res = await api('/api/projects', { method: 'POST', body: { name, kind } });
      closeModal();
      toast(t('common.success'), 'ok');
      location.hash = `#/${kindRoute(kind)}/${res.project.id}`;
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ============================== studio2d / 3d / anim ============================== */
async function viewStudio2D(id) {
  const data = await api(`/api/projects/${id}`);
  setTitle(null, `${t('studio.2d')} · ${data.project.name}`);
  content.innerHTML = '';
  mountEditor2D(content, data.project, {
    setSaveState, onDeleted: () => { location.hash = '#/projects'; },
  });
}
async function viewStudio3D(id) {
  const data = await api(`/api/projects/${id}`);
  setTitle(null, `${t('studio.3d')} · ${data.project.name}`);
  content.innerHTML = '';
  mountStudio3D(content, data.project, { setSaveState, onDeleted: () => { location.hash = '#/projects'; } });
}
async function viewAnim(id) {
  const data = await api(`/api/projects/${id}`);
  setTitle(null, `${t('studio.animation')} · ${data.project.name}`);
  content.innerHTML = '';
  mountAnim(content, data.project, { setSaveState, onDeleted: () => { location.hash = '#/projects'; } });
}

/* ============================== character ============================== */
async function viewCharacter(id) {
  const data = await api(`/api/projects/${id}`);
  setTitle(null, `${t('studio.character')} · ${data.project.name}`);
  const d = data.project.data || {};
  content.innerHTML = `
    <div class="row wrap mb-2">
      <button class="btn ghost sm" onclick="location.hash='#/projects'">← ${t('dash.projects')}</button>
      <button class="btn sm ghost" id="chRename">✏️ ${t('common.rename')}</button>
      <div class="grow"></div>
      <span class="badge">${t('proj.version')} v${data.project.version}</span>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h3>${t('studio.character')}</h3>
        <div class="field"><label>${t('common.name')}</label><input class="input" id="chName" value="${escapeHtml(d.name || '')}"></div>
        <div class="field"><label>Description</label><textarea class="input" id="chDesc" rows="5" placeholder="age, style, personality...">${escapeHtml(d.description || '')}</textarea></div>
        <div class="field"><label>Design notes</label><textarea class="input" id="chNotes" rows="4">${escapeHtml(d.notes || '')}</textarea></div>
        <button class="btn primary" id="chSave">${t('common.save')}</button>
      </div>
      <div>
        <div class="card mb-2">
          <h3>Palette</h3>
          <div class="row wrap" id="chPalette">
            ${(d.palette || []).map(c => `<span class="obj-dot" style="width:30px;height:30px;border-radius:9px;background:${escapeHtml(c)};box-shadow:var(--shadow-out-sm)" title="${escapeHtml(c)}"></span>`).join('') || '<span class="muted small">—</span>'}
          </div>
          <div class="row mt-1"><input type="color" id="chColor" value="#3498db"><button class="btn sm" id="chAddColor">＋</button></div>
        </div>
        <div class="card">
          <h3>Refs</h3>
          <div class="gal" id="chRefs">${(d.refs || []).map(r => `<div class="asset"><img src="/api/assets/${r.id}/file" alt=""><div class="cap"><button class="btn sm danger" data-ref="${r.id}">✕</button></div></div>`).join('') || `<div class="empty">${t('up.empty')}</div>`}</div>
          <input type="file" id="chFile" accept="image/png,image/jpeg,image/webp" style="display:none">
          <button class="btn mt-1" id="chUpload">⬆ ${t('up.upload')}</button>
        </div>
      </div>
    </div>`;
  const readForm = () => ({
    ...d,
    name: document.getElementById('chName').value,
    description: document.getElementById('chDesc').value,
    notes: document.getElementById('chNotes').value,
    palette: d.palette || [],
    refs: d.refs || [],
  });
  document.getElementById('chSave').addEventListener('click', async () => {
    try {
      await api(`/api/projects/${id}/data`, { method: 'PUT', body: { data: readForm() } });
      toast(t('common.saved'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
  document.getElementById('chRename').addEventListener('click', async () => {
    const name = await promptModal(t('common.rename'), t('proj.name_ph'), data.project.name);
    if (name) { await api(`/api/projects/${id}`, { method: 'PATCH', body: { name } }); viewCharacter(id); }
  });
  document.getElementById('chAddColor').addEventListener('click', async () => {
    const cur = readForm();
    cur.palette = [...(cur.palette || []), document.getElementById('chColor').value].slice(-12);
    await api(`/api/projects/${id}/data`, { method: 'PUT', body: { data: cur } });
    viewCharacter(id);
  });
  document.getElementById('chUpload').addEventListener('click', () => document.getElementById('chFile').click());
  document.getElementById('chFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await api('/api/assets', { method: 'POST', body: fd });
      const cur = readForm();
      cur.refs = [...(cur.refs || []), { id: res.asset.id, name: res.asset.name }].slice(-12);
      await api(`/api/projects/${id}/data`, { method: 'PUT', body: { data: cur } });
      toast(t('common.success'), 'ok');
      viewCharacter(id);
    } catch (err) { toast(err.message, 'err'); }
  });
  document.getElementById('chRefs').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-ref]'); if (!b) return;
    const cur = readForm();
    cur.refs = (cur.refs || []).filter(r => String(r.id) !== b.dataset.ref);
    await api(`/api/projects/${id}/data`, { method: 'PUT', body: { data: cur } });
    viewCharacter(id);
  });
}

/* ============================== AI generator ============================== */
async function viewAI() {
  setTitle('ai.title');
  const pricing = await api('/api/gen/pricing');
  const provFor = (kind) => pricing.providers.filter(p => p.kinds.includes(kind));
  content.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>🪄 ${t('ai.generate')}</h3>
        <p class="muted small">${t('ai.subtitle')}</p>
        <div class="field"><label>AI</label>
          <div class="seg" id="genKind">
            ${['image', 'video', '3d', 'text'].map(k => `<button data-kind="${k}" class="${k === 'image' ? 'active' : ''}">${t('ai.kind.' + k)}</button>`).join('')}
          </div>
        </div>
        <div class="field"><label>${t('ai.prompt')}</label>
          <textarea class="input" id="genPrompt" rows="4" maxlength="4000" placeholder="${t('ai.prompt_ph')}"></textarea>
        </div>
        <div class="row mb-2">
          <span class="badge acc" id="genCost"></span>
          <span class="muted small" id="genProv"></span>
        </div>
        <button class="btn primary" id="genBtn" style="width:100%">🪄 ${t('ai.generate')}</button>
      </div>
      <div class="card">
        <h3>${t('ai.jobs')}</h3>
        <div id="jobList" class="empty">${t('common.loading')}</div>
      </div>
    </div>`;

  let kind = 'image';
  function paintMeta() {
    const cost = pricing.pricing[kind] ?? 0;
    document.getElementById('genCost').textContent = t('ai.cost', { cost });
    const provs = provFor(kind);
    const okProvs = provs.filter(p => p.configured && p.enabled);
    const elx = document.getElementById('genProv');
    if (okProvs.length) elx.textContent = '⚡ ' + okProvs.map(p => p.label).join(', ');
    else {
      const need = provs.map(p => `${p.label}: ${p.env_keys.join(', ')}`).join(' · ');
      elx.textContent = '⚠️ ' + t('ai.provider.not_configured', { provider: need || kind });
      elx.title = need;
    }
  }
  paintMeta();
  document.getElementById('genKind').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#genKind button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    kind = b.dataset.kind;
    paintMeta();
  });

  async function loadJobs() {
    const jobs = await api('/api/gen?limit=30');
    const list = document.getElementById('jobList');
    list.className = '';
    if (!jobs.items.length) { list.innerHTML = `<div class="empty">${t('ai.jobs')} — 0</div>`; return; }
    list.innerHTML = jobs.items.map(j => `
      <div class="card inset mb-1" style="padding:.8rem 1rem" data-job="${j.id}">
        <div class="row wrap">
          <b class="small">${j.kind === 'image' ? '🖼' : j.kind === 'video' ? '🎬' : j.kind === '3d' ? '🧊' : '📝'} #${j.id}</b>
          ${statusBadge(j.status)}
          <span class="muted small">${fmtDate(j.created_at)}</span>
        </div>
        <div class="small mt-1" style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(j.prompt)}</div>
        ${j.status === 'running' || j.status === 'queued' ? `<div class="progress mt-1"><div style="width:${j.progress}%"></div></div>` : ''}
        ${j.error ? `<div class="small mt-1" style="color:var(--danger)">${escapeHtml(j.error)}</div>` : ''}
        ${j.status === 'completed' && j.result_meta && j.result_meta.file ? `<a href="/data/${escapeHtml(j.result_meta.file)}" download target="_blank"><img src="/data/${escapeHtml(j.result_meta.file)}" style="max-width:100%;max-height:260px;border-radius:10px;margin-top:.6rem" alt="result"></a>` : ''}
        ${j.status === 'completed' && j.result_meta && j.result_meta.text ? `<div class="prompt-box mt-1">${escapeHtml(j.result_meta.text)}</div>` : ''}
        ${j.status === 'completed' && j.result_meta && j.result_meta.url ? `<div class="mt-1"><a class="btn sm" href="${escapeHtml(j.result_meta.url)}" target="_blank" rel="noopener">${t('common.download')} 🔗</a></div>` : ''}
      </div>`).join('');
  }
  await loadJobs();

  document.getElementById('genBtn').addEventListener('click', async () => {
    const btn = document.getElementById('genBtn');
    const prompt = document.getElementById('genPrompt').value.trim();
    if (prompt.length < 3) { toast(t('ai.prompt_ph'), 'err'); return; }
    btn.disabled = true;
    try {
      const res = await api('/api/gen', { method: 'POST', body: { kind, prompt, confirm_cost: true } });
      toast(`#${res.job.id} → ${t('ai.status.queued')}`, 'ok');
      document.getElementById('genPrompt').value = '';
      refreshMe();
      watchJob(res.job.id);
      loadJobs();
    } catch (e) {
      if (e.status === 402 && e.data && e.data.needs_confirm) {
        const ok = await confirmModal(t('ai.confirm_cost', { cost: e.data.cost }));
        if (ok) {
          try {
            const res = await api('/api/gen', { method: 'POST', body: { kind, prompt, confirm_cost: true } });
            toast(`#${res.job.id} → ${t('ai.status.queued')}`, 'ok');
            refreshMe(); watchJob(res.job.id); loadJobs();
          } catch (e2) { toast(e2.message, 'err'); }
        }
      } else toast(e.message, 'err');
    }
    btn.disabled = false;
  });

  const watched = new Set();
  function watchJob(id) {
    if (watched.has(id)) return;
    watched.add(id);
    const iv = setInterval(async () => {
      try {
        const d = await api(`/api/gen/${id}`);
        if (d.job.status === 'completed' || d.job.status === 'failed') {
          clearInterval(iv);
          watched.delete(id);
          toast(d.job.status === 'completed' ? t('notif.job_done', { kind: d.job.kind }) : (d.job.error || t('notif.job_failed', { kind: d.job.kind })), d.job.status === 'completed' ? 'ok' : 'err');
          setGenState(null);
          refreshMe();
          loadJobs();
        } else {
          setGenState(`⚡ ${t('ai.status.' + d.job.status)} #${id} ${d.job.progress ? d.job.progress + '%' : ''}`);
        }
      } catch (e) { clearInterval(iv); }
    }, 2500);
  }
}

/* ============================== assistant ============================== */
async function viewAssistant() {
  setTitle('as.title');
  const projects = await api('/api/projects');
  content.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <div class="row wrap mb-2">
          <b>🤖 ${t('as.title')}</b>
          <div class="grow"></div>
          <div class="seg" id="asMode">
            <button data-mode="mentor" class="active">${t('as.mode.mentor')}</button>
            <button data-mode="copilot">${t('as.mode.copilot')}</button>
            <button data-mode="agent">${t('as.mode.agent')}</button>
          </div>
        </div>
        <div class="field"><label>${t('dash.projects')}</label>
          <select class="input" id="asProject">
            ${projects.items.map(p => `<option value="${p.id}">${kindIcon(p.kind)} ${escapeHtml(p.name)} (${p.kind})</option>`).join('')}
          </select>
        </div>
        <div class="chat" id="asChat"></div>
        <div class="chat-input">
          <input class="input" id="asInput" placeholder="${t('as.placeholder')}" maxlength="2000">
          <button class="btn primary icon" id="asSend">➤</button>
        </div>
      </div>
      <div class="card">
        <h3 class="small">🧰 Tools</h3>
        <p class="muted small">inspect_project · list_objects · create_object · update_transform · create_material · rename_object · delete_object · undo_last_change</p>
        <div class="divider"></div>
        <p class="muted small">${t('as.mode.mentor')}: explain · ${t('as.mode.copilot')}: propose → approve · ${t('as.mode.agent')}: execute</p>
      </div>
    </div>`;

  let mode = 'mentor';
  const chat = document.getElementById('asChat');
  const addMsg = (text, who, extraHtml = '') => {
    const m = el(`<div class="msg ${who}">${escapeHtml(text)}${extraHtml}</div>`);
    chat.appendChild(m);
    chat.scrollTop = chat.scrollHeight;
    return m;
  };

  document.getElementById('asMode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#asMode button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    mode = b.dataset.mode;
  });

  async function send() {
    const input = document.getElementById('asInput');
    const message = input.value.trim();
    if (!message) return;
    const projectId = +document.getElementById('asProject').value;
    addMsg(message, 'user');
    input.value = '';
    const thinking = addMsg('…', 'bot');
    try {
      const res = await api('/api/assistant', { method: 'POST', body: { project_id: projectId, message, mode } });
      thinking.remove();
      let extra = '';
      if (res.executed) {
        const okN = res.executed.results.filter(r => r.ok).length;
        extra = `<div class="small mt-1">${res.executed.ok ? '✅' : '⚠️'} ${t('as.executed', { n: okN })}</div>`;
      }
      if (mode === 'copilot' && res.actions && res.actions.length) {
        const actsHtml = `<div class="acts"><button class="btn sm primary" data-approve="1">✔ ${t('as.approve')}</button><button class="btn sm ghost" data-reject="1">✕ ${t('as.reject')}</button></div>`;
        const m = addMsg(res.reply + '\n' + res.actions.map(a => `• ${a.tool} ${JSON.stringify(a.args)}`).join('\n'), 'bot', actsHtml);
        m.querySelector('[data-approve]').onclick = async () => {
          const r2 = await api('/api/assistant/execute', { method: 'POST', body: { project_id: projectId, actions: res.actions } });
          m.querySelector('.acts').remove();
          addMsg((r2.ok ? '✅ ' : '⚠️ ') + t('as.executed', { n: r2.results.filter(r => r.ok).length }), 'bot');
        };
        m.querySelector('[data-reject]').onclick = () => { m.querySelector('.acts').remove(); addMsg(t('common.cancel'), 'bot'); };
      } else {
        addMsg(res.reply || '—', 'bot', extra);
      }
      if (res.planner && res.planner.startsWith('local')) addMsg('ℹ️ ' + t('as.local_mode'), 'bot');
      if (res.project_updated) { setSaveState('saved'); }
    } catch (e) {
      thinking.remove();
      addMsg('⚠️ ' + e.message, 'bot');
    }
  }
  document.getElementById('asSend').addEventListener('click', send);
  document.getElementById('asInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  if (!projects.items.length) addMsg(t('proj.empty'), 'bot');
}

/* ============================== assets ============================== */
async function viewAssets() {
  setTitle('up.title');
  content.innerHTML = `
    <div class="row wrap mb-2">
      <h2 class="grow">${t('up.title')}</h2>
      <input type="file" id="assetFile" accept="image/png,image/jpeg,image/webp" style="display:none">
      <button class="btn primary" id="assetUpload">⬆ ${t('up.upload')}</button>
    </div>
    <div id="assetGal" class="gal"></div>`;
  async function load() {
    const data = await api('/api/assets');
    const gal = document.getElementById('assetGal');
    gal.innerHTML = data.items.length ? data.items.map(a => `
      <div class="asset">
        <a href="/api/assets/${a.id}/file" target="_blank"><img src="/api/assets/${a.id}/file" loading="lazy" alt=""></a>
        <div class="cap"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.name)}</span>
        <button class="btn sm danger" data-del="${a.id}">✕</button></div>
      </div>`).join('') : `<div class="empty" style="grid-column:1/-1">${t('up.empty')}</div>`;
    gal.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      await api(`/api/assets/${b.dataset.del}`, { method: 'DELETE' });
      load();
    }));
  }
  document.getElementById('assetUpload').addEventListener('click', () => document.getElementById('assetFile').click());
  document.getElementById('assetFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      await api('/api/assets', { method: 'POST', body: fd });
      toast(t('common.success'), 'ok');
    } catch (err) { toast(err.message, 'err'); }
    e.target.value = '';
    load();
  });
  await load();
}

/* ============================== admin ============================== */
async function viewAdmin() {
  if (!state.me.is_admin) { location.hash = '#/dashboard'; return; }
  setTitle('admin.panel');
  content.innerHTML = '';
  mountAdmin(content);
}

/* ============================== profile ============================== */
async function viewProfile() {
  setTitle('common.profile');
  const u = state.me.user;
  content.innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3>👤 ${t('common.profile')}</h3>
        <div class="field"><label>${t('common.name')}</label><input class="input" id="pfName" value="${escapeHtml(u.full_name || '')}"></div>
        <div class="field"><label>${t('common.email')}</label><input class="input" value="${escapeHtml(u.email || '—')}" disabled></div>
        <div class="field"><label>${t('prof.telegram')}</label><input class="input" value="${u.telegram_id ? '✅ ' + u.telegram_id : t('prof.not_linked')}" disabled></div>
        <div class="field"><label>${t('prof.role')}</label><input class="input" value="${u.role}" disabled></div>
        <div class="field"><label>${t('common.language')}</label>
          <div class="seg" id="pfLang">
            <button data-lang="uz" class="${u.lang === 'uz' ? 'active' : ''}">🇺🇿 UZ</button>
            <button data-lang="en" class="${u.lang === 'en' ? 'active' : ''}">🇬🇧 EN</button>
            <button data-lang="ru" class="${u.lang === 'ru' ? 'active' : ''}">🇷🇺 RU</button>
          </div>
        </div>
        <button class="btn primary" id="pfSave">${t('common.save')}</button>
      </div>
      <div>
        <div class="card mb-2">
          <h3>🔒 ${t('prof.change_pass')}</h3>
          <div class="field"><label>${t('prof.old_pass')}</label><input class="input" type="password" id="pfOld"></div>
          <div class="field"><label>${t('prof.new_pass')}</label><input class="input" type="password" id="pfNew"></div>
          <button class="btn" id="pfPass">${t('common.save')}</button>
        </div>
        <div class="card mb-2">
          <h3>💎 ${t('prof.balance')}: ${u.credits}</h3>
          <h4 class="small muted">${t('prof.usage_history')}</h4>
          <div id="pfLedger"></div>
        </div>
        ${u.role === 'admin' || u.role === 'moderator' ? '' : `
        <div class="card">
          <h3 style="color:var(--danger)">🗑 ${t('prof.delete_account')}</h3>
          <div class="field"><label>${t('common.password')}</label><input class="input" type="password" id="pfDelPass"></div>
          <button class="btn danger" id="pfDelete">${t('prof.delete_account')}</button>
        </div>`}
      </div>
    </div>`;
  const ledger = state.me.ledger || [];
  document.getElementById('pfLedger').innerHTML = ledger.length ? ledger.map(l => `
    <div class="row small mb-1"><span class="grow">${escapeHtml(l.reason)}</span>
      <b style="color:${l.delta >= 0 ? 'var(--ok)' : 'var(--danger)'}">${l.delta >= 0 ? '+' : ''}${l.delta}</b>
      <span class="muted small">${fmtDate(l.at)}</span></div>`).join('') : `<div class="muted small">${t('prof.ledger.empty')}</div>`;
  document.getElementById('pfLang').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#pfLang button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
  document.getElementById('pfSave').addEventListener('click', async () => {
    const lang = document.querySelector('#pfLang button.active').dataset.lang;
    try {
      await api('/api/me', { method: 'PATCH', body: { full_name: document.getElementById('pfName').value, lang } });
      toast(t('common.saved'), 'ok');
      setLang(lang); refreshMe();
    } catch (e) { toast(e.message, 'err'); }
  });
  document.getElementById('pfPass').addEventListener('click', async () => {
    try {
      await api('/api/me/password', { method: 'POST', body: { old_password: document.getElementById('pfOld').value, new_password: document.getElementById('pfNew').value } });
      toast(t('common.saved'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
  const delBtn = document.getElementById('pfDelete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const ok = await confirmModal(t('prof.delete_confirm'));
    if (!ok) return;
    try {
      await api('/api/me/delete', { method: 'POST', body: { password: document.getElementById('pfDelPass').value } });
      window.location = '/';
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ============================== boot ============================== */
async function boot() {
  initChrome();
  applyI18n();
  try {
    const me = await api('/api/me');
    setUserChrome(me);
    document.getElementById('gate').style.display = 'none';
    document.getElementById('appShell').style.display = 'grid';
    bootDone = true;
    applyI18n();
    route();
    pollNotifications();
  } catch (e) {
    if (e.status === 401) return; // gate visible
    document.getElementById('gate').innerHTML = `<div class="card center" style="max-width:430px"><h2>⚠️</h2><p>${escapeHtml(e.message)}</p></div>`;
    document.getElementById('gate').style.display = 'grid';
  }
}
boot();
