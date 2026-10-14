import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useT } from '../lib/i18n';
import { Badge, Button, Card, Empty, ErrorText, Field, PageTitle, Spinner } from '../components/ui';
import type { AIJob } from '../ai/AIRunner';
import { useAuthStore, type User } from '../store/auth';
import { usePrefsStore, applyTheme, type Lang } from '../store/prefs';
import { ComingSoonCenter } from '../studios/ComingSoonStudio';
import { WORKSPACE_STUDIOS } from '../studios/registry';
import { useProjectStore } from '../store/project';

export interface ProjectRow {
  id: string;
  name: string;
  folder: string;
  version: number;
  updated_at: string;
}

const statusTone = (s: AIJob['status']) =>
  s === 'succeeded' ? 'ok' : s === 'failed' ? 'danger' : s === 'running' ? 'accent' : 'warn';

export function DashboardPage(): ReactElement {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [jobs, setJobs] = useState<AIJob[] | null>(null);
  useEffect(() => {
    void api<ProjectRow[]>('/api/projects').then(setProjects).catch(() => setProjects([]));
    void api<AIJob[]>('/api/ai/jobs').then(setJobs).catch(() => setJobs([]));
    void api<User>('/api/auth/me').then((u) => useAuthStore.getState().setUser(u)).catch(() => undefined);
  }, []);
  const running = (jobs ?? []).filter((j) => j.status === 'running');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const spent = (jobs ?? []).filter((j) => new Date(j.created_at).getTime() >= monthStart)
    .reduce((n, j) => n + j.charged_credits, 0);
  return (
    <div className="p-5">
      <PageTitle title={`${t('dash.title')}${user ? ` · ${user.name}` : ''}`} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title={t('dash.credits')}>
          <p className="text-3xl font-semibold">{user?.credit_balance ?? 0}</p>
          <p className="mt-1 text-xs text-muted">Spent this month: {spent} cr</p>
        </Card>
        <Card title={t('dash.quick')}>
          <div className="flex flex-col gap-2">
            <QuickCreate />
            <Link to="/app/studio/3d"><Button size="sm" className="w-full">{t('nav.3d')}</Button></Link>
          </div>
        </Card>
        <Card title={t('dash.jobs')}>
          <p className="text-sm">Running: <b>{running.length}</b></p>
          <Link className="text-xs text-accent hover:underline" to="/app/render-queue">{t('nav.render_queue')} →</Link>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t('dash.recent')}>
          {projects === null ? <Spinner /> : projects.length === 0 ? <Empty>{t('dash.no_projects')}</Empty> : (
            <ul className="divide-y divide-border text-sm">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <Link to={`/app/projects/${p.id}/3d`} className="truncate hover:text-accent">{p.name}</Link>
                  <span className="text-xs text-muted">{new Date(p.updated_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('dash.jobs')}>
          {jobs === null ? <Spinner /> : jobs.length === 0 ? <Empty>{t('dash.no_jobs')}</Empty> : (
            <ul className="divide-y divide-border text-sm">
              {jobs.slice(0, 6).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="truncate">{j.provider} · {j.task}</span>
                  <Badge tone={statusTone(j.status)}>{j.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function QuickCreate(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const p = await api<ProjectRow>('/api/projects', { method: 'POST', body: { name: t('top.untitled') } });
      navigate(`/app/projects/${p.id}/3d`);
    } finally {
      setBusy(false);
    }
  };
  return <Button size="sm" variant="primary" className="w-full" onClick={create} disabled={busy}>{t('projects.new')}</Button>;
}

export function ProjectsPage(): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (folder) params.set('folder', folder);
    try {
      setProjects(await api<ProjectRow[]>(`/api/projects?${params.toString()}`));
      setFolders(await api<string[]>('/api/projects/folders'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.error'));
    }
  };
  useEffect(() => {
    const id = setTimeout(() => void load(), 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, folder]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const p = await api<ProjectRow>('/api/projects', { method: 'POST', body: { name: newName || t('top.untitled') } });
      navigate(`/app/projects/${p.id}/3d`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    await api(`/api/projects/${renaming.id}`, { method: 'PATCH', body: { name: renaming.name } });
    setRenaming(null);
    void load();
  };
  const duplicate = async (id: string) => {
    await api(`/api/projects/${id}/duplicate`, { method: 'POST' });
    void load();
  };
  const remove = async (p: ProjectRow) => {
    if (!window.confirm(`${t('projects.delete')}: ${p.name}?`)) return;
    await api(`/api/projects/${p.id}`, { method: 'DELETE' });
    if (useProjectStore.getState().meta?.id === p.id) useProjectStore.getState().closeProject();
    void load();
  };

  return (
    <div className="p-5">
      <PageTitle title={t('projects.title')} />
      <form onSubmit={create} className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={t('projects.name_prompt')} value={newName} maxLength={200}
          onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" variant="primary">{t('projects.new')}</Button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" type="search" placeholder={t('projects.search')} value={q}
          onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
        <select className="input max-w-[12rem]" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={t('projects.folder')}>
          <option value="">{t('projects.folder')}: *</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <ErrorText>{error}</ErrorText>
      {projects === null ? <Spinner /> : projects.length === 0 ? <Empty>{t('projects.empty')}</Empty> : (
        <div className="overflow-x-auto rounded-token border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface2 text-xs text-muted">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">{t('projects.folder')}</th><th className="px-3 py-2">v</th><th className="px-3 py-2">Updated</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.map((p) => (
                <tr key={p.id} className="bg-surface">
                  <td className="px-3 py-2">
                    {renaming?.id === p.id ? (
                      <form onSubmit={rename} className="flex gap-1">
                        <input className="input py-1" value={renaming.name} maxLength={200} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} />
                        <Button size="sm" type="submit">{t('common.save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
                      </form>
                    ) : (
                      <Link to={`/app/projects/${p.id}/3d`} className="font-medium hover:text-accent">{p.name}</Link>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{p.folder}</td>
                  <td className="px-3 py-2 text-muted">{p.version}</td>
                  <td className="px-3 py-2 text-muted">{new Date(p.updated_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: p.id, name: p.name })}>{t('projects.rename')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => duplicate(p.id)}>{t('projects.duplicate')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(p)}>{t('projects.delete')}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Opened from the sidebar when no project is open: pick or create one, then the studio opens inside it. */
export function StudioGatePage({ studioId }: { studioId: string }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const def = WORKSPACE_STUDIOS.find((s) => s.id === studioId);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  useEffect(() => {
    void api<ProjectRow[]>('/api/projects').then(setProjects).catch(() => setProjects([]));
  }, []);
  if (!def) return <Empty>{t('common.error')}</Empty>;
  if (!def.load) return <ComingSoonCenter title={t(def.labelKey)} />;
  return (
    <div className="p-5">
      <PageTitle title={t(def.labelKey)} subtitle={t('projects.title')} />
      {projects === null ? <Spinner /> : projects.length === 0 ? (
        <Card title={t('projects.new')}>
          <Button variant="primary" onClick={async () => {
            const p = await api<ProjectRow>('/api/projects', { method: 'POST', body: { name: t('top.untitled') } });
            navigate(`/app/projects/${p.id}/${def.id}`);
          }}>{t('projects.new')}</Button>
        </Card>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link to={`/app/projects/${p.id}/${def.id}`} className="panel block p-3 hover:border-accent">
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-muted">{t('common.open')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RenderQueuePage(): ReactElement {
  const t = useT();
  const [jobs, setJobs] = useState<AIJob[] | null>(null);
  const load = () => void api<AIJob[]>('/api/ai/jobs').then(setJobs).catch(() => setJobs([]));
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="p-5">
      <PageTitle title={t('nav.render_queue')}
        subtitle="AI generation jobs are shown here. Video/Blender renders are not connected yet and are not queued." />
      {jobs === null ? <Spinner /> : jobs.length === 0 ? <Empty>{t('dash.no_jobs')}</Empty> : (
        <div className="overflow-x-auto rounded-token border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface2 text-xs text-muted">
              <tr><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Task</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Credits</th><th className="px-3 py-2">Error</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.map((j) => (
                <tr key={j.id} className="bg-surface">
                  <td className="px-3 py-2">{j.provider}</td>
                  <td className="px-3 py-2">{j.task}</td>
                  <td className="px-3 py-2"><Badge tone={statusTone(j.status)}>{j.status}</Badge></td>
                  <td className="px-3 py-2">{j.charged_credits}</td>
                  <td className="px-3 py-2 text-xs text-muted">{j.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Retry: <Badge tone="muted">{t('common.coming_soon')}</Badge></p>
    </div>
  );
}

export function SettingsPage(): ReactElement {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const lang = usePrefsStore((s) => s.lang);
  const setLang = usePrefsStore((s) => s.setLang);
  const theme = usePrefsStore((s) => s.theme);
  const setTheme = usePrefsStore((s) => s.setTheme);
  const [name, setName] = useState(user?.name ?? '');
  const [avatar, setAvatar] = useState(user?.avatar_url ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [sessions, setSessions] = useState<{ id: string; user_agent: string | null; ip: string | null; created_at: string; current: boolean }[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletePw, setDeletePw] = useState('');
  const navigate = useNavigate();

  const loadSessions = () => void api<typeof sessions>('/api/auth/me/sessions').then(setSessions).catch(() => setSessions([]));
  useEffect(loadSessions, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const u = await api<User>('/api/auth/me', { method: 'PATCH', body: { name, avatar_url: avatar || null } });
      useAuthStore.getState().setUser(u);
      setMsg(t('settings.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/auth/me/password', { method: 'POST', body: { current_password: current, new_password: next } });
      setCurrent('');
      setNext('');
      setMsg(t('settings.saved'));
      loadSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };
  const revoke = async (id: string) => {
    await api(`/api/auth/me/sessions/${id}`, { method: 'DELETE' });
    loadSessions();
  };
  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(t('settings.delete_account') + '?')) return;
    try {
      await api('/api/auth/me/delete', { method: 'POST', body: { password: deletePw } });
      useAuthStore.getState().clear();
      useProjectStore.getState().closeProject();
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.error'));
    }
  };

  return (
    <div className="space-y-4 p-5">
      <PageTitle title={t('settings.title')} />
      <ErrorText>{error}</ErrorText>
      {msg && <p className="text-sm text-ok">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('settings.profile')}>
          <form onSubmit={saveProfile} className="space-y-3">
            <Field label={t('auth.name')}><input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t('auth.email')} hint="—"><input className="input" value={user?.email ?? ''} disabled /></Field>
            <Field label="Avatar URL" hint="https:// or a relative path"><input className="input" value={avatar} onChange={(e) => setAvatar(e.target.value)} maxLength={500} /></Field>
            <Button type="submit" variant="primary">{t('common.save')}</Button>
          </form>
        </Card>
        <Card title={t('settings.password')}>
          <form onSubmit={changePassword} className="space-y-3">
            <Field label={t('settings.current_password')}><input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label={t('settings.new_password')}><input className="input" type="password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </Card>
        <Card title={t('settings.language')}>
          <div className="flex flex-wrap gap-2">
            {(['uz', 'en', 'ru'] as Lang[]).map((l) => (
              <Button key={l} size="sm" variant={lang === l ? 'primary' : 'secondary'} onClick={() => setLang(l)}>
                {l === 'uz' ? 'O‘zbek' : l === 'en' ? 'English' : 'Русский'}
              </Button>
            ))}
          </div>
          <p className="label mt-4">{t('settings.theme')}</p>
          <div className="flex gap-2">
            <Button size="sm" variant={theme === 'light' ? 'primary' : 'secondary'} onClick={() => { setTheme('light'); applyTheme('light'); }}>{t('settings.light')}</Button>
            <Button size="sm" variant={theme === 'dark' ? 'primary' : 'secondary'} onClick={() => { setTheme('dark'); applyTheme('dark'); }}>{t('settings.dark')}</Button>
          </div>
        </Card>
        <Card title={t('settings.sessions')}>
          {sessions === null ? <Spinner /> : (
            <ul className="divide-y divide-border text-sm">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate">{s.user_agent ?? '—'}</p>
                    <p className="text-xs text-muted">{s.ip ?? '—'} · {new Date(s.created_at).toLocaleString()}</p>
                  </div>
                  {s.current ? <Badge tone="ok">{t('settings.current')}</Badge> : (
                    <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>{t('settings.revoke')}</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Help & privacy">
          <p className="text-sm text-muted">Guides, bug report form, notification and privacy settings: <Badge tone="muted">{t('common.coming_soon')}</Badge></p>
          <p className="mt-2 text-sm text-muted">Storage usage: <Badge tone="muted">{t('common.not_connected')}</Badge> (S3 not configured)</p>
        </Card>
        <Card title={t('settings.delete_account')}>
          <form onSubmit={deleteAccount} className="space-y-3">
            <Field label={t('settings.current_password')}><input className="input" type="password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} /></Field>
            <Button type="submit" variant="danger" disabled={!deletePw}>{t('settings.delete_account')}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

export function ComingSoonPage({ titleKey }: { titleKey: string }): ReactElement {
  const t = useT();
  return <ComingSoonCenter title={t(titleKey)} />;
}
