// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { HeadingMinimap } from './HeadingMinimap';
import { minimapExtension } from './extensions/blocks/minimapBridge';

const BODY = '# One\n\n## Two\n\nbody text\n';

let renderer: MountedDom | null = null;
let view: EditorView | null = null;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (renderer) act(() => renderer?.unmount());
  renderer = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function mountReading(readOnly: boolean): HTMLElement {
  const container = document.createElement('div');
  container.className = 'q-editor-container';
  const content = document.createElement('div');
  content.className = `q-editor-content${readOnly ? ' q-editor-content--reading' : ''}`;
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  content.append(body);
  container.append(content);
  document.body.append(container);
  view = new EditorView({
    parent: body,
    state: EditorState.create({
      doc: BODY,
      extensions: [minimapExtension(), EditorState.readOnly.of(readOnly)],
    }),
  });
  act(() => {
    renderer = mountDom(<HeadingMinimap view={view} />);
  });
  return body;
}

it('anchors the minimap to the reading viewport with fixed positioning', () => {
  mountReading(true);
  const nav = renderer!.container.querySelector<HTMLElement>('.q-block-minimap')!;
  expect(nav.style.position).toBe('fixed');
});

it('keeps the minimap in the document flow while editing', () => {
  mountReading(false);
  const nav = renderer!.container.querySelector<HTMLElement>('.q-block-minimap')!;
  expect(nav.style.position).toBe('');
});

it('shows a borderless label on hover instead of a native tooltip', () => {
  mountReading(true);
  const stroke = renderer!.container.querySelector<HTMLElement>('.q-block-minimap__stroke')!;
  expect(stroke.getAttribute('title')).toBeNull();
  expect(renderer!.container.querySelector('.q-block-minimap__label')).toBeNull();

  act(() => {
    stroke.dispatchEvent(new Event('pointerenter'));
  });
  const label = renderer!.container.querySelector<HTMLElement>('.q-block-minimap__label')!;
  expect(label).not.toBeNull();
  expect(label.textContent).toBe('One');

  act(() => {
    stroke.dispatchEvent(new Event('pointerleave'));
  });
  expect(renderer!.container.querySelector('.q-block-minimap__label')).toBeNull();
});
