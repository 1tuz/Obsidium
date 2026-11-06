import type { Mermaid, MermaidConfig } from 'mermaid';
import { diagramKey, rememberDiagramResult, type DiagramResult } from './store';
import { diagramThemeKey, diagramThemeVariables } from './theme';

let loader: Promise<Mermaid> | null = null;
let initializedKey = '';
let renderCounter = 0;
let queue: Promise<void> = Promise.resolve();

function loadMermaid(): Promise<Mermaid> {
  if (!loader) {
    loader = import('mermaid').then((module) => module.default);
  }
  return loader;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!cleaned) return 'diagram failed';
  return cleaned.length > 400 ? `${cleaned.slice(0, 400)}…` : cleaned;
}

function configure(mermaid: Mermaid, themeKey: string): void {
  if (themeKey === initializedKey) return;
  const variables = diagramThemeVariables();
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: { ...variables, darkMode: document.documentElement.dataset.theme === 'dark' },
    fontFamily: variables.fontFamily,
    htmlLabels: false,
    flowchart: { useMaxWidth: true, curve: 'basis' },
    sequence: { useMaxWidth: true },
    class: { useMaxWidth: true },
    state: { useMaxWidth: true },
    er: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  };
  mermaid.initialize(config);
  initializedKey = themeKey;
}

async function run(source: string, themeKey: string): Promise<DiagramResult> {
  try {
    const mermaid = await loadMermaid();
    configure(mermaid, themeKey);
    renderCounter += 1;
    const { svg } = await mermaid.render(`q-diagram-${renderCounter}`, source);
    if (!svg.trim()) return { status: 'failed', message: 'diagram failed' };
    return { status: 'ready', svg };
  } catch (error) {
    return { status: 'failed', message: errorMessage(error) };
  }
}

export function renderDiagram(source: string): Promise<boolean> {
  const themeKey = diagramThemeKey();
  const key = diagramKey(source, themeKey);
  const task = queue.then(async () => rememberDiagramResult(key, await run(source, themeKey)));
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
