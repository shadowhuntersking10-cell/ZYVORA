import { NavLink } from 'react-router-dom';
import { useT } from '../lib/i18n';
import { usePrefsStore } from '../store/prefs';
import { useAuthStore } from '../store/auth';
import { useProjectStore, type StudioId } from '../store/project';
import { WORKSPACE_STUDIOS } from '../studios/registry';

const ACCOUNT_ITEMS: { to: string; key: string; abbr: string; status?: 'coming_soon' }[] = [
  { to: '/app/dashboard', key: 'nav.dashboard', abbr: 'DB' },
  { to: '/app/projects', key: 'nav.projects', abbr: 'PR' },
  { to: '/app/create-ai', key: 'nav.create_ai', abbr: 'AI', status: 'coming_soon' },
  { to: '/app/asset-library', key: 'nav.asset_library', abbr: 'AS', status: 'coming_soon' },
  { to: '/app/render-queue', key: 'nav.render_queue', abbr: 'RQ' },
  { to: '/app/team', key: 'nav.team', abbr: 'TM', status: 'coming_soon' },
  { to: '/app/marketplace', key: 'nav.marketplace', abbr: 'MP', status: 'coming_soon' },
  { to: '/app/settings', key: 'nav.settings', abbr: 'ST' },
];

const linkBase = 'flex items-center gap-2.5 rounded-token px-2.5 py-2 text-sm transition';
const linkActive = 'bg-accent/15 text-accent font-medium';
const linkIdle = 'text-muted hover:bg-surface2 hover:text-text';

function Abbr({ children }: { children: string }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface2 text-[10px] font-semibold tracking-wide">
      {children}
    </span>
  );
}

export function Sidebar() {
  const t = useT();
  const collapsed = usePrefsStore((s) => s.sidebarCollapsed);
  const lastProjectId = usePrefsStore((s) => s.lastProjectId);
  const activeStudio = useProjectStore((s) => s.activeStudio);
  const user = useAuthStore((s) => s.user);

  const studioTo = (id: StudioId) =>
    lastProjectId && useProjectStore.getState().meta ? `/app/projects/${lastProjectId}/${id}` : `/app/studio/${id}`;

  return (
    <aside
      aria-label="Main navigation"
      className={`flex h-full shrink-0 flex-col border-r border-border bg-surface transition-[width] ${collapsed ? 'w-14' : 'w-60'}`}
    >
      <div className="flex h-12 items-center gap-2 px-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-accent text-xs font-bold text-accent-contrast">Z</span>
        {!collapsed && <span className="font-semibold tracking-wide">ZYVORA</span>}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4 text-sm">
        {!collapsed && <p className="label px-2.5 pt-3">{t('nav.global')}</p>}
        <ul className="space-y-0.5">
          {ACCOUNT_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} title={collapsed ? t(item.key) : undefined}
                className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkIdle}`}>
                <Abbr>{item.abbr}</Abbr>
                {!collapsed && <span className="truncate">{t(item.key)}</span>}
                {!collapsed && item.status === 'coming_soon' && (
                  <span className="ml-auto text-[10px] text-muted">{t('common.coming_soon')}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        {!collapsed && <p className="label px-2.5 pt-4">{t('nav.workspace')}</p>}
        <ul className="space-y-0.5">
          {WORKSPACE_STUDIOS.map((s) => (
            <li key={s.id}>
              <NavLink to={studioTo(s.id)} title={collapsed ? t(s.labelKey) : undefined}
                className={() => `${linkBase} ${activeStudio === s.id ? linkActive : linkIdle}`}>
                <Abbr>{s.abbr}</Abbr>
                {!collapsed && <span className="truncate">{t(s.labelKey)}</span>}
                {!collapsed && s.status === 'coming_soon' && (
                  <span className="ml-auto text-[10px] text-muted">{t('common.coming_soon')}</span>
                )}
                {!collapsed && s.status === 'partial' && (
                  <span className="ml-auto text-[10px] text-warn">{t('common.partial')}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        {user?.role === 'admin' && (
          <>
            {!collapsed && <p className="label px-2.5 pt-4">{t('nav.global')}</p>}
            <NavLink to="/app/admin" className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkIdle}`}>
              <Abbr>AD</Abbr>
              {!collapsed && <span>{t('nav.admin')}</span>}
            </NavLink>
          </>
        )}
      </nav>
    </aside>
  );
}
