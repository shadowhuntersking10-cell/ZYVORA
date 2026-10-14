import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import { applyTheme, usePrefsStore, type Lang } from '../store/prefs';
import { useAuthStore } from '../store/auth';
import { useProjectStore, type SaveStatus } from '../store/project';

const SAVE_TONE: Record<SaveStatus, string> = {
  idle: 'text-muted',
  saved: 'text-ok',
  saving: 'text-muted',
  dirty: 'text-warn',
  error: 'text-danger',
  conflict: 'text-danger',
};

export function TopBar() {
  const t = useT();
  const navigate = useNavigate();
  const meta = useProjectStore((s) => s.meta);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const renameProject = useProjectStore((s) => s.renameProject);
  const lang = usePrefsStore((s) => s.lang);
  const setLang = usePrefsStore((s) => s.setLang);
  const theme = usePrefsStore((s) => s.theme);
  const toggleTheme = usePrefsStore((s) => s.toggleTheme);
  const toggleSidebar = usePrefsStore((s) => s.toggleSidebar);
  const user = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const saveLabel: Record<SaveStatus, string> = {
    idle: t('save.idle'),
    saved: t('save.saved'),
    saving: t('save.saving'),
    dirty: t('save.dirty'),
    error: t('save.error'),
    conflict: t('save.conflict'),
  };

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', auth: false });
    } catch {
      /* ignore: local state is cleared regardless */
    }
    useAuthStore.getState().clear();
    useProjectStore.getState().closeProject();
    navigate('/login');
  };

  const commitName = async () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== meta?.name) await renameProject(draft);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 text-sm">
      <button type="button" onClick={toggleSidebar} className="rounded p-1.5 text-muted hover:bg-surface2 hover:text-text"
        aria-label={t('nav.collapse')} title={t('nav.collapse')}>☰</button>

      <div className="min-w-0 flex-1">
        {meta ? (
          editing ? (
            <input autoFocus className="input h-8 w-64 py-1" value={draft} maxLength={200}
              onChange={(e) => setDraft(e.target.value)} onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitName(); if (e.key === 'Escape') setEditing(false); }} />
          ) : (
            <button type="button" className="max-w-xs truncate rounded px-2 py-1 font-medium hover:bg-surface2"
              title={meta.name} onClick={() => { setDraft(meta.name); setEditing(true); }}>
              {meta.name || t('top.untitled')}
            </button>
          )
        ) : (
          <span className="px-2 text-muted">{t('top.no_project')}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo || !meta} title={`${t('top.undo')} (Ctrl+Z)`}>↶ {t('top.undo')}</Button>
        <Button size="sm" variant="ghost" onClick={redo} disabled={!canRedo || !meta} title={`${t('top.redo')} (Ctrl+Shift+Z)`}>↷ {t('top.redo')}</Button>
        <Button size="sm" variant="secondary" disabled title={t('share.coming')}>{t('top.share')}</Button>
      </div>

      <span className={`hidden whitespace-nowrap text-xs md:inline ${SAVE_TONE[saveStatus]}`} aria-live="polite">
        ● {saveLabel[saveStatus]}
      </span>

      <span className="hidden whitespace-nowrap rounded-token bg-surface2 px-2 py-1 text-xs lg:inline" title={t('top.credits')}>
        {t('top.credits')}: <b>{user?.credit_balance ?? 0}</b>
      </span>

      <label className="sr-only" htmlFor="lang-switch">{t('top.language')}</label>
      <select id="lang-switch" value={lang} onChange={(e) => setLang(e.target.value as Lang)}
        className="rounded-token border border-border bg-bg px-1.5 py-1 text-xs">
        <option value="uz">O‘zbek</option>
        <option value="en">English</option>
        <option value="ru">Русский</option>
      </select>

      <button type="button" onClick={() => { toggleTheme(); applyTheme(usePrefsStore.getState().theme); }}
        className="rounded p-1.5 text-muted hover:bg-surface2 hover:text-text" aria-label={t('top.theme')} title={t('top.theme')}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>

      <button type="button" onClick={logout} className="hidden rounded px-2 py-1 text-xs text-muted hover:bg-surface2 hover:text-text sm:inline">
        {t('top.logout')}
      </button>
    </header>
  );
}
