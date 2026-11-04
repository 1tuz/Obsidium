import { describe, expect, it } from 'vitest';
import { scanBlocks } from './model';
import { applyTurnInto, turnIntoChanges, turnTargetFor } from './turnInto';

function convert(source: string, target: Parameters<typeof applyTurnInto>[2], from = 0, to = source.length): string {
  return applyTurnInto(source, [{ from, to }], target);
}

describe('turn into', () => {
  it('converts a paragraph into headings and back', () => {
    expect(convert('Hello world', 'heading2')).toBe('## Hello world');
    expect(convert('## Already heading', 'paragraph')).toBe('Already heading');
    expect(convert('Hello world', 'heading6')).toBe('###### Hello world');
  });

  it('converts paragraphs into every list kind and back', () => {
    expect(convert('Item', 'bullet')).toBe('- Item');
    expect(convert('Item', 'task')).toBe('- [ ] Item');
    expect(convert('Item', 'ordered')).toBe('1. Item');
    expect(convert('- [x] done', 'paragraph')).toBe('done');
    expect(convert('3) third', 'bullet')).toBe('- third');
  });

  it('keeps multi-line content when converting to a list item', () => {
    expect(convert('First line\nsecond line', 'bullet')).toBe('- First line\n  second line');
    expect(convert('- First line\n  second line', 'paragraph')).toBe('First line\nsecond line');
  });

  it('converts quotes, callouts and toggles', () => {
    expect(convert('> quote\n> continues', 'paragraph')).toBe('quote\ncontinues');
    expect(convert('> [!note]- Title\n> body', 'paragraph')).toBe('Title\nbody');
    expect(convert('> [!note]- Title\n> body', 'toggle')).toBe('> [!note]- Title\n> body');
    expect(convert('Title\nbody', 'toggle')).toBe('> [!note]- Title\n> body');
    expect(convert('text', 'quote')).toBe('> text');
  });

  it('strips and adds code fences without merging content', () => {
    expect(convert('```ts\nconst x = 1;\n```', 'paragraph')).toBe('const x = 1;');
    expect(convert('const x = 1;', 'code')).toBe('```\nconst x = 1;\n```');
  });

  it('preserves block references on the last line', () => {
    expect(convert('Paragraph ^abc123', 'heading1')).toBe('# Paragraph ^abc123');
    expect(convert('## Heading ^abc123', 'bullet')).toBe('- Heading ^abc123');
  });

  it('converts several selected blocks in one transaction', () => {
    const source = ['alpha', '', 'beta', '', 'gamma'].join('\n');
    const changes = turnIntoChanges(source, [{ from: 0, to: source.length }], 'heading3');
    expect(changes).toHaveLength(3);
    expect(convert(source, 'heading3')).toBe(['### alpha', '', '### beta', '', '### gamma'].join('\n'));
  });

  it('only converts blocks touched by the selection', () => {
    const source = ['alpha', '', 'beta', '', 'gamma'].join('\n');
    const blocks = scanBlocks(source);
    const beta = blocks[1]!;
    expect(convert(source, 'bullet', beta.from, beta.to)).toBe(
      ['alpha', '', '- beta', '', 'gamma'].join('\n'),
    );
  });

  it('normalises nested list items without losing indentation', () => {
    const source = ['    - nested', '      continuation'].join('\n');
    expect(convert(source, 'quote')).toBe('> nested\n> continuation');
    expect(convert('- top', 'ordered')).toBe('1. top');
  });

  it('reports the target of an existing block', () => {
    const source = ['## Heading', '- [ ] task', '1. ordered', '> quote', '```', 'code', '```'].join('\n');
    const targets = scanBlocks(source).map(turnTargetFor);
    expect(targets).toEqual(['heading2', 'task', 'ordered', 'quote', 'code']);
  });

  it('ignores frontmatter and dividers', () => {
    const source = ['---', 'title: x', '---', '', '---'].join('\n');
    expect(convert(source, 'heading1')).toBe(source);
  });
});
