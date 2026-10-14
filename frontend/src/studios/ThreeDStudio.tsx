import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type * as THREE from 'three';
import { create } from 'zustand';
import { makePrimitive, type Command, type ObjectPatch } from '../domain/commands';
import { PRIMITIVE_KINDS, type PrimitiveKind, type SceneObject, type Vec3 } from '../domain/document';
import { useProjectStore, type StudioId } from '../store/project';
import { usePrefsStore } from '../store/prefs';
import { useT } from '../lib/i18n';
import { AIRunner, type AIJob } from '../ai/AIRunner';
import { api } from '../lib/api';
import { Badge, Button, Empty, ErrorText, Field } from '../components/ui';
import type { StudioModule } from './registry';

type TransformMode = 'translate' | 'rotate' | 'scale';
const STUDIO: StudioId = '3d';

/** Transform gizmo mode is UI state shared by the viewport toolbar and keyboard shortcuts. */
const useGizmo = create<{ mode: TransformMode; setMode: (m: TransformMode) => void }>()((set) => ({
  mode: 'translate',
  setMode: (mode) => set({ mode }),
}));

/** Minimal shape of drei's OrbitControls instance that this studio uses. */
interface ControlsLike {
  object: THREE.Camera;
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const round = (n: number) => Math.round(n * 1000) / 1000;
const near = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1e-6);

function dispatch3D(label: string, cmd: Command): boolean {
  return useProjectStore.getState().dispatch(STUDIO, label, cmd);
}

function addPrimitive(kind: PrimitiveKind) {
  const index = useProjectStore.getState().doc.objectOrder.length + 1;
  const obj = makePrimitive(kind, index, [0, 0.5, 0]);
  if (dispatch3D(`Add ${kind}`, { type: 'object.add', object: obj })) {
    useProjectStore.getState().select(obj.id);
  }
}

function deleteObject(id: string) {
  const o = useProjectStore.getState().doc.objects[id];
  if (o && dispatch3D(`Delete ${o.name}`, { type: 'object.remove', id })) {
    useProjectStore.getState().select(null);
  }
}

/* ------------------------------------------------------------------ Left: primitives + hierarchy */

const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: 'Cube', sphere: 'Sphere', cylinder: 'Cylinder', plane: 'Plane', cone: 'Cone', torus: 'Torus',
};

function Left(): ReactElement {
  const t = useT();
  const doc = useProjectStore((s) => s.doc);
  const selectedId = useProjectStore((s) => s.selectedId);
  const select = useProjectStore((s) => s.select);
  return (
    <div className="space-y-4 p-3 text-sm">
      <section>
        <p className="label">{t('3d.primitives')}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRIMITIVE_KINDS.map((k) => (
            <Button key={k} size="sm" onClick={() => addPrimitive(k)} title={`${t('3d.add')} ${PRIMITIVE_LABELS[k]}`}>
              + {PRIMITIVE_LABELS[k]}
            </Button>
          ))}
        </div>
      </section>
      <section>
        <p className="label">{t('3d.hierarchy')} ({doc.objectOrder.length})</p>
        {doc.objectOrder.length === 0 && <Empty>{t('3d.empty_scene')}</Empty>}
        <ul className="space-y-0.5" aria-label={t('3d.hierarchy')}>
          {doc.objectOrder.map((id) => {
            const o = doc.objects[id];
            if (!o) return null;
            const active = id === selectedId;
            return (
              <li key={id} className={`flex items-center gap-1 rounded px-1.5 py-1 ${active ? 'bg-accent/15 text-accent' : 'hover:bg-surface2'}`}>
                <button type="button" aria-pressed={active} onClick={() => select(id)} className="min-w-0 flex-1 truncate text-left">
                  {o.name}
                </button>
                <span className="text-[10px] text-muted">{o.kind}</span>
                <button type="button" className="text-xs text-muted hover:text-text"
                  aria-label={o.visible ? `Hide ${o.name}` : `Show ${o.name}`}
                  onClick={() => dispatch3D(o.visible ? 'Hide' : 'Show', { type: 'object.patch', id, patch: { visible: !o.visible } })}>
                  {o.visible ? '◉' : '○'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Center: Three.js viewport */

function Geometry({ kind }: { kind: PrimitiveKind }): ReactElement {
  switch (kind) {
    case 'cube': return <boxGeometry args={[1, 1, 1]} />;
    case 'sphere': return <sphereGeometry args={[0.6, 32, 16]} />;
    case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1.2, 32]} />;
    case 'plane': return <planeGeometry args={[1.5, 1.5]} />;
    case 'cone': return <coneGeometry args={[0.6, 1.2, 32]} />;
    case 'torus': return <torusGeometry args={[0.5, 0.18, 16, 48]} />;
  }
}

function SceneMeshes({ meshes, selectedId, onSelect }: {
  meshes: Map<string, THREE.Mesh>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const doc = useProjectStore((s) => s.doc);
  return (
    <>
      {doc.objectOrder.map((id) => {
        const o: SceneObject | undefined = doc.objects[id];
        if (!o) return null;
        const selected = id === selectedId;
        return (
          <mesh
            key={id}
            name={o.name}
            ref={(m: THREE.Mesh | null) => {
              if (m) meshes.set(id, m);
              else meshes.delete(id);
            }}
            position={o.position}
            rotation={o.rotation}
            scale={o.scale}
            visible={o.visible}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
          >
            <Geometry kind={o.kind} />
            <meshStandardMaterial color={o.color} roughness={o.roughness} metalness={o.metalness}
              emissive={selected ? '#2a2550' : '#000000'} />
          </mesh>
        );
      })}
    </>
  );
}

/** Restores the saved camera for this studio and persists it when the user finishes orbiting. */
function CameraState() {
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const setView = useProjectStore((s) => s.setView);
  useEffect(() => {
    if (!controls) return;
    const saved = useProjectStore.getState().views[STUDIO]?.camera;
    if (saved) {
      controls.object.position.set(...saved.position);
      controls.target.set(...saved.target);
      controls.update();
    }
    const onEnd = () => {
      setView(STUDIO, {
        camera: {
          position: controls.object.position.toArray() as Vec3,
          target: controls.target.toArray() as Vec3,
        },
      });
    };
    controls.addEventListener('end', onEnd);
    return () => controls.removeEventListener('end', onEnd);
  }, [controls, setView]);
  return null;
}

function Viewport(): ReactElement {
  const t = useT();
  const mode = useGizmo((s) => s.mode);
  const setMode = useGizmo((s) => s.setMode);
  const selectedId = useProjectStore((s) => s.selectedId);
  const select = useProjectStore((s) => s.select);
  const objectCount = useProjectStore((s) => s.doc.objectOrder.length);
  const hasSelected = useProjectStore((s) => (s.selectedId ? !!s.doc.objects[s.selectedId] : false));
  const theme = usePrefsStore((s) => s.theme);
  const meshes = useRef(new Map<string, THREE.Mesh>()).current;
  const selectedMesh = selectedId ? meshes.get(selectedId) : undefined;
  const savedCamera = useRef(useProjectStore.getState().views[STUDIO]?.camera).current;
  const bg = theme === 'dark' ? '#0a0c11' : '#e8ebf1';

  const commitTransform = () => {
    const state = useProjectStore.getState();
    const id = state.selectedId;
    const m = id ? meshes.get(id) : undefined;
    const obj = id ? state.doc.objects[id] : undefined;
    if (!id || !m || !obj) return;
    const position = m.position.toArray() as Vec3;
    const rotation: Vec3 = [m.rotation.x, m.rotation.y, m.rotation.z];
    const scale = m.scale.toArray() as Vec3;
    if (near(position, obj.position) && near(rotation, obj.rotation) && near(scale, obj.scale)) return;
    const label = mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale';
    dispatch3D(label, { type: 'object.patch', id, patch: { position, rotation, scale } });
  };

  const modes: { id: TransformMode; key: string; short: string }[] = [
    { id: 'translate', key: '3d.translate', short: 'W' },
    { id: 'rotate', key: '3d.rotate', short: 'E' },
    { id: 'scale', key: '3d.scale', short: 'R' },
  ];

  return (
    <div className="relative h-full min-h-[60vh] w-full">
      <div className="absolute left-2 top-2 z-10 flex gap-1 rounded-token border border-border bg-surface/90 p-1 text-xs backdrop-blur" role="toolbar" aria-label={t('3d.translate')}>
        {modes.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} title={`${t(m.key)} (${m.short})`}
            onClick={() => setMode(m.id)}
            className={`rounded px-2 py-1 font-medium ${mode === m.id ? 'bg-accent text-accent-contrast' : 'text-muted hover:text-text'}`}>
            {t(m.key)}
          </button>
        ))}
      </div>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: savedCamera?.position ?? [4, 3, 6], fov: 45 }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={[bg]} />
        <ambientLight intensity={0.6} />
        <hemisphereLight args={['#ffffff', '#303444', 0.5]} />
        <directionalLight position={[5, 8, 5]} intensity={1} />
        <gridHelper args={[20, 20, '#5b6172', '#2e3444']} />
        <SceneMeshes meshes={meshes} selectedId={selectedId} onSelect={select} />
        {selectedId && selectedMesh && hasSelected && (
          <TransformControls key={`${selectedId}-${mode}`} object={selectedMesh} mode={mode}
            onMouseUp={commitTransform} makeDefault />
        )}
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <CameraState />
      </Canvas>
      {objectCount === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded-token bg-surface/80 px-3 py-2 text-sm text-muted">{t('3d.empty_scene')}</p>
        </div>
      )}
    </div>
  );
}

function Center(): ReactElement {
  const setMode = useGizmo((s) => s.setMode);
  const selectedId = useProjectStore((s) => s.selectedId);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (k === 'w') setMode('translate');
      if (k === 'e') setMode('rotate');
      if (k === 'r') setMode('scale');
      if ((k === 'delete' || k === 'backspace') && useProjectStore.getState().selectedId) {
        deleteObject(useProjectStore.getState().selectedId as string);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode, selectedId]);
  return <Viewport />;
}

/* ------------------------------------------------------------------ Right: properties */

function DraftNumber({ value, onCommit, label, step = 0.1 }: {
  value: number; onCommit: (n: number) => void; label: string; step?: number;
}) {
  const [draft, setDraft] = useState(String(round(value)));
  useEffect(() => setDraft(String(round(value))), [value]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || round(n) === round(value)) {
      setDraft(String(round(value)));
      return;
    }
    onCommit(n);
  };
  return (
    <input aria-label={label} type="number" step={step} className="input w-full px-2 py-1 text-xs"
      value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function Vec3Field({ label, value, onCommit, toDisplay = (v: number) => v, fromDisplay = (v: number) => v, step }: {
  label: string; value: Vec3; onCommit: (v: Vec3) => void;
  toDisplay?: (n: number) => number; fromDisplay?: (n: number) => number; step?: number;
}) {
  const axes = ['X', 'Y', 'Z'];
  return (
    <div>
      <span className="label">{label}</span>
      <div className="grid grid-cols-3 gap-1">
        {axes.map((ax, i) => (
          <DraftNumber key={ax} label={`${label} ${ax}`} step={step} value={toDisplay(value[i] ?? 0)}
            onCommit={(n) => {
              const next = [...value] as Vec3;
              next[i] = fromDisplay(n);
              onCommit(next);
            }} />
        ))}
      </div>
    </div>
  );
}

function DraftText({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input className="input text-xs" value={draft} maxLength={120} aria-label="Name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() && draft.trim() !== value) onCommit(draft.trim()); else setDraft(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function DraftColor({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={draft} aria-label="Color" onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onCommit(draft); }}
        className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent" />
      <span className="font-mono text-xs text-muted">{draft}</span>
    </div>
  );
}

function RangeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <label className="block">
      <span className="label flex justify-between"><span>{label}</span><span>{draft.toFixed(2)}</span></span>
      <input type="range" min={0} max={1} step={0.01} value={draft} className="w-full"
        onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
    </label>
  );
}

function Right(): ReactElement {
  const t = useT();
  const selectedId = useProjectStore((s) => s.selectedId);
  const obj = useProjectStore((s) => (s.selectedId ? s.doc.objects[s.selectedId] : undefined));
  const patch = (label: string, p: ObjectPatch) => {
    if (obj) dispatch3D(label, { type: 'object.patch', id: obj.id, patch: p });
  };
  if (!selectedId || !obj) {
    return (
      <div className="space-y-4 text-sm">
        <Empty>{t('3d.no_selection')}</Empty>
        <ExportSection />
        <AITextTo3D />
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-3" key={obj.id}>
        <Field label={t('3d.name')}>
          <DraftText value={obj.name} onCommit={(name) => patch('Rename', { name })} />
        </Field>
        <Vec3Field label={t('3d.position')} value={obj.position} step={0.1}
          onCommit={(position) => patch('Move', { position })} />
        <Vec3Field label={t('3d.rotation')} value={obj.rotation} toDisplay={deg} fromDisplay={rad} step={1}
          onCommit={(rotation) => patch('Rotate', { rotation })} />
        <Vec3Field label={t('3d.scale_label')} value={obj.scale} step={0.1}
          onCommit={(scale) => patch('Scale', { scale })} />
        <Field label={t('3d.color')}>
          <DraftColor value={obj.color} onCommit={(color) => patch('Color', { color })} />
        </Field>
        <RangeField label={t('3d.roughness')} value={obj.roughness} onCommit={(roughness) => patch('Roughness', { roughness })} />
        <RangeField label={t('3d.metalness')} value={obj.metalness} onCommit={(metalness) => patch('Metalness', { metalness })} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={obj.visible} onChange={(e) => patch('Visibility', { visible: e.target.checked })} />
          {t('3d.visible')}
        </label>
        <Button variant="danger" size="sm" onClick={() => deleteObject(obj.id)}>{t('3d.delete')}</Button>
      </div>
      <SendTo />
      <ExportSection />
      <AITextTo3D />
    </div>
  );
}

/** "Send to…" actions. Only "Edit in 3D" is the current studio; the others are not built yet. */
function SendTo(): ReactElement {
  const t = useT();
  const items = [t('3d.animate'), t('3d.put_in_scene'), t('3d.character_sheet'), t('3d.add_asset')];
  return (
    <section className="space-y-1.5">
      <p className="label">{t('3d.send_to')}</p>
      {items.map((label) => (
        <Button key={label} size="sm" disabled className="w-full justify-between" title={t('common.coming_soon')}>
          {label} <Badge tone="muted">{t('common.coming_soon')}</Badge>
        </Button>
      ))}
      <Button size="sm" disabled className="w-full justify-between">
        {t('3d.edit_3d')} <Badge tone="accent">●</Badge>
      </Button>
    </section>
  );
}

function ExportSection(): ReactElement {
  const t = useT();
  const doc = useProjectStore((s) => s.doc);
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.name || 'scene').replace(/[^\w-]+/g, '_')}.zyvora.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="space-y-1.5">
      <Button size="sm" onClick={exportJson} className="w-full">{t('3d.export_json')}</Button>
      <Button size="sm" disabled className="w-full justify-between">
        GLB · glTF · OBJ <Badge tone="muted">{t('common.coming_soon')}</Badge>
      </Button>
    </section>
  );
}

function AITextTo3D(): ReactElement {
  const t = useT();
  const [provider, setProvider] = useState<'meshy' | 'tripo'>('meshy');
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<AIJob | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const timer = setInterval(() => {
      api<AIJob>(`/api/ai/jobs/${job.id}`)
        .then(setJob)
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : t('common.error')));
    }, 5000);
    return () => clearInterval(timer);
  }, [job, t]);

  return (
    <section className="space-y-2">
      <p className="label">{t('3d.ai_title')}</p>
      <Field label={t('3d.ai_provider')}>
        <select className="input text-xs" value={provider} onChange={(e) => setProvider(e.target.value as 'meshy' | 'tripo')}>
          <option value="meshy">Meshy</option>
          <option value="tripo">Tripo</option>
        </select>
      </Field>
      <Field label={t('3d.ai_prompt')}>
        <textarea className="input min-h-16 text-xs" maxLength={1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <AIRunner provider={provider} task="text_to_3d" prompt={prompt} disabled={!prompt.trim()}
        onJob={(j) => { setErr(null); setJob(j); }} />
      <p className="text-[11px] text-muted">{t('3d.ai_note')}</p>
      {job && (
        <div className="rounded-token bg-bg p-2 text-xs">
          <p>Status: <b>{job.status}</b>{job.error ? ` – ${job.error}` : ''}</p>
          {Object.keys(job.result).length > 0 && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted">{JSON.stringify(job.result, null, 2)}</pre>
          )}
        </div>
      )}
      <ErrorText>{err}</ErrorText>
    </section>
  );
}

/* ------------------------------------------------------------------ Bottom: history */

function Bottom(): ReactElement {
  const t = useT();
  const past = useProjectStore((s) => s.past);
  const future = useProjectStore((s) => s.future);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  const lastLabel = useProjectStore((s) => s.lastLabel);
  const entries = [
    ...past.map((e) => ({ ...e, undone: false })),
    ...[...future].reverse().map((e) => ({ ...e, undone: true })),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col p-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <p className="label mb-0">{t('3d.history')} · {t('3d.undo_hint')}</p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={undo} disabled={past.length === 0} aria-label={t('top.undo')}>↶</Button>
          <Button size="sm" variant="ghost" onClick={redo} disabled={future.length === 0} aria-label={t('top.redo')}>↷</Button>
        </div>
      </div>
      <ol className="min-h-0 flex-1 space-y-0.5 overflow-auto">
        {entries.length === 0 && <li className="text-muted">—</li>}
        {entries.slice(-100).map((e) => (
          <li key={e.id} className={`flex gap-2 ${e.undone ? 'text-muted line-through' : ''}`}>
            <span className="text-muted">[{e.studio}]</span>
            <span>{e.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 truncate text-muted">{lastLabel ?? ''} · {saveStatus}</p>
    </div>
  );
}

const studioModule: StudioModule = { Left, Center, Right, Bottom };
export default studioModule;
