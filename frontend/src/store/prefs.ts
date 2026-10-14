import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'en' | 'uz' | 'ru';
export type Theme = 'light' | 'dark';

interface PrefsState {
  lang: Lang;
  theme: Theme;
  sidebarCollapsed: boolean;
  lastProjectId: string | null;
  setLastProjectId: (id: string | null) => void;
  setLang: (lang: Lang) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set, get) => ({
      lang: 'en',
      theme: 'light',
      sidebarCollapsed: false,
      lastProjectId: null,
      setLastProjectId: (id) => set({ lastProjectId: id }),
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
    }),
    { name: 'zyvora-prefs' },
  ),
);

/** Applies the theme class to <html>. Called on every theme change. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
