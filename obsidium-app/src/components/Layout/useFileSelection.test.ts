// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import type { VisibleFileRow } from './fileTreeModel';
import { useFileSelection } from './useFileSelection';

const rows: VisibleFileRow[] = [
  { item: { id: '/vault/Projects', name: 'Projects', type: 'folder' }, comparableId: '/vault/projects', depth: 0, expanded: true, loading: false, guideDepths: '' },
  { item: { id: '/vault/Projects/Nested', name: 'Nested', type: 'folder' }, comparableId: '/vault/projects/nested', depth: 1, expanded: true, loading: false, guideDepths: '' },
  { item: { id: '/vault/Projects/Nested/Note.md', name: 'Note', type: 'file' }, comparableId: '/vault/projects/nested/note.md', depth: 2, expanded: false, loading: false, guideDepths: '' },
  { item: { id: '/vault/Projects/Other.md', name: 'Other', type: 'file' }, comparableId: '/vault/projects/other.md', depth: 1, expanded: false, loading: false, guideDepths: '' },
  { item: { id: '/vault/Loose.md', name: 'Loose', type: 'file' }, comparableId: '/vault/loose.md', depth: 0, expanded: false, loading: false, guideDepths: '' },
];

let latest!: ReturnType<typeof useFileSelection>;
let mounted: MountedDom | undefined;

function Harness() {
  latest = useFileSelection(null, rows, () => {});
  return null;
}

function mountSelection() {
  act(() => { mounted = mountDom(h(Harness, {})); });
}

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('useFileSelection targets', () => {
  it('keeps ordinary single and multiple targets unchanged', () => {
    mountSelection();
    expect(latest.targetsFor('/vault/Loose.md')).toEqual(['/vault/Loose.md']);

    act(() => {
      latest.rowActions.selectFile('/vault/Loose.md', true, false);
      latest.rowActions.selectFile('/vault/Projects/Other.md', true, false);
    });

    expect(latest.targetsFor('/vault/Loose.md'))
      .toEqual(['/vault/Loose.md', '/vault/Projects/Other.md']);
  });

  it('omits selected descendants of selected folders and preserves remaining order', () => {
    mountSelection();
    act(() => {
      latest.rowActions.selectFile('/vault/Projects', true, false);
      latest.rowActions.selectFile('/vault/Projects/Nested', true, false);
      latest.rowActions.selectFile('/vault/Projects/Nested/Note.md', true, false);
      latest.rowActions.selectFile('/vault/Loose.md', true, false);
    });

    expect(latest.targetsFor('/vault/Projects/Nested/Note.md'))
      .toEqual(['/vault/Projects', '/vault/Loose.md']);
  });
});
