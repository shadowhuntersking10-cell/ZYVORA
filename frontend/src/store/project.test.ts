import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { api: vi.fn(async () => ({ version: 2 })), ApiError };
});

import { api } from '../lib/api';
import { makePrimitive } from '../domain/commands';
import { useProjectStore } from './project';

function openProject(version = 1) {
  useProjectStore.setState({
    meta: { id: 'p1', name: 'Test', folder: 'Default', version },
    doc: { ...useProjectStore.getState().doc, objects: {}, objectOrder: [] },
    past: [],
    future: [],
    selectedId: null,
    saveStatus: 'saved',
  });
}

describe('project store: unified history', () => {
  beforeEach(() => {
    vi.mocked(api).mockClear();
    openProject();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tags each history entry with the studio that made the change', () => {
    const cube = makePrimitive('cube', 1);
    useProjectStore.getState().dispatch('3d', 'Add cube', { type: 'object.add', object: cube });
    const entry = useProjectStore.getState().past[0];
    expect(entry?.studio).toBe('3d');
    expect(entry?.label).toBe('Add cube');
  });

  it('undo and redo move the whole document back and forth', () => {
    const s = useProjectStore.getState;
    const cube = makePrimitive('cube', 1);
    s().dispatch('3d', 'Add cube', { type: 'object.add', object: cube });
    s().dispatch('3d', 'Move', { type: 'object.patch', id: cube.id, patch: { position: [5, 0, 0] } });
    expect(s().doc.objects[cube.id]?.position).toEqual([5, 0, 0]);
    expect(s().undo()).toBe(true);
    expect(s().doc.objects[cube.id]?.position).toEqual([0, 0, 0]);
    expect(s().redo()).toBe(true);
    expect(s().doc.objects[cube.id]?.position).toEqual([5, 0, 0]);
    s().undo();
    s().undo();
    expect(s().doc.objectOrder).toEqual([]);
    expect(s().undo()).toBe(false);
  });

  it('a new change clears the redo stack', () => {
    const s = useProjectStore.getState;
    const cube = makePrimitive('cube', 1);
    s().dispatch('3d', 'Add', { type: 'object.add', object: cube });
    s().undo();
    s().dispatch('3d', 'Add sphere', { type: 'object.add', object: makePrimitive('sphere', 2) });
    expect(s().future).toEqual([]);
  });

  it('rejects invalid commands without changing the document or history', () => {
    const cube = makePrimitive('cube', 1);
    useProjectStore.getState().dispatch('3d', 'Add', { type: 'object.add', object: cube });
    const before = useProjectStore.getState().doc;
    const ok = useProjectStore.getState().dispatch('3d', 'Bad', { type: 'object.patch', id: cube.id, patch: { scale: [0, 0, 0] } });
    expect(ok).toBe(false);
    expect(useProjectStore.getState().doc).toBe(before);
    expect(useProjectStore.getState().past).toHaveLength(1);
  });

  it('keeps per-studio view state when switching studios', () => {
    useProjectStore.getState().setView('3d', { camera: { position: [1, 2, 3], target: [0, 0, 0] } });
    useProjectStore.getState().setStudio('ai-lab');
    useProjectStore.getState().setStudio('3d');
    expect(useProjectStore.getState().views['3d']?.camera?.position).toEqual([1, 2, 3]);
  });
});

describe('project store: autosave', () => {
  beforeEach(() => {
    vi.mocked(api).mockClear();
    vi.useFakeTimers();
    openProject(3);
  });

  it('writes the document with base_version after a short delay', async () => {
    const cube = makePrimitive('cube', 1);
    useProjectStore.getState().dispatch('3d', 'Add', { type: 'object.add', object: cube });
    expect(useProjectStore.getState().saveStatus).toBe('dirty');
    expect(api).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(api).toHaveBeenCalledTimes(1);
    const [path, opts] = vi.mocked(api).mock.calls[0] ?? [];
    expect(path).toBe('/api/projects/p1/document');
    expect((opts as { body: { base_version: number } }).body.base_version).toBe(3);
    expect(useProjectStore.getState().saveStatus).toBe('saved');
    expect(useProjectStore.getState().meta?.version).toBe(2);
  });

  it('shows a conflict status on version mismatch', async () => {
    const { ApiError } = await import('../lib/api');
    vi.mocked(api).mockRejectedValueOnce(new (ApiError as unknown as new (s: number, m: string) => Error)(409, 'Version conflict'));
    useProjectStore.getState().dispatch('3d', 'Add', { type: 'object.add', object: makePrimitive('cube', 1) });
    await useProjectStore.getState().saveNow();
    expect(useProjectStore.getState().saveStatus).toBe('conflict');
  });
});
