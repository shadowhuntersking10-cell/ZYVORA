/* Admin panel: overview, users, jobs, providers, broadcast, audit, settings.
   All data comes from real backend endpoints; nothing is hardcoded. */
import { api, t, toast, confirmModal, promptModal, escapeHtml, fmtDate } from './core.js';

export function mountAdmin(root) {
  root.innerHTML = `
    <div class="row wrap mb-2">
      <h2 class="grow">🛡 ${t('admin.panel')}</h2>
      <button class="btn sm" id="adRefresh">⟳ ${t('common.refresh')}</button>
    </div>
    <div class="seg mb-2" id="adTabs">
      <button data-tab="overview" class="active">${t('admin.overview')}</button>
      <button data-tab="users">${t('admin.users')}</button>
      <button data-tab="jobs">${t('admin.jobs')}</button>
      <button data-tab="providers">${t('admin.providers')}</button>
      <button data-tab="broadcast">${t('admin.broadcast')}</button>
      <button data-tab="audit">${t('admin.audit')}</button>
      <button data-tab="settings">${t('admin.settings')}</button>
    </div>
    <div id="adBody"><div class="empty">${t('common.loading')}</div></div>`;

  const body = root.querySelector('#adBody');
  let tab = 'overview';

  root.querySelector('#adTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    root.querySelectorAll('#adTabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    tab = b.dataset.tab;
    load();
  });
  root.querySelector('#adRefresh').addEventListener('click', load);

  async function load() {
    body.innerHTML = `<div class="empty">${t('common.loading')}</div>`;
    try {
      await ({ overview: tabOverview, users: tabUsers, jobs: tabJobs, providers: tabProviders, broadcast: tabBroadcast, audit: tabAudit, settings: tabSettings })[tab]();
    } catch (e) {
      if (e.status === 403) body.innerHTML = `<div class="empty">⛔ ${t('error.forbidden')}</div>`;
      else body.innerHTML = `<div class="empty">⚠️ ${escapeHtml(e.message)}</div>`;
    }
  }

  /* ---------------- overview ---------------- */
  async function tabOverview() {
    const [ov, st] = await Promise.all([api('/api/admin/overview'), api('/api/admin/status')]);
    body.innerHTML = `
      <div class="grid stats mb-2">
        <div class="card stat"><div class="num">${ov.users.total}</div><div class="lbl">${t('admin.total_users')}</div></div>
        <div class="card stat"><div class="num">${ov.users.new_7d}</div><div class="lbl">${t('admin.new_users_7d')}</div></div>
        <div class="card stat"><div class="num">${ov.users.active_7d}</div><div class="lbl">${t('admin.active_7d')}</div></div>
        <div class="card stat"><div class="num">${ov.content.projects}</div><div class="lbl">${t('admin.projects')}</div></div>
        <div class="card stat"><div class="num">${ov.jobs.total}</div><div class="lbl">${t('admin.jobs_total')}</div></div>
        <div class="card stat"><div class="num" style="color:var(--ok)">${ov.jobs.completed}</div><div class="lbl">${t('admin.jobs_ok')}</div></div>
        <div class="card stat"><div class="num" style="color:var(--danger)">${ov.jobs.failed}</div><div class="lbl">${t('admin.jobs_failed')}</div></div>
        <div class="card stat"><div class="num">💎 ${ov.credits_issued}</div><div class="lbl">${t('admin.credits_issued')}</div></div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <h3>${t('admin.system')}</h3>
          <div class="row small mb-1"><span class="grow">Database</span>${st.database.ok ? `<span class="badge ok">${escapeHtml(st.database.engine)}</span>` : '<span class="badge err">down</span>'}</div>
          <div class="row small mb-1"><span class="grow">Telegram bot</span>${st.bot.online ? `<span class="badge ok">${t('admin.bot_online')} @${escapeHtml(st.bot.username || '')}</span>` : st.bot.has_token ? `<span class="badge err">${t('admin.bot_offline')}</span>` : `<span class="badge warn">${t('admin.bot_no_token')}</span>`}</div>
          <div class="row small mb-1"><span class="grow">Worker</span>${st.worker.last_error ? `<span class="badge err">${escapeHtml(st.worker.last_error)}</span>` : '<span class="badge ok">OK</span>'}</div>
          <div class="row small mb-1"><span class="grow">Uptime</span><span class="muted">${Math.floor(st.uptime_s / 60)} min</span></div>
          <div class="row small"><span class="grow">${t('admin.revenue')}</span><span class="badge">${t('admin.revenue.na')}</span></div>
        </div>
        <div class="card">
          <h3>${t('admin.audit')}</h3>
          ${ov.recent_events.map(e2 => `<div class="row small mb-1"><span class="badge">${escapeHtml(e2.action)}</span><span class="muted grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e2.actor)} ${escapeHtml(e2.target)}</span><span class="muted small">${fmtDate(e2.at)}</span></div>`).join('') || '<span class="muted small">—</span>'}
        </div>
      </div>
      ${ov.provider_usage.length ? `<div class="card mt-2"><h3>Provider usage</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Provider</th><th>Jobs</th><th>${t('common.credits')}</th></tr></thead>
        <tbody>${ov.provider_usage.map(u => `<tr><td>${escapeHtml(u.provider)}</td><td>${u.jobs}</td><td>${u.credits_used}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  }

  /* ---------------- users ---------------- */
  async function tabUsers(q = '') {
    const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
    body.innerHTML = `
      <div class="row mb-2">
        <input class="input grow" id="adUserQ" placeholder="${t('common.search')}" value="${escapeHtml(q)}">
        <button class="btn" id="adUserSearch">🔍</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>ID</th><th>${t('common.name')}</th><th>Email / TG</th><th>${t('admin.role')}</th><th>💎</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead>
        <tbody>
          ${data.items.map(u => `
          <tr data-uid="${u.id}">
            <td>${u.id}</td>
            <td><b>${escapeHtml(u.full_name || '—')}</b><div class="muted small">${fmtDate(u.created_at)}</div></td>
            <td class="small">${escapeHtml(u.email || '—')}${u.telegram_id ? `<div class="muted small">✈️ ${u.telegram_id}</div>` : ''}</td>
            <td><span class="badge ${u.role === 'admin' ? 'acc' : ''}">${u.role}</span></td>
            <td>${u.credits}</td>
            <td>${u.is_banned ? `<span class="badge err">${escapeHtml(u.ban_reason || 'banned')}</span>` : '<span class="badge ok">active</span>'}</td>
            <td><div class="btn-row">
              <button class="btn sm" data-act="credits" title="${t('admin.grant_credits')}">💎</button>
              <button class="btn sm" data-act="role" title="${t('admin.role')}">🎭</button>
              <button class="btn sm" data-act="revoke" title="${t('admin.revoke_sessions')}">🔒</button>
              ${u.is_banned ? `<button class="btn sm" data-act="unban">✅</button>` : `<button class="btn sm danger" data-act="ban">⛔</button>`}
            </div></td>
          </tr>`).join('')}
        </tbody></table></div>
      <div class="muted small mt-1">${data.total} ${t('admin.users').toLowerCase()}</div>`;

    body.querySelector('#adUserSearch').addEventListener('click', () => tabUsers(body.querySelector('#adUserQ').value));
    body.querySelector('#adUserQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') tabUsers(e.target.value); });

    body.querySelectorAll('tr[data-uid] button').forEach(btn => btn.addEventListener('click', async () => {
      const uid = +btn.closest('tr').dataset.uid;
      const act = btn.dataset.act;
      try {
        if (act === 'ban') {
          const ok = await confirmModal('Ban user #' + uid + '?');
          if (ok) { await api(`/api/admin/users/${uid}/ban`, { method: 'POST', body: { reason: 'banned by admin' } }); toast(t('common.success'), 'ok'); load(); }
        } else if (act === 'unban') {
          await api(`/api/admin/users/${uid}/unban`, { method: 'POST' }); toast(t('common.success'), 'ok'); load();
        } else if (act === 'credits') {
          const amount = await promptModal(t('admin.grant_credits'), '100');
          if (amount) { await api(`/api/admin/users/${uid}/credits`, { method: 'POST', body: { amount: +amount } }); toast(t('common.success'), 'ok'); load(); }
        } else if (act === 'role') {
          const role = await promptModal(t('admin.role') + ' (user/moderator/admin)', 'user');
          if (role && ['user', 'moderator', 'admin'].includes(role)) { await api(`/api/admin/users/${uid}/role`, { method: 'POST', body: { role } }); toast(t('common.success'), 'ok'); load(); }
          else if (role) toast('invalid role', 'err');
        } else if (act === 'revoke') {
          const r = await api(`/api/admin/users/${uid}/revoke-sessions`, { method: 'POST' });
          toast(`✅ ${r.revoked}`, 'ok');
        }
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  /* ---------------- jobs ---------------- */
  async function tabJobs(status = '') {
    const data = await api(`/api/admin/jobs${status ? `?status=${status}` : ''}`);
    body.innerHTML = `
      <div class="seg mb-2" id="adJobFilter">
        <button data-s="" class="${!status ? 'active' : ''}">${t('common.all')}</button>
        ${['queued', 'running', 'completed', 'failed'].map(s => `<button data-s="${s}" class="${status === s ? 'active' : ''}">${t('ai.status.' + s)}</button>`).join('')}
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>${t('ai.kind.' + 'image').split(' ')[0] ? 'Kind' : 'Kind'}</th><th>${t('common.status')}</th><th>Prompt</th><th>User</th><th>💎</th><th>${t('common.actions')}</th></tr></thead>
        <tbody>
          ${data.items.map(j => `
            <tr>
              <td>${j.id}</td>
              <td>${j.kind}</td>
              <td><span class="badge ${j.status === 'completed' ? 'ok' : j.status === 'failed' ? 'err' : 'acc'}">${j.status}</span>${j.provider ? `<div class="muted small">${escapeHtml(j.provider)}</div>` : ''}</td>
              <td class="small" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(j.prompt)}">${escapeHtml(j.prompt)}</td>
              <td class="small">${escapeHtml(j.user)}</td>
              <td>${j.cost}</td>
              <td>${j.status === 'failed' ? `<button class="btn sm" data-retry="${j.id}">⟳ retry</button>` : ''}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">0</td></tr>'}
        </tbody></table></div>`;
    body.querySelector('#adJobFilter').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (b) tabJobs(b.dataset.s);
    });
    body.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async () => {
      try { await api(`/api/admin/jobs/${b.dataset.retry}/retry`, { method: 'POST' }); toast(t('common.success'), 'ok'); load(); }
      catch (e) { toast(e.message, 'err'); }
    }));
  }

  /* ---------------- providers ---------------- */
  async function tabProviders() {
    const data = await api('/api/admin/providers');
    body.innerHTML = `<div class="grid cols-2">
      ${data.items.map(p => `
        <div class="card">
          <div class="row wrap">
            <b class="grow">${escapeHtml(p.label)}</b>
            ${p.configured ? '<span class="badge ok">key ✓</span>' : `<span class="badge warn">no key</span>`}
            <span class="badge ${p.enabled ? 'acc' : ''}">${p.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div class="small muted mt-1">${p.features.map(escapeHtml).join(' · ')}</div>
          <div class="small muted mt-1">env: ${p.env_keys.map(k => `<span class="kbd">${escapeHtml(k)}</span>`).join(' ')}</div>
          ${p.last_error ? `<div class="small mt-1" style="color:var(--danger)">${escapeHtml(p.last_error)}</div>` : ''}
          <div class="btn-row mt-1">
            <button class="btn sm" data-test="${p.name}">🔌 test</button>
            <button class="btn sm ghost" data-toggle="${p.name}">${p.enabled ? '⏸ disable' : '▶ enable'}</button>
            ${p.docs ? `<a class="btn sm ghost" href="${escapeHtml(p.docs)}" target="_blank" rel="noopener">docs</a>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <p class="muted small mt-2">🔑 ${escapeHtml(data.note)}</p>`;
    body.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
      const r = await api(`/api/admin/providers/${b.dataset.test}/test`, { method: 'POST' });
      toast((r.ok ? '✅ ' : '⚠️ ') + r.message, r.ok ? 'ok' : 'err');
      load();
    }));
    body.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      await api(`/api/admin/providers/${b.dataset.toggle}/toggle`, { method: 'POST' });
      load();
    }));
  }

  /* ---------------- broadcast ---------------- */
  async function tabBroadcast() {
    body.innerHTML = `
      <div class="card" style="max-width:640px">
        <h3>✈️ ${t('admin.broadcast')}</h3>
        <p class="muted small">${t('admin.broadcast_hint')}</p>
        <div class="field"><textarea class="input" id="bcText" rows="5" maxlength="3500" placeholder="Text..."></textarea></div>
        <div class="field"><label>lang</label>
          <div class="seg" id="bcLang">
            <button data-l="" class="active">${t('common.all')}</button>
            <button data-l="uz">🇺🇿</button><button data-l="en">🇬🇧</button><button data-l="ru">🇷🇺</button>
          </div>
        </div>
        <button class="btn primary" id="bcSend">${t('common.send')}</button>
        <div id="bcResult" class="mt-2"></div>
      </div>`;
    let lang = '';
    body.querySelector('#bcLang').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      body.querySelectorAll('#bcLang button').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); lang = b.dataset.l;
    });
    body.querySelector('#bcSend').addEventListener('click', async () => {
      const btn = body.querySelector('#bcSend');
      btn.disabled = true;
      try {
        const r = await api('/api/admin/broadcast', { method: 'POST', body: { text: body.querySelector('#bcText').value, lang: lang || null } });
        body.querySelector('#bcResult').innerHTML = `<div class="card inset">${t('admin.broadcast_sent', { sent: r.sent, failed: r.failed })}${r.note ? `<div class="small muted">${escapeHtml(r.note)}</div>` : ''}</div>`;
      } catch (e) { toast(e.message, 'err'); }
      btn.disabled = false;
    });
  }

  /* ---------------- audit ---------------- */
  async function tabAudit(q = '') {
    const data = await api(`/api/admin/audit${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    body.innerHTML = `
      <div class="row mb-2">
        <input class="input grow" id="adAuditQ" placeholder="${t('common.search')}" value="${escapeHtml(q)}">
        <button class="btn" id="adAuditSearch">🔍</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>Action</th><th>Actor</th><th>Target</th><th>Detail</th><th>IP</th><th>${t('common.date')}</th></tr></thead>
        <tbody>
          ${data.items.map(e2 => `
            <tr>
              <td>${e2.id}</td>
              <td><span class="badge">${escapeHtml(e2.action)}</span></td>
              <td class="small">${escapeHtml(e2.actor)}</td>
              <td class="small muted">${escapeHtml(e2.target)}</td>
              <td class="small muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(JSON.stringify(e2.detail || {}))}">${escapeHtml(JSON.stringify(e2.detail || {}))}</td>
              <td class="small muted">${escapeHtml(e2.ip || '')}</td>
              <td class="small muted">${fmtDate(e2.at)}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="empty">0</td></tr>'}
        </tbody></table></div>`;
    body.querySelector('#adAuditSearch').addEventListener('click', () => tabAudit(body.querySelector('#adAuditQ').value));
    body.querySelector('#adAuditQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') tabAudit(e.target.value); });
  }

  /* ---------------- settings ---------------- */
  async function tabSettings() {
    const s = await api('/api/admin/settings');
    body.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <h3>💎 ${t('admin.price')}</h3>
          <div class="field"><label>${t('admin.price.image')}</label><input class="input" type="number" min="0" id="prImage" value="${s.pricing.image}"></div>
          <div class="field"><label>${t('admin.price.video')}</label><input class="input" type="number" min="0" id="prVideo" value="${s.pricing.video}"></div>
          <div class="field"><label>${t('admin.price.3d')}</label><input class="input" type="number" min="0" id="pr3d" value="${s.pricing['3d']}"></div>
          <div class="field"><label>${t('ai.kind.text')}</label><input class="input" type="number" min="0" id="prText" value="${s.pricing.text}"></div>
          <button class="btn primary" id="savePricing">${t('common.save')}</button>
        </div>
        <div class="card">
          <h3>⚙️ System</h3>
          <div class="row small mb-1"><span class="grow">Database</span><b>${escapeHtml(s.db)}</b></div>
          <div class="row small mb-1"><span class="grow">BOT_TOKEN</span><b>${s.bot_token ? '✅' : '⚠️'}</b></div>
          <div class="row small mb-1"><span class="grow">SMTP</span><b>${s.smtp ? '✅' : '⚠️ —' + t('auth.email_not_configured')}</b></div>
          <div class="row small mb-1"><span class="grow">Daily gen limit</span><b>${s.limits.gen_daily}</b></div>
          <div class="row small mb-1"><span class="grow">Welcome credits</span><b>${s.limits.welcome_credits}</b></div>
          <div class="row small"><span class="grow">PUBLIC_URL</span><b class="small">${escapeHtml(s.public_url)}</b></div>
          <div class="divider"></div>
          <p class="muted small">Limits are set via environment variables (see .env.example). Prices are stored in the database and applied instantly.</p>
        </div>
      </div>`;
    body.querySelector('#savePricing').addEventListener('click', async () => {
      try {
        await api('/api/admin/settings', {
          method: 'PUT',
          body: {
            image: +body.querySelector('#prImage').value,
            video: +body.querySelector('#prVideo').value,
            model_3d: +body.querySelector('#pr3d').value,
            text: +body.querySelector('#prText').value,
          },
        });
        toast(t('admin.saved'), 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  load();
}
