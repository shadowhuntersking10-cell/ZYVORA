import { useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { Badge, Button, Card, Empty, ErrorText, Field, PageTitle, Spinner } from '../../components/ui';
import { useAuthStore } from '../../store/auth';

/* Admin strings are English-only for now; see the status table. */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  plan: string;
  is_blocked: boolean;
  email_verified: boolean;
  credit_balance: number;
  created_at: string;
  last_login_at: string | null;
}

export function AdminLayout(): ReactElement {
  const t = useT();
  const items = [
    { to: '/app/admin', label: 'Dashboard', end: true },
    { to: '/app/admin/users', label: 'Users' },
    { to: '/app/admin/ai', label: 'AI & API' },
    { to: '/app/admin/billing', label: 'Credits & Billing' },
    { to: '/app/admin/payments', label: 'Payments & Orders' },
    { to: '/app/admin/system', label: 'Jobs & System' },
    { to: '/app/admin/security', label: 'Security & Audit' },
    { to: '/app/admin/settings', label: 'Platform Settings' },
  ];
  return (
    <div className="flex min-h-full">
      <aside className="w-52 shrink-0 border-r border-border bg-surface p-3">
        <p className="label px-2">{t('admin.title')}</p>
        <nav className="space-y-0.5 text-sm">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => `block rounded-token px-2.5 py-1.5 ${isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface2 hover:text-text'}`}>
              {i.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 p-5">
        <Outlet />
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return connected ? <Badge tone="ok">Connected</Badge> : <Badge tone="muted">Not connected</Badge>;
}

export function AdminDashboard(): ReactElement {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Record<string, unknown>>('/api/admin/stats').then(setStats).catch((e: unknown) => setErr(e instanceof ApiError ? e.message : 'error'));
  }, []);
  if (err) return <ErrorText>{err}</ErrorText>;
  if (!stats) return <Spinner />;
  const n = (k: string) => Number(stats[k] ?? 0);
  const gw = stats.payments_gateway as { connected: boolean };
  return (
    <div>
      <PageTitle title="Dashboard" subtitle="Real database counts. Zero means there is no data yet." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Users" value={n('users_total')} note={`${n('users_blocked')} blocked`} />
        <Stat label="New signups (24h / 7d)" value={`${n('signups_24h')} / ${n('signups_7d')}`} />
        <Stat label="Projects" value={n('projects_total')} />
        <Stat label="AI jobs" value={n('ai_jobs_total')} note={`${n('ai_jobs_failed')} failed · ${n('ai_jobs_not_connected')} not connected`} />
        <Stat label="Login failures (24h)" value={n('login_failures_24h')} />
        <Stat label="Confirmed payments" value={n('confirmed_payments')} note={gw.connected ? 'Gateway connected' : 'No payment gateway connected'} />
        <Stat label="Credits granted (all time)" value={n('credits_granted_total')} />
      </div>
    </div>
  );
}

export function AdminUsers(): ReactElement {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ total: number; items: AdminUser[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 25;
  useEffect(() => {
    const id = setTimeout(() => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (q) params.set('q', q);
      void api<{ total: number; items: AdminUser[] }>(`/api/admin/users?${params.toString()}`).then(setData);
    }, 200);
    return () => clearTimeout(id);
  }, [q, offset]);
  return (
    <div>
      <PageTitle title="Users" subtitle={data ? `${data.total} total` : undefined} />
      <input className="input mb-3 max-w-sm" type="search" placeholder="Search name or email" value={q}
        onChange={(e) => { setOffset(0); setQ(e.target.value); }} aria-label="Search users" />
      {!data ? <Spinner /> : data.items.length === 0 ? <Empty>No users match.</Empty> : (
        <div className="overflow-x-auto rounded-token border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface2 text-xs text-muted">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Credits</th><th className="px-3 py-2">Joined</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((u) => (
                <tr key={u.id} className="cursor-pointer bg-surface hover:bg-surface2" onClick={() => navigate(`/app/admin/users/${u.id}`)}>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2 text-muted">{u.email}</td>
                  <td className="px-3 py-2">{u.role}</td>
                  <td className="px-3 py-2">{u.plan}</td>
                  <td className="px-3 py-2">{u.is_blocked ? <Badge tone="danger">blocked</Badge> : <Badge tone="ok">active</Badge>}</td>
                  <td className="px-3 py-2">{u.credit_balance}</td>
                  <td className="px-3 py-2 text-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > limit && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>‹</Button>
          <Button size="sm" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>›</Button>
        </div>
      )}
    </div>
  );
}

interface UserDetail extends AdminUser {
  projects: number;
  ai_jobs: number;
  active_sessions: number;
  monthly_ai_limit: number;
  credit_ledger: { delta: number; balance_after: number; reason: string; reference: string | null; created_at: string }[];
}

export function AdminUserDetail(): ReactElement {
  const { userId = '' } = useParams();
  const me = useAuthStore((s) => s.user);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [credits, setCredits] = useState(0);
  const [creditReason, setCreditReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api<UserDetail>(`/api/admin/users/${userId}`).then(setUser).catch((e: unknown) => setErr(e instanceof ApiError ? e.message : 'error'));
  useEffect(() => { void load(); }, [userId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg('Saved');
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'error');
    }
  };

  if (err && !user) return <ErrorText>{err}</ErrorText>;
  if (!user) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageTitle title={user.name} subtitle={user.email}
        actions={<Link className="text-sm text-accent hover:underline" to="/app/admin/users">← Users</Link>} />
      <ErrorText>{err}</ErrorText>
      {msg && <p className="text-sm text-ok">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Role</dt><dd>{user.role}</dd>
            <dt className="text-muted">Plan</dt><dd>{user.plan}</dd>
            <dt className="text-muted">Verified</dt><dd>{user.email_verified ? 'yes' : 'no'}</dd>
            <dt className="text-muted">Projects</dt><dd>{user.projects}</dd>
            <dt className="text-muted">AI jobs</dt><dd>{user.ai_jobs}</dd>
            <dt className="text-muted">Sessions</dt><dd>{user.active_sessions}</dd>
            <dt className="text-muted">Monthly AI limit</dt><dd>{user.monthly_ai_limit} cr</dd>
            <dt className="text-muted">Balance</dt><dd>{user.credit_balance} cr</dd>
          </dl>
        </Card>
        <Card title="Access">
          <div className="space-y-3 text-sm">
            <div className="flex gap-2">
              <Button size="sm" disabled={user.id === me?.id}
                onClick={() => act(() => api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { role: user.role === 'admin' ? 'user' : 'admin' } }))}>
                {user.role === 'admin' ? 'Remove admin' : 'Make admin'}
              </Button>
            </div>
            <Field label="Plan">
              <select className="input" value={user.plan} onChange={(e) => act(() => api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { plan: e.target.value } }))}>
                <option value="free">free</option><option value="pro">pro</option><option value="studio">studio</option>
              </select>
            </Field>
            <Field label="Reason (optional)">
              <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {user.is_blocked ? (
              <Button size="sm" variant="primary" onClick={() => act(() => api(`/api/admin/users/${user.id}/block`, { method: 'POST', body: { blocked: false, reason } }))}>Restore</Button>
            ) : (
              <Button size="sm" variant="danger" disabled={user.id === me?.id}
                onClick={() => act(() => api(`/api/admin/users/${user.id}/block`, { method: 'POST', body: { blocked: true, reason } }))}>Block</Button>
            )}
          </div>
        </Card>
        <Card title="Credits">
          <form className="space-y-3 text-sm" onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void act(() => api(`/api/admin/users/${user.id}/credits`, { method: 'POST', body: { delta: credits, reason: creditReason } }));
          }}>
            <Field label="Delta (negative removes)">
              <input className="input" type="number" value={credits} onChange={(e) => setCredits(Number(e.target.value))} />
            </Field>
            <Field label="Reason (required)">
              <input className="input" required minLength={3} maxLength={200} value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" variant="primary">Apply</Button>
          </form>
        </Card>
      </div>
      <Card title="Credit ledger">
        {user.credit_ledger.length === 0 ? <Empty>No balance changes yet.</Empty> : (
          <table className="w-full text-left text-xs">
            <thead className="text-muted"><tr><th className="py-1">When</th><th>Delta</th><th>Balance</th><th>Reason</th></tr></thead>
            <tbody className="divide-y divide-border">
              {user.credit_ledger.map((e, i) => (
                <tr key={i}><td className="py-1">{new Date(e.created_at).toLocaleString()}</td><td>{e.delta}</td><td>{e.balance_after}</td><td>{e.reason}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

interface ProviderRow {
  provider: string; label: string; connected: boolean;
  tasks: { task: string; unit_cost: number; kind: string }[];
  jobs_total: number; jobs_failed: number; credits_charged: number;
}

export function AdminAI(): ReactElement {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  useEffect(() => { void api<ProviderRow[]>('/api/admin/providers').then(setRows); }, []);
  return (
    <div>
      <PageTitle title="AI & API" subtitle="Keys are set in the server environment (.env). They are never shown here." />
      {!rows ? <Spinner /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.provider} title={r.label} actions={<ConnectionBadge connected={r.connected} />}>
              <ul className="space-y-1 text-xs text-muted">
                {r.tasks.map((t) => <li key={t.task}>{t.task} · {t.unit_cost} cr / unit · {t.kind}</li>)}
              </ul>
              <p className="mt-2 text-xs">Jobs: {r.jobs_total} · failed: {r.jobs_failed} · credits charged: {r.credits_charged}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminBilling(): ReactElement {
  return (
    <div>
      <PageTitle title="Credits & Billing" subtitle="Balance changes are written to the credit ledger (see each user's detail page)." />
      <Card title="Credit packages & plans">
        <p className="text-sm text-muted">No credit packages are configured. Plan monthly AI limits are enforced by the server (free 500 · pro 5 000 · studio 50 000 credits).</p>
        <p className="mt-2 text-sm text-muted">Packages and purchases need a payment gateway: <Badge tone="muted">Not connected</Badge></p>
      </Card>
    </div>
  );
}

export function AdminPayments(): ReactElement {
  const [data, setData] = useState<{ gateway: { provider: string; connected: boolean }; orders: unknown[]; subscriptions: unknown[]; refunds: unknown[] } | null>(null);
  useEffect(() => { void api<typeof data>('/api/admin/payments').then(setData); }, []);
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageTitle title="Payments & Orders" />
      <Card title="Gateway" actions={<ConnectionBadge connected={data.gateway.connected} />}>
        <p className="text-sm text-muted">
          {data.gateway.connected
            ? 'Stripe is configured. Webhooks are verified server-side.'
            : 'Stripe is not configured. Orders, subscriptions and refunds are not shown as working until a gateway is connected.'}
        </p>
      </Card>
      <Card title="Orders"><Empty>No orders.</Empty></Card>
      <Card title="Subscriptions"><Empty>No subscriptions.</Empty></Card>
      <Card title="Refunds"><Empty>No refunds.</Empty></Card>
    </div>
  );
}

interface SystemInfo {
  environment: string;
  database: { connected: boolean; engine: string };
  email: { connected: boolean; reason?: string };
  storage: { connected: boolean; reason: string | null };
  redis_queue: { connected: boolean; reason: string | null };
  render_worker: { connected: boolean; reason: string | null };
  payments: { connected: boolean; reason: string | null };
  limits: { max_upload_mb: number; max_document_kb: number };
}

export function AdminSystem(): ReactElement {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [jobs, setJobs] = useState<{ id: string; provider: string; task: string; status: string; error: string | null; created_at: string }[] | null>(null);
  const [filter, setFilter] = useState('failed');
  useEffect(() => {
    void api<SystemInfo>('/api/admin/system').then(setSys);
  }, []);
  useEffect(() => {
    void api<typeof jobs>(`/api/admin/jobs${filter ? `?status_filter=${filter}` : ''}`).then(setJobs);
  }, [filter]);
  if (!sys) return <Spinner />;
  const rows: [string, { connected: boolean; reason?: string | null }][] = [
    ['Database', sys.database],
    ['Email', sys.email],
    ['Object storage (S3)', sys.storage],
    ['Queue (Redis)', sys.redis_queue],
    ['Render worker (Blender/ffmpeg)', sys.render_worker],
    ['Payments (Stripe)', sys.payments],
  ];
  return (
    <div className="space-y-4">
      <PageTitle title="Jobs & System" subtitle={`Environment: ${sys.environment}`} />
      <Card title="Services">
        <ul className="divide-y divide-border text-sm">
          {rows.map(([name, s]) => (
            <li key={name} className="flex items-center justify-between py-2">
              <span>{name}{s.reason ? <span className="ml-2 text-xs text-muted">{s.reason}</span> : null}</span>
              <ConnectionBadge connected={s.connected} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="AI jobs" actions={
        <select className="input max-w-[10rem] py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          <option value="">all</option><option value="failed">failed</option><option value="not_connected">not connected</option><option value="running">running</option><option value="succeeded">succeeded</option>
        </select>
      }>
        {!jobs ? <Spinner /> : jobs.length === 0 ? <Empty>No jobs for this filter.</Empty> : (
          <ul className="divide-y divide-border text-xs">
            {jobs.slice(0, 100).map((j) => (
              <li key={j.id} className="flex flex-wrap gap-2 py-1.5">
                <span className="w-40 text-muted">{new Date(j.created_at).toLocaleString()}</span>
                <span className="w-24">{j.provider}</span>
                <span className="w-28">{j.task}</span>
                <Badge tone={j.status === 'failed' ? 'danger' : j.status === 'succeeded' ? 'ok' : 'warn'}>{j.status}</Badge>
                <span className="text-muted">{j.error ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">Limits: upload {sys.limits.max_upload_mb} MB · project document {sys.limits.max_document_kb} KB. Safe retry of failed jobs: <Badge tone="muted">Coming soon</Badge></p>
    </div>
  );
}

export function AdminSecurity(): ReactElement {
  const [rows, setRows] = useState<{ id: string; actor_id: string | null; action: string; target: string | null; ip: string | null; created_at: string }[] | null>(null);
  const [action, setAction] = useState('');
  useEffect(() => {
    void api<typeof rows>(`/api/admin/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ''}`).then(setRows);
  }, [action]);
  return (
    <div>
      <PageTitle title="Security & Audit" subtitle="Admin actions, permission changes and security events." />
      <div className="mb-3 flex flex-wrap gap-2">
        {['', 'admin.', 'auth.login', 'auth.', 'project.', 'ai.'].map((a) => (
          <Button key={a} size="sm" variant={action === a ? 'primary' : 'secondary'} onClick={() => setAction(a)}>{a || 'all'}</Button>
        ))}
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty>No audit entries yet.</Empty> : (
        <div className="overflow-x-auto rounded-token border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface2 text-muted"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">IP</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="bg-surface">
                  <td className="px-3 py-1.5 text-muted">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-1.5">{r.action}</td>
                  <td className="px-3 py-1.5 text-muted">{r.actor_id ?? '—'}</td>
                  <td className="px-3 py-1.5 text-muted">{r.target ?? '—'}</td>
                  <td className="px-3 py-1.5 text-muted">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AdminSettings(): ReactElement {
  return (
    <div className="space-y-4">
      <PageTitle title="Platform Settings" subtitle="Read-only in this build. Editing is Coming soon." />
      <Card title="Site">
        <p className="text-sm text-muted">Site name, logo, default language and theme: <Badge tone="muted">Coming soon</Badge></p>
        <p className="mt-2 text-sm text-muted">Environment variables control keys, limits and services (see .env.example).</p>
      </Card>
    </div>
  );
}
