import { PRIMITIVE_KINDS, type PrimitiveKind, type ProjectDocument, type SceneObject, type Vec3 } from './document';

/** Every change to the project is one of these typed commands. Nothing else mutates the document. */
export type ObjectPatch = Partial<Pick<SceneObject, 'name' | 'position' | 'rotation' | 'scale' | 'color' | 'roughness' | 'metalness' | 'visible'>>;

export type Command =
  | { type: 'object.add'; object: SceneObject }
  | { type: 'object.remove'; id: string }
  | { type: 'object.patch'; id: string; patch: ObjectPatch };

export class CommandError extends Error {}

const HEX = /^#[0-9a-fA-F]{6}$/;

function assertFiniteVec(v: Vec3, label: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new CommandError(`${label} must be three finite numbers`);
  }
  return [v[0], v[1], v[2]];
}

/** Validates a command before it can touch the document. */
export function validateCommand(cmd: Command, doc: ProjectDocument): void {
  if (cmd.type === 'object.add') {
    const o = cmd.object;
    if (doc.objects[o.id]) throw new CommandError(`Object ${o.id} already exists`);
    if (!PRIMITIVE_KINDS.includes(o.kind)) throw new CommandError(`Unknown primitive ${String(o.kind)}`);
    assertFiniteVec(o.scale, 'scale');
    if (o.scale.some((n) => n <= 0)) throw new CommandError('scale must be positive');
    if (!HEX.test(o.color)) throw new CommandError('color must be #rrggbb');
    if (o.name.trim().length === 0 || o.name.length > 120) throw new CommandError('name must be 1-120 characters');
    return;
  }
  if (cmd.type === 'object.remove') {
    if (!doc.objects[cmd.id]) throw new CommandError(`Object ${cmd.id} not found`);
    return;
  }
  if (cmd.type === 'object.patch') {
    if (!doc.objects[cmd.id]) throw new CommandError(`Object ${cmd.id} not found`);
    const p = cmd.patch;
    if (p.position) assertFiniteVec(p.position, 'position');
    if (p.rotation) assertFiniteVec(p.rotation, 'rotation');
    if (p.scale) {
      assertFiniteVec(p.scale, 'scale');
      if (p.scale.some((n) => n <= 0)) throw new CommandError('scale must be positive');
    }
    if (p.color !== undefined && !HEX.test(p.color)) throw new CommandError('color must be #rrggbb');
    if (p.roughness !== undefined && (p.roughness < 0 || p.roughness > 1)) throw new CommandError('roughness 0..1');
    if (p.metalness !== undefined && (p.metalness < 0 || p.metalness > 1)) throw new CommandError('metalness 0..1');
    if (p.name !== undefined && (p.name.trim().length === 0 || p.name.length > 120)) throw new CommandError('name must be 1-120 characters');
    return;
  }
  throw new CommandError('Unknown command');
}

/** Pure function: returns a NEW document. The input is never mutated. */
export function applyCommand(doc: ProjectDocument, cmd: Command): ProjectDocument {
  validateCommand(cmd, doc);
  if (cmd.type === 'object.add') {
    return {
      ...doc,
      objects: { ...doc.objects, [cmd.object.id]: cmd.object },
      objectOrder: [...doc.objectOrder, cmd.object.id],
    };
  }
  if (cmd.type === 'object.remove') {
    const rest = { ...doc.objects };
    delete rest[cmd.id];
    return { ...doc, objects: rest, objectOrder: doc.objectOrder.filter((id) => id !== cmd.id) };
  }
  const current = doc.objects[cmd.id];
  if (!current) throw new CommandError(`Object ${cmd.id} not found`);
  const next: SceneObject = { ...current, ...cmd.patch };
  next.position = [...next.position] as Vec3;
  next.rotation = [...next.rotation] as Vec3;
  next.scale = [...next.scale] as Vec3;
  return { ...doc, objects: { ...doc.objects, [cmd.id]: next } };
}

export function isPrimitive(kind: string): kind is PrimitiveKind {
  return (PRIMITIVE_KINDS as readonly string[]).includes(kind);
}

let counter = 0;
export function newObjectId(): string {
  counter += 1;
  return `obj_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_COLORS = ['#8b73ff', '#22c3a6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899'];

/** Builds a new primitive with sensible defaults. `index` picks a distinct default color and name. */
export function makePrimitive(kind: PrimitiveKind, index: number, position: Vec3 = [0, 0, 0]): SceneObject {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  return {
    id: newObjectId(),
    name: `${label} ${index}`,
    kind,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: DEFAULT_COLORS[index % DEFAULT_COLORS.length] ?? '#8b73ff',
    roughness: 0.5,
    metalness: 0.1,
    visible: true,
  };
}
