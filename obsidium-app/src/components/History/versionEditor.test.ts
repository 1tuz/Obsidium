// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createVersionEditor } from './versionEditor';
import type { VersionChunk } from '../../modules/history';

const previous = 'один\nдва\nтри\nчетыре\nпять\n';
const version = 'один\nдва правка\nтри\nчетыре\nпять правка\n';

function open() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const reverted: VersionChunk[] = [];
  const editor = createVersionEditor(host, { text: version, previous }, {
    onRevertChunk: (chunk) => reverted.push(chunk),
  });
  return { editor, reverted, host };
}

describe('the version diff', () => {
  it('gives the version without one chunk and keeps the others', () => {
    const { editor } = open();
    const pos = version.indexOf('два правка');

    const chunk = editor.chunkRevertAt(pos);

    expect(chunk?.revertedText).toBe('один\nдва\nтри\nчетыре\nпять правка\n');
    expect(chunk?.from).toBe(pos);
  });

  it('forgets the chunk it has already reverted', () => {
    const { editor } = open();
    const pos = version.indexOf('два правка');
    const chunk = editor.chunkRevertAt(pos);

    expect(editor.markReverted(chunk!)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(chunk!.revertedText);
    expect(editor.chunkRevertAt(pos)).toBeNull();
    expect(editor.chunkRevertAt(editor.view.state.doc.toString().indexOf('пять правка'))?.revertedText)
      .toBe('один\nдва\nтри\nчетыре\nпять\n');
  });

  it('accepts one chunk and keeps the version text', () => {
    const { editor } = open();
    const pos = version.indexOf('два правка');

    expect(editor.acceptChunkAt(pos)).toBe(true);

    expect(editor.view.state.doc.toString()).toBe(version);
    expect(editor.chunkRevertAt(pos)).toBeNull();
    expect(editor.chunkRevertAt(version.indexOf('пять правка'))).not.toBeNull();
  });

  it('reverts the chunk whose button was pressed', () => {
    const { editor, reverted, host } = open();
    const button = host.querySelector<HTMLButtonElement>('.q-history-chunk-button--reject');

    expect(button).not.toBeNull();
    button!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(reverted).toHaveLength(1);
    expect(reverted[0].revertedText).toBe('один\nдва\nтри\nчетыре\nпять правка\n');
    expect(editor.view.state.doc.toString()).toBe(version);
  });

  it('accepts the chunk whose keep button was pressed', () => {
    const { editor, reverted, host } = open();
    const button = host.querySelector<HTMLButtonElement>('.q-history-chunk-button--accept');

    button!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(reverted).toHaveLength(0);
    expect(editor.view.state.doc.toString()).toBe(version);
    expect(editor.chunkRevertAt(version.indexOf('два правка'))).toBeNull();
  });

  it('offers nothing to revert when the version has no previous text', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createVersionEditor(host, { text: version, previous: null }, {
      onRevertChunk: () => undefined,
    });

    expect(editor.chunkRevertAt(version.indexOf('два правка'))).toBeNull();
  });
});
