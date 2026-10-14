import { describe, expect, it } from 'vitest';
import { applyCommand, makePrimitive } from '../domain/commands';
import { emptyDocument } from '../domain/document';
import { inspectDocument } from './inspector';

describe('AI Inspector rules', () => {
  it('reports an empty scene as info', () => {
    const f = inspectDocument(emptyDocument());
    expect(f).toEqual([{ level: 'info', objectId: null, message: 'The scene is empty.' }]);
  });

  it('flags duplicate names and far-away objects', () => {
    let doc = emptyDocument();
    const a = makePrimitive('cube', 1);
    const b = { ...makePrimitive('sphere', 2), name: 'Cube 1' };
    doc = applyCommand(doc, { type: 'object.add', object: a });
    doc = applyCommand(doc, { type: 'object.add', object: b });
    doc = applyCommand(doc, { type: 'object.patch', id: b.id, patch: { position: [100, 0, 0] } });
    const messages = inspectDocument(doc).map((x) => x.message).join('\n');
    expect(messages).toMatch(/duplicate name/);
    expect(messages).toMatch(/units from the origin/);
  });
});
