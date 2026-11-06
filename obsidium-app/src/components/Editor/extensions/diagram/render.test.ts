// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));

import { renderDiagram } from './render';

afterEach(() => vi.clearAllMocks());

it('asks Mermaid to render labels as XML-safe SVG text', async () => {
  mermaidMock.render.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
  const source = 'flowchart TD\n  A["first<br/>second"] --> B';

  await renderDiagram(source);

  expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ htmlLabels: false }));
  expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), source);
});
