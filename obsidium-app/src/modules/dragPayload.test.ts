import { describe, expect, it, vi } from 'vitest';

const note = { kind: 'note' as const, path: '/vault/Project.base', name: 'Project' };

async function freshModule() {
  vi.resetModules();
  return import('./dragPayload');
}

describe('note drag payload', () => {
  it('stores and clears the dragged note', async () => {
    const { getNoteDragPayload, setNoteDragPayload } = await freshModule();

    expect(getNoteDragPayload()).toBeNull();
    setNoteDragPayload(note);
    expect(getNoteDragPayload()).toEqual(note);
    setNoteDragPayload(null);
    expect(getNoteDragPayload()).toBeNull();
  });

  it('returns false when no drop target is registered', async () => {
    const { dropNoteOnTarget } = await freshModule();

    expect(dropNoteOnTarget(note, 12, 34)).toBe(false);
  });

  it('keeps only the latest registered target', async () => {
    const { dropNoteOnTarget, registerNoteDropTarget } = await freshModule();
    const first = vi.fn();
    const second = vi.fn();

    registerNoteDropTarget(first);
    registerNoteDropTarget(second);

    expect(dropNoteOnTarget(note, 5, 6)).toBe(true);
    expect(second).toHaveBeenCalledWith(note, 5, 6);
    expect(first).not.toHaveBeenCalled();
  });

  it('ignores an unsubscribe from a replaced target', async () => {
    const { dropNoteOnTarget, registerNoteDropTarget } = await freshModule();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = registerNoteDropTarget(first);
    registerNoteDropTarget(second);
    unsubscribeFirst();

    expect(dropNoteOnTarget(note, 7, 8)).toBe(true);
    expect(second).toHaveBeenCalledWith(note, 7, 8);
  });

  it('stops dropping after the current target unsubscribes', async () => {
    const { dropNoteOnTarget, registerNoteDropTarget } = await freshModule();
    const unsubscribe = registerNoteDropTarget(vi.fn());

    unsubscribe();

    expect(dropNoteOnTarget(note, 1, 2)).toBe(false);
  });
});
