import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { applyCommand, type Command, CommandError } from '../domain/commands';
import { emptyDocument, normalizeDocument, type ProjectDocument } from '../domain/document';

export type StudioId =
  | 'dashboard' | 'projects' | 'create-ai' | 'asset-library' | 'render-queue' | 'team'
  | '2d' | '3d' | 'character' | 'animation' | 'cinema' | 'ai-lab' | 'audio-vfx' | 'story'
  | 'marketplace' | 'settings';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export interface HistoryEntry {
  id: number;
  studio: StudioId;
  label: string;
  before: ProjectDocument;
  after: ProjectDocument;
}

interface ProjectMeta {
  id: string;
  name: string;
  folder: string;
  version: number;
}

/** Per-studio view state (camera, zoom, timeline position). Kept when switching studios. */
export interface ViewState {
  camera?: { position: [number, number, number]; target: [number, number, number] };
  timelineFrame?: number;
  zoom?: number;
  /** Unsaved text a studio wants to keep when the user switches away (e.g. a prompt draft). */
  draft?: string;
}

interface ProjectState {
  meta: ProjectMeta | null;
  doc: ProjectDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selectedId: string | null;
  activeStudio: StudioId;
  views: Partial<Record<StudioId, ViewState>>;
  saveStatus: SaveStatus;
  saveError: string | null;
  loadError: string | null;
  loading: boolean;
  /** Last committed command, for the status bar. */
  lastLabel: string | null;

  loadProject: (id: string) => Promise<void>;
  closeProject: () => void;
  dispatch: (studio: StudioId, label: string, cmd: Command) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  select: (id: string | null) => void;
  setStudio: (studio: StudioId) => void;
  setView: (studio: StudioId, view: ViewState) => void;
  saveNow: () => Promise<void>;
  renameProject: (name: string) => Promise<void>;
}

export const HISTORY_LIMIT = 200;
const AUTOSAVE_DELAY_MS = 1500;
let entryId = 0;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight: Promise<void> | null = null;

function scheduleAutosave(get: () => ProjectState) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void get().saveNow();
  }, AUTOSAVE_DELAY_MS);
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  meta: null,
  doc: emptyDocument(),
  past: [],
  future: [],
  selectedId: null,
  activeStudio: 'dashboard',
  views: {},
  saveStatus: 'idle',
  saveError: null,
  loadError: null,
  loading: false,
  lastLabel: null,

  loadProject: async (id) => {
    // Never drop unsaved edits of the previous project: flush them first.
    if (get().saveStatus === 'dirty' && get().meta) await get().saveNow();
    set({ loading: true, loadError: null, meta: null, past: [], future: [], selectedId: null, views: {} });
    try {
      const p = await api<{ id: string; name: string; folder: string; version: number; document: unknown }>(
        `/api/projects/${id}`,
      );
      set({
        meta: { id: p.id, name: p.name, folder: p.folder, version: p.version },
        doc: normalizeDocument(p.document, p.name),
        saveStatus: 'saved',
        loading: false,
      });
    } catch (e) {
      set({ loading: false, loadError: e instanceof ApiError ? e.message : 'Could not load project' });
    }
  },

  closeProject: () => {
    if (get().saveStatus === 'dirty' && get().meta) void get().saveNow();
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    set({ meta: null, doc: emptyDocument(), past: [], future: [], selectedId: null, saveStatus: 'idle' });
  },

  dispatch: (studio, label, cmd) => {
    const { doc, past, meta } = get();
    if (!meta) return false;
    let next: ProjectDocument;
    try {
      next = applyCommand(doc, cmd);
    } catch (e) {
      if (e instanceof CommandError) {
        set({ saveError: e.message });
        return false;
      }
      throw e;
    }
    entryId += 1;
    const entry: HistoryEntry = { id: entryId, studio, label, before: doc, after: next };
    set({
      doc: next,
      past: [...past, entry].slice(-HISTORY_LIMIT),
      future: [],
      saveStatus: 'dirty',
      lastLabel: label,
      selectedId: cmd.type === 'object.remove' && get().selectedId === cmd.id ? null : get().selectedId,
    });
    scheduleAutosave(get);
    return true;
  },

  undo: () => {
    const { past, future } = get();
    const entry = past[past.length - 1];
    if (!entry) return false;
    set({ doc: entry.before, past: past.slice(0, -1), future: [...future, entry], saveStatus: 'dirty', lastLabel: `Undo: ${entry.label}` });
    scheduleAutosave(get);
    return true;
  },

  redo: () => {
    const { past, future } = get();
    const entry = future[future.length - 1];
    if (!entry) return false;
    set({ doc: entry.after, future: future.slice(0, -1), past: [...past, entry], saveStatus: 'dirty', lastLabel: `Redo: ${entry.label}` });
    scheduleAutosave(get);
    return true;
  },

  select: (id) => set({ selectedId: id }),
  setStudio: (studio) => set({ activeStudio: studio }),
  setView: (studio, view) => set({ views: { ...get().views, [studio]: { ...get().views[studio], ...view } } }),

  saveNow: async () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    const state = get();
    if (!state.meta) return;
    if (saveInFlight) {
      await saveInFlight;
      if (get().saveStatus !== 'dirty') return;
      return get().saveNow();
    }
    const { meta, doc } = state;
    set({ saveStatus: 'saving', saveError: null });
    saveInFlight = (async () => {
      try {
        const res = await api<{ version: number }>(`/api/projects/${meta.id}/document`, {
          method: 'PUT',
          body: { document: doc, base_version: meta.version },
        });
        // The project may have been closed or switched while the request was in flight.
        if (get().meta?.id !== meta.id) return;
        // Only mark saved if nothing changed while the request was in flight.
        const stillSameDoc = get().doc === doc;
        set({
          meta: { ...meta, version: res.version },
          saveStatus: stillSameDoc ? 'saved' : 'dirty',
        });
        if (!stillSameDoc) scheduleAutosave(get);
      } catch (e) {
        if (get().meta?.id !== meta.id) return;
        if (e instanceof ApiError && e.status === 409) {
          set({ saveStatus: 'conflict', saveError: e.message });
        } else {
          set({ saveStatus: 'error', saveError: e instanceof Error ? e.message : 'Save failed' });
        }
      } finally {
        saveInFlight = null;
      }
    })();
    await saveInFlight;
  },

  renameProject: async (name) => {
    const meta = get().meta;
    if (!meta) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    await api(`/api/projects/${meta.id}`, { method: 'PATCH', body: { name: trimmed } });
    set({ meta: { ...meta, name: trimmed } });
  },
}));

/** Global undo/redo keyboard shortcuts, active whenever a project is open. */
export function installHistoryShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      useProjectStore.getState().undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      useProjectStore.getState().redo();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** Flushes pending autosave when the page is being hidden or closed. */
export function installUnloadFlush(): () => void {
  const onHide = () => {
    const s = useProjectStore.getState();
    if (s.saveStatus === 'dirty' && s.meta) void s.saveNow();
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (useProjectStore.getState().saveStatus === 'dirty') {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
