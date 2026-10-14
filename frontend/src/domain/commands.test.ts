import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError, makePrimitive } from './commands';
import { emptyDocument, normalizeDocument, type ProjectDocument } from './document';

function docWithCube(): { doc: ProjectDocument; id: string } {
  const cube = makePrimitive('cube', 1);
  const doc = applyCommand(emptyDocument('P'), { type: 'object.add', object: cube });
  return { doc, id: cube.id };
}

describe('applyCommand', () => {
  it('adds an object and keeps the order', () => {
    const { doc, id } = docWithCube();
    expect(doc.objectOrder).toEqual([id]);
    expect(doc.objects[id]?.kind).toBe('cube');
  });

  it('never mutates the input document', () => {
    const before = emptyDocument('P');
    const snapshot = JSON.stringify(before);
    const cube = makePrimitive('sphere', 2);
    applyCommand(before, { type: 'object.add', object: cube });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('patches transform values and returns a new object', () => {
    const { doc, id } = docWithCube();
    const next = applyCommand(doc, { type: 'object.patch', id, patch: { position: [1, 2, 3], rotation: [0, 1.5, 0], scale: [2, 2, 2] } });
    expect(next.objects[id]?.position).toEqual([1, 2, 3]);
    expect(next.objects[id]?.rotation).toEqual([0, 1.5, 0]);
    expect(doc.objects[id]?.position).toEqual([0, 0, 0]);
  });

  it('removes an object from both the map and the order', () => {
    const { doc, id } = docWithCube();
    const next = applyCommand(doc, { type: 'object.remove', id });
    expect(next.objects[id]).toBeUndefined();
    expect(next.objectOrder).toEqual([]);
  });

  it('rejects invalid input instead of corrupting the document', () => {
    const { doc, id } = docWithCube();
    expect(() => applyCommand(doc, { type: 'object.patch', id, patch: { scale: [0, 1, 1] } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'object.patch', id, patch: { position: [NaN, 0, 0] } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'object.patch', id, patch: { color: 'red' } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'object.patch', id, patch: { roughness: 2 } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'object.patch', id: 'missing', patch: { visible: false } })).toThrow(CommandError);
    expect(() => applyCommand(doc, { type: 'object.remove', id: 'missing' })).toThrow(CommandError);
  });

  it('rejects duplicate ids on add', () => {
    const { doc, id } = docWithCube();
    const dup = { ...makePrimitive('cube', 3), id };
    expect(() => applyCommand(doc, { type: 'object.add', object: dup })).toThrow(CommandError);
  });
});

describe('normalizeDocument', () => {
  it('drops invalid objects and keeps valid ones', () => {
    const good = makePrimitive('torus', 1);
    const raw = {
      objects: { [good.id]: good, bad: { id: 'bad', kind: 'dragon' } },
      objectOrder: [good.id, 'bad', 'ghost'],
    };
    const doc = normalizeDocument(raw, 'Fallback');
    expect(Object.keys(doc.objects)).toEqual([good.id]);
    expect(doc.objectOrder).toEqual([good.id]);
    expect(doc.name).toBe('Fallback');
  });

  it('returns an empty document for non-object input', () => {
    expect(normalizeDocument(null, 'X').objectOrder).toEqual([]);
    expect(normalizeDocument('nope', 'X').schemaVersion).toBe(1);
  });
});
