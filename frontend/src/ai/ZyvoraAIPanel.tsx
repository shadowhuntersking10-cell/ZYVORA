import { useMemo, useState } from 'react';
import { useProjectStore, type StudioId } from '../store/project';
import { useT } from '../lib/i18n';
import { Badge, Button, Empty, Field } from '../components/ui';
import { AIRunner, type AIJob } from './AIRunner';
import { inspectDocument } from './inspector';

type Mode = 'mentor' | 'inspector' | 'director' | 'builder' | 'copilot' | 'agent';

const MODES: { id: Mode; key: string; status: 'working' | 'partial' | 'coming_soon' }[] = [
  { id: 'mentor', key: 'ai.mentor', status: 'working' },
  { id: 'inspector', key: 'ai.inspector', status: 'working' },
  { id: 'director', key: 'ai.director', status: 'partial' },
  { id: 'builder', key: 'ai.builder', status: 'coming_soon' },
  { id: 'copilot', key: 'ai.copilot', status: 'coming_soon' },
  { id: 'agent', key: 'ai.agent', status: 'coming_soon' },
];

const MODE_DESC: Record<Mode, string> = {
  mentor: 'ai.mentor_desc',
  inspector: 'ai.inspector_desc',
  director: 'ai.director_desc',
  builder: 'ai.builder_desc',
  copilot: 'ai.builder_desc',
  agent: 'ai.builder_desc',
};

/** The docked ZYVORA AI panel. It always knows the current studio and selection. */
export function ZyvoraAIPanel() {
  const t = useT();
  const [mode, setMode] = useState<Mode>('mentor');
  const studio = useProjectStore((s) => s.activeStudio);
  const selectedId = useProjectStore((s) => s.selectedId);
  const doc = useProjectStore((s) => s.doc);
  const select = useProjectStore((s) => s.select);
  const selectedName = selectedId ? doc.objects[selectedId]?.name ?? null : null;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={m.status === 'coming_soon'}
            onClick={() => setMode(m.id)}
            title={m.status === 'coming_soon' ? t('common.coming_soon') : undefined}
            className={`rounded-token px-2 py-1 text-xs font-medium disabled:opacity-40 ${mode === m.id ? 'bg-accent text-accent-contrast' : 'bg-surface2 text-muted hover:text-text'}`}
          >
            {t(m.key)}
          </button>
        ))}
      </div>
      <div className="rounded-token bg-surface2 px-2.5 py-2 text-xs text-muted">
        <span className="font-medium text-text">{t('ai.context')}:</span> {studio} · {selectedName ?? '—'}
        {selectedId && (
          <button className="ml-2 underline" onClick={() => select(null)} type="button">×</button>
        )}
      </div>
      <p className="text-xs text-muted">{t(MODE_DESC[mode])}</p>
      {mode === 'mentor' && <MentorPanel studio={studio} selectedName={selectedName} />}
      {mode === 'inspector' && <InspectorPanel />}
      {mode === 'director' && <DirectorPanel />}
      {(mode === 'builder' || mode === 'copilot' || mode === 'agent') && (
        <Empty>{t('common.coming_soon')}</Empty>
      )}
    </div>
  );
}

function MentorPanel({ studio, selectedName }: { studio: StudioId; selectedName: string | null }) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const prompt = useMemo(() => {
    const ctx = `The user is in the ${studio} studio${selectedName ? ` with "${selectedName}" selected` : ''}.`;
    return `${ctx}\n\nQuestion: ${question}`;
  }, [question, studio, selectedName]);
  return (
    <div className="space-y-3">
      <Field label={t('ai.ask')}>
        <textarea className="input min-h-20" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} />
      </Field>
      <AIRunner provider="openai" task="chat" prompt={prompt} disabled={!question.trim()}
        runLabel={t('ai.send')} onJob={(job: AIJob) => {
          if (job.status === 'succeeded') setAnswer(String(job.result.text ?? ''));
          else setFailed(job.error ?? t('common.error'));
        }} />
      {answer && <div className="whitespace-pre-wrap rounded-token bg-bg p-3 text-sm">{answer}</div>}
      {failed && <p className="text-sm text-danger">{failed}</p>}
    </div>
  );
}

function InspectorPanel() {
  const t = useT();
  const doc = useProjectStore((s) => s.doc);
  const select = useProjectStore((s) => s.select);
  const findings = inspectDocument(doc);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{findings.length === 0 ? '✓ 0' : findings.length} findings</p>
      {findings.length === 0 && <Empty>{t('common.empty')}</Empty>}
      <ul className="space-y-2">
        {findings.map((f, i) => (
          <li key={i} className="rounded-token border border-border bg-bg p-2 text-xs">
            <Badge tone={f.level === 'warn' ? 'warn' : 'muted'}>{f.level}</Badge>{' '}
            <span>{f.message}</span>
            {f.objectId && (
              <div className="mt-1">
                <Button size="sm" variant="ghost" onClick={() => select(f.objectId)}>{t('common.open')}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PlanStep {
  title: string;
  studio: string;
  action: string;
}

const SUPPORTED_STUDIOS = new Set(['3d']);

function parsePlan(text: string): PlanStep[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({ title: String(s.title ?? ''), studio: String(s.studio ?? ''), action: String(s.action ?? '') }))
      .slice(0, 12);
  } catch {
    return null;
  }
}

function DirectorPanel() {
  const t = useT();
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState<PlanStep[] | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const prompt = `Split this creative goal into at most 8 small sequential steps for an anime/3D/animation/cinema tool. Reply with ONLY a JSON array of objects with keys "title", "studio" (one of: character, 3d, animation, cinema, ai-lab, story) and "action" (one short sentence). Goal: ${goal}`;
  return (
    <div className="space-y-3">
      <Field label={t('ai.ask')}>
        <textarea className="input min-h-20" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={2000} />
      </Field>
      <AIRunner provider="openai" task="chat" prompt={prompt} disabled={!goal.trim()}
        runLabel={t('ai.run')} onJob={(job) => {
          if (job.status === 'succeeded') {
            const text = String(job.result.text ?? '');
            setRaw(text);
            setSteps(parsePlan(text));
          }
        }} />
      {steps && (
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="rounded-token border border-border bg-bg p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <b>{i + 1}. {s.title}</b>
                {SUPPORTED_STUDIOS.has(s.studio)
                  ? <Badge tone="ok">{s.studio}</Badge>
                  : <Badge tone="muted">{s.studio} – not built</Badge>}
              </div>
              <p className="mt-1 text-muted">{s.action}</p>
            </li>
          ))}
        </ol>
      )}
      {raw && !steps && <div className="whitespace-pre-wrap rounded-token bg-bg p-2 text-xs">{raw}</div>}
      <p className="text-xs text-muted">Plan execution is not built yet. Steps are shown for planning only.</p>
    </div>
  );
}
