// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { WorkspaceItem } from '../../modules/documents/fileGateway';
import type { FileTreeActions } from './fileTreeModel';
import { t } from '../../i18n';

vi.mock('./fileTreeModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fileTreeModel')>();
  return { ...actual, parseGuideDepths: vi.fn(actual.parseGuideDepths) };
});

const { buildVisibleFileRows, parseGuideDepths } = await import('./fileTreeModel');
const { FileTree } = await import('./FileTree');

const notes: WorkspaceItem[] = Array.from({ length: 40 }, (_, index) => ({
  id: `C:\\vault\\note-${index}.md`,
  name: `note-${index}`,
  type: 'file',
}));

const noop = () => {};
const createNoteIn = vi.fn();
const createFolderIn = vi.fn();
const rows = buildVisibleFileRows(notes, new Map(), new Set(), new Set());
const actions: FileTreeActions = {
  selectFile: noop,
  openInNewTab: noop,
  focusRow: noop,
  toggleFolder: noop,
  prefetchFolder: noop,
  startRename: noop,
  commitRename: noop,
  cancelRename: noop,
  requestDelete: noop,
  duplicateFile: noop,
  createNoteIn,
  createFolderIn,
};

function renderTree(activeFile: string | null, selectedFiles: ReadonlySet<string> = new Set<string>()) {
  return (
    <FileTree
      rows={rows}
      activeFile={activeFile}
      selectedFiles={selectedFiles}
      renamingPath={null}
      actions={actions}
      rootPath={'C:\\vault'}
    />
  );
}

const selectedRows = (tree: MountedDom) => tree.container.querySelectorAll('.selected');

const renderedRows = () => vi.mocked(parseGuideDepths).mock.calls.length;

describe('file tree rendering', () => {
  it('re-renders only the two affected rows when the active file changes', () => {
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(renderTree(notes[0].id));
    });
    expect(renderedRows()).toBe(notes.length);

    const afterMount = renderedRows();
    act(() => {
      tree.update(renderTree(notes[7].id));
    });

    expect(renderedRows() - afterMount).toBe(2);
    act(() => {
      tree.unmount();
    });
  });

  it('highlights the very first picked row, not only from the second one', () => {
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(renderTree(notes[0].id, new Set([notes[5].id])));
    });
    expect(selectedRows(tree)).toHaveLength(1);

    act(() => {
      tree.update(renderTree(notes[0].id, new Set([notes[5].id, notes[6].id])));
    });
    expect(selectedRows(tree)).toHaveLength(2);
    act(() => {
      tree.unmount();
    });
  });

  it('marks the active row for the scroll-into-view lookup', () => {
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(renderTree('c:/vault/note-3.md'));
    });

    const active = tree.container.querySelectorAll('[data-file-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0].classList).toContain('active');
    expect(active[0].querySelector('.q-file-name')?.textContent).toBe('note-3');
    act(() => {
      tree.unmount();
    });
  });

  it('selects the note basename and wires Enter and Escape to rename actions', () => {
    const path = 'C:\\vault\\New note.md';
    const commitRename = vi.fn((): void => {});
    const cancelRename = vi.fn((): void => {});
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(
        <FileTree
          rows={buildVisibleFileRows([{ id: path, name: 'New note', type: 'file' }], new Map(), new Set(), new Set())}
          activeFile={null}
          selectedFiles={new Set<string>()}
          renamingPath={path}
          actions={{ ...actions, commitRename, cancelRename }}
        />,
      );
    });

    const content = tree.container.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    expect(view.state.doc.toString()).toBe('New note');
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe('New note'.length);

    act(() => { content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(commitRename).toHaveBeenCalledWith(path, 'New note');
    act(() => { content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(cancelRename).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('removes the .base suffix from its inline rename value', () => {
    const path = 'C:\\vault\\Roadmap.base';
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(
        <FileTree
          rows={buildVisibleFileRows([{ id: path, name: 'Roadmap.base', type: 'file' }], new Map(), new Set(), new Set())}
          activeFile={null}
          selectedFiles={new Set<string>()}
          renamingPath={path}
          actions={actions}
        />,
      );
    });

    expect(tree.container.querySelector('.cm-content')?.textContent).toBe('Roadmap');
    act(() => tree.unmount());
  });

  it('selects the full folder name when inline rename starts', () => {
    const path = 'C:\\vault\\New folder';
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(
        <FileTree
          rows={buildVisibleFileRows([{ id: path, name: 'New folder', type: 'folder' }], new Map(), new Set(), new Set())}
          activeFile={null}
          selectedFiles={new Set<string>()}
          renamingPath={path}
          actions={actions}
        />,
      );
    });

    const view = EditorView.findFromDOM(tree.container.querySelector<HTMLElement>('.cm-content')!)!;
    expect(view.state.doc.toString()).toBe('New folder');
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe('New folder'.length);
    act(() => tree.unmount());
  });

  it('opens root creation actions on the empty area below the rows', () => {
    createNoteIn.mockClear();
    createFolderIn.mockClear();
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(renderTree(notes[0].id));
    });

    act(() => {
      tree.container.querySelector('.q-file-tree')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
      }));
    });

    const menu = document.querySelector('.q-menu');
    expect(menu).not.toBeNull();
    const items = Array.from(menu!.querySelectorAll('.q-menu__item-label'), (node) => node.textContent);
    expect(items).toHaveLength(2);

    act(() => {
      (menu!.querySelectorAll('.q-menu__item')[0] as HTMLButtonElement).click();
    });
    expect(createNoteIn).toHaveBeenCalledWith('C:\\vault');

    act(() => {
      tree.unmount();
    });
  });

  it('does not open root actions when right-clicking an empty-state button', () => {
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(
        <FileTree
          rows={[]}
          activeFile={null}
          selectedFiles={new Set<string>()}
          renamingPath={null}
          actions={actions}
          rootPath="C:\\vault"
        />,
      );
    });

    act(() => {
      tree.container.querySelector('.q-empty-state__actions button')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 60,
      }));
    });

    expect(document.querySelector('.q-menu')).toBeNull();
    act(() => tree.unmount());
  });

  it('creates inside the folder whose row received the context click', () => {
    const folder = { id: 'C:\\vault\\Projects', name: 'Projects', type: 'folder' as const };
    createNoteIn.mockClear();
    createFolderIn.mockClear();
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(
        <FileTree
          rows={buildVisibleFileRows([folder], new Map(), new Set(), new Set())}
          activeFile={null}
          selectedFiles={new Set<string>()}
          renamingPath={null}
          actions={actions}
          rootPath={'C:\\vault'}
        />,
      );
    });

    act(() => {
      tree.container.querySelector('.q-file-item')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }));
    });
    const menu = document.querySelector('.q-menu')!;
    expect(Array.from(menu.querySelectorAll('.q-menu__item-label'), (node) => node.textContent))
      .toEqual([t('fileTree.newNoteHere'), t('fileTree.newFolderHere'), t('common.rename'), t('common.delete')]);

    act(() => (menu.querySelector('.q-menu__item') as HTMLButtonElement).click());
    expect(createNoteIn).toHaveBeenCalledWith(folder.id);
    act(() => tree.unmount());
  });

  it('keeps the row menu out of the root creation actions', () => {
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(renderTree(notes[0].id));
    });

    act(() => {
      tree.container.querySelector('.q-file-item')!.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }));
    });

    const labels = Array.from(
      document.querySelectorAll('.q-menu__item-label'),
      (node) => node.textContent,
    );
    expect(labels).toEqual([t('common.rename'), t('common.duplicate'), t('common.delete')]);
    expect(labels).not.toContain(t('fileTree.newNote'));
    expect(labels).not.toContain(t('fileTree.newFolder'));

    act(() => {
      tree.unmount();
    });
  });

  it('offers both creation actions in the empty tree state', () => {
    createNoteIn.mockClear();
    createFolderIn.mockClear();
    let tree!: MountedDom;
    act(() => {
      tree = mountDom(
        <FileTree
          rows={[]}
          activeFile={null}
          selectedFiles={new Set<string>()}
          renamingPath={null}
          actions={actions}
          rootPath={'C:\\vault'}
        />,
      );
    });

    const buttons = tree.container.querySelectorAll<HTMLButtonElement>('.q-empty-state__actions button');
    expect(Array.from(buttons, (button) => button.textContent))
      .toEqual([t('fileTree.newNote'), t('fileTree.newFolder')]);

    act(() => buttons[1].click());
    expect(createFolderIn).toHaveBeenCalledWith('C:\\vault');

    act(() => {
      tree.unmount();
    });
  });
});
