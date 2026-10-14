import { useEffect, useState, type ReactElement } from 'react';
import { api } from '../lib/api';
import { AIRunner, JOBS_CHANGED, type AIJob } from '../ai/AIRunner';
import { useT } from '../lib/i18n';
import { useProjectStore, type StudioId } from '../store/project';
import { Badge, Empty, Field } from '../components/ui';
import type { StudioModule } from './registry';

const STUDIO: StudioId = 'ai-lab';

/** The draft prompt lives in the shared view state, so it survives switching studios. */
function usePrompt(): [string, (v: string) => void] {
  const draft = useProjectStore((s) => s.views[STUDIO]?.draft ?? '');
  const setView = useProjectStore((s) => s.setView);
  return [draft, (v: string) => setView(STUDIO, { draft: v })];
}

/** Loads AI jobs from the server and reloads whenever any AI run finishes in the app. */
function useJobs(): AIJob[] | null {
  const [jobs, setJobs] = useState<AIJob[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(JOBS_CHANGED, bump);
    return () => window.removeEventListener(JOBS_CHANGED, bump);
  }, []);
  useEffect(() => {
    let alive = true;
    api<AIJob[]>('/api/ai/jobs').then((j) => alive && setJobs(j)).catch(() => alive && setJobs([]));
    return () => {
      alive = false;
    };
  }, [tick]);
  return jobs;
}

function Left(): ReactElement {
  const t = useT();
  return (
    <div className="space-y-3 p-3 text-sm">
      <p className="label">{t('ai.title')}</p>
      <p className="text-xs text-muted">Stability AI · text → image</p>
      <p className="text-xs text-muted">Video generation: <Badge tone="muted">{t('common.coming_soon')}</Badge></p>
      <p className="text-xs text-muted">Storyboard frames: <Badge tone="muted">{t('common.coming_soon')}</Badge></p>
    </div>
  );
}

function Center(): ReactElement {
  const t = useT();
  const jobs = useJobs();
  const latest = jobs?.find((j) => j.provider === 'stability' && j.status === 'succeeded' && typeof j.result.image_base64 === 'string');
  if (!latest) {
    return <div className="grid h-full place-items-center p-6"><Empty>{t('common.empty')}</Empty></div>;
  }
  return (
    <div className="grid h-full place-items-center p-4">
      <img alt="AI result" className="max-h-full max-w-full rounded-token border border-border"
        src={`data:${String(latest.result.mime ?? 'image/png')};base64,${String(latest.result.image_base64)}`} />
    </div>
  );
}

function Right(): ReactElement {
  const t = useT();
  const [prompt, setPrompt] = usePrompt();
  return (
    <div className="space-y-3 text-sm">
      <Field label={t('ai.ask')}>
        <textarea className="input min-h-24" maxLength={4000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <AIRunner provider="stability" task="text_to_image" prompt={prompt} disabled={!prompt.trim()}
        runLabel={t('ai.run')} />
    </div>
  );
}

function Bottom(): ReactElement {
  const t = useT();
  const jobs = useJobs();
  return (
    <div className="h-full overflow-auto p-2 text-xs">
      <p className="label">{t('dash.jobs')}</p>
      {jobs && jobs.length === 0 && <p className="text-muted">{t('dash.no_jobs')}</p>}
      <ul className="space-y-0.5">
        {(jobs ?? []).slice(0, 30).map((j) => (
          <li key={j.id} className="flex gap-2">
            <span className="w-20 text-muted">{j.provider}/{j.task}</span>
            <span>{j.status}</span>
            <span className="truncate text-muted">{j.error ?? ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const studioModule: StudioModule = { Left, Center, Right, Bottom };
export default studioModule;
