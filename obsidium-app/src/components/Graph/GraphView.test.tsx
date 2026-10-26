// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const graphStyles = readFileSync(
  resolve(process.cwd(), 'src/components/Graph/GraphView.css'),
  'utf8',
);
const graphView = readFileSync(
  resolve(process.cwd(), 'src/components/Graph/GraphView.tsx'),
  'utf8',
);

describe('GraphView inactive tab', () => {
  it('keeps the canvas geometry while the tab is inactive', () => {
    expect(graphStyles).toMatch(
      /\.q-graph--inactive\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s,
    );
  });

  it('never removes the inactive graph from layout', () => {
    expect(graphStyles).not.toMatch(/\.q-graph--hidden/);
    expect(graphStyles).not.toMatch(/\.q-graph--inactive\s*\{[^}]*display:\s*none;/s);
  });

  it('applies the class the stylesheet hides with geometry', () => {
    expect(graphView).toContain('q-graph--inactive');
    expect(graphView).not.toContain('q-graph--hidden');
  });

  it('mounts the canvas once activated and keeps it across tab switches', () => {
    expect(graphView).toMatch(/const \[activated, setActivated\] = useState\(!inactive\);/);
    expect(graphView).toMatch(/if \(!inactive\) setActivated\(true\);/);
    expect(graphView).toMatch(/\{activated && <canvas className="q-graph-canvas"/);
  });
});
