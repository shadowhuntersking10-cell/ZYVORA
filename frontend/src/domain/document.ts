/**
 * The ONE project document shared by every studio.
 * Studios never keep their own copies: they read this document and change it only through
 * typed commands (see commands.ts). The backend stores it as JSON in `projects.document`.
 */

export type Vec3 = [number, number, number];
export type PrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'plane' | 'cone' | 'torus';

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = ['cube', 'sphere', 'cylinder', 'plane', 'cone', 'torus'];

export interface SceneObject {
  id: string;
  name: string;
  kind: PrimitiveKind;
  position: Vec3;
  /** Euler angles in radians. */
  rotation: Vec3;
  scale: Vec3;
  color: string;
  roughness: number;
  metalness: number;
  visible: boolean;
}

export interface ProjectDocument {
  schemaVersion: 1;
  name: string;
  objects: Record<string, SceneObject>;
  objectOrder: string[];
  // Reserved sections for later studios. They round-trip unchanged through save/load.
  characters: Record<string, unknown>;
  animations: Record<string, unknown>;
  cameras: Record<string, unknown>;
  shots: Record<string, unknown>;
  layers: unknown[];
  audioTracks: unknown[];
  story: { title: string; scenes: unknown[] };
}

export function emptyDocument(name = 'Untitled project'): ProjectDocument {
  return {
    schemaVersion: 1,
    name,
    objects: {},
    objectOrder: [],
    characters: {},
    animations: {},
    cameras: {},
    shots: {},
    layers: [],
    audioTracks: [],
    story: { title: '', scenes: [] },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function isSceneObject(v: unknown): v is SceneObject {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.kind === 'string' && (PRIMITIVE_KINDS as readonly string[]).includes(v.kind) &&
    isVec3(v.position) && isVec3(v.rotation) && isVec3(v.scale) &&
    typeof v.color === 'string' &&
    typeof v.roughness === 'number' &&
    typeof v.metalness === 'number' &&
    typeof v.visible === 'boolean'
  );
}

/**
 * Accepts an arbitrary JSON value from the backend and returns a valid document.
 * Invalid objects are dropped rather than crashing the editor.
 */
export function normalizeDocument(raw: unknown, fallbackName: string): ProjectDocument {
  const base = emptyDocument(fallbackName);
  if (!isRecord(raw)) return base;
  const objects: Record<string, SceneObject> = {};
  const rawObjects = isRecord(raw.objects) ? raw.objects : {};
  for (const [id, obj] of Object.entries(rawObjects)) {
    if (isSceneObject(obj) && obj.id === id) objects[id] = obj;
  }
  const order = Array.isArray(raw.objectOrder)
    ? raw.objectOrder.filter((id): id is string => typeof id === 'string' && id in objects)
    : [];
  for (const id of Object.keys(objects)) if (!order.includes(id)) order.push(id);
  return {
    ...base,
    name: typeof raw.name === 'string' ? raw.name : fallbackName,
    objects,
    objectOrder: order,
    characters: isRecord(raw.characters) ? raw.characters : {},
    animations: isRecord(raw.animations) ? raw.animations : {},
    cameras: isRecord(raw.cameras) ? raw.cameras : {},
    shots: isRecord(raw.shots) ? raw.shots : {},
    layers: Array.isArray(raw.layers) ? raw.layers : [],
    audioTracks: Array.isArray(raw.audioTracks) ? raw.audioTracks : [],
    story: isRecord(raw.story) ? { title: String(raw.story.title ?? ''), scenes: Array.isArray(raw.story.scenes) ? raw.story.scenes : [] } : base.story,
  };
}
