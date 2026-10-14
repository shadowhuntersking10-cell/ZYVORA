import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ComingSoonCenter } from '../studios/ComingSoonStudio';
import { studioDef, type StudioDef } from '../studios/registry';
import type { StudioModule } from '../studios/registry';
import { useT } from '../lib/i18n';
import { usePrefsStore } from '../store/prefs';
import { useProjectStore, type StudioId } from '../store/project';
import { ZyvoraAIPanel } from '../ai/ZyvoraAIPanel';
import { Button, Spinner } from '../components/ui';
import { ErrorText } from '../components/ui';
import { Empty } from '../components/ui';

/**
 * The unified workspace. The project stays open; switching studios swaps only the
 * center, left/right and bottom regions. Studio modules are lazy-loaded and cached by React.
 */
export function Workspace() {
  const t = useT();
  const { projectId = '', studio = '' } = useParams();
  const def = studioDef(studio);
  const meta = useProjectStore((s) => s.meta);
  const loading = useProjectStore((s) => s.loading);
  const loadError = useProjectStore((s) => s.loadError);
  const loadProject = useProjectStore((s) => s.loadProject);
  const setStudio = useProjectStore((s) => s.setStudio);
  const setLastProjectId = usePrefsStore((s) => s.setLastProjectId);
  const [rightTab, setRightTab] = useState<'properties' | 'ai'>('properties');

  useEffect(() => {
    setLastProjectId(projectId);
    if (useProjectStore.getState().meta?.id !== projectId) void loadProject(projectId);
  }, [projectId, loadProject, setLastProjectId]);

  useEffect(() => {
    if (def) setStudio(def.id as StudioId);
  }, [def, setStudio]);

  if (!def) return <Navigate to="/app/dashboard" replace />;
  if (loadError) {
    return (
      <div className="p-6">
        <ErrorText>{loadError}</ErrorText>
        <Button className="mt-3" onClick={() => void loadProject(projectId)}>{t('common.open')}</Button>
      </div>
    );
  }
  if (loading || !meta || meta.id !== projectId) return <Spinner />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside className="min-h-0 overflow-auto border-b border-border bg-surface lg:border-b-0 lg:border-r" aria-label="Tools">
          <StudioSlot def={def} region="Left" />
        </aside>
        <main className="flex min-h-[60vh] min-w-0 flex-col bg-bg lg:min-h-0" aria-label="Workspace">
          <StudioSlot def={def} region="Center" />
        </main>
        <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border bg-surface lg:border-l lg:border-t-0" aria-label="Properties">
          <div className="flex gap-1 border-b border-border p-2">
            <TabButton active={rightTab === 'properties'} onClick={() => setRightTab('properties')}>{t('3d.properties')}</TabButton>
            <TabButton active={rightTab === 'ai'} onClick={() => setRightTab('ai')}>{t('ai.title')}</TabButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {rightTab === 'properties' ? <StudioSlot def={def} region="Right" /> : <ZyvoraAIPanel />}
          </div>
        </aside>
      </div>
      <section className="h-44 shrink-0 overflow-auto border-t border-border bg-surface" aria-label="Timeline and queue">
        <StudioSlot def={def} region="Bottom" />
      </section>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-token px-2.5 py-1 text-xs font-medium ${active ? 'bg-accent text-accent-contrast' : 'text-muted hover:bg-surface2 hover:text-text'}`}>
      {children}
    </button>
  );
}

function StudioSlot({ def, region }: { def: StudioDef; region: 'Left' | 'Center' | 'Right' | 'Bottom' }) {
  const t = useT();
  if (!def.load) {
    if (region === 'Center') return <ComingSoonCenter title={t(def.labelKey)} />;
    return <Empty>{t('common.coming_soon')}</Empty>;
  }
  return <LazyStudioRegion key={def.id} load={def.load} region={region} />;
}

function LazyStudioRegion({ load, region }: { load: NonNullable<StudioDef['load']>; region: 'Left' | 'Center' | 'Right' | 'Bottom' }) {
  // useMemo keeps the lazy component identity stable across re-renders.
  const Mod = useMemo(
    () => lazy(async () => {
      const m = await load();
      const mod: StudioModule = m.default;
      const Region = mod[region];
      return { default: Region };
    }),
    [load, region],
  );
  return (
    <Suspense fallback={<Spinner />}>
      <Mod />
    </Suspense>
  );
}
