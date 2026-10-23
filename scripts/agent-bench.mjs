import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCorpus, QUESTION_KINDS, SEED } from './agent-bench-corpus.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const executable = process.platform === 'win32' ? 'obsidium.exe' : 'obsidium';
const defaultBin = process.env.OBSIDIUM_BIN
  ? path.resolve(process.env.OBSIDIUM_BIN)
  : path.join(repoRoot, 'obsidium-app/src-tauri/target/debug', executable);
const defaultQuestions = path.join(scriptDir, 'agent-bench-questions.json');
const AVAILABLE_STRATEGIES = ['rg', 'mcp', 'context'];
const STOPWORDS = new Set([
  'а', 'без', 'бы', 'в', 'во', 'вот', 'вы', 'да', 'для', 'до', 'его', 'ее', 'если', 'есть',
  'же', 'за', 'и', 'из', 'или', 'их', 'к', 'как', 'какая', 'какие', 'какой', 'когда', 'кто',
  'ли', 'мне', 'мы', 'на', 'над', 'не', 'нет', 'но', 'ну', 'о', 'об', 'он', 'она', 'они',
  'от', 'по', 'при', 'с', 'со', 'так', 'там', 'то', 'у', 'уже', 'что', 'чтобы', 'это', 'я',
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'how',
  'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when',
  'where', 'which', 'who', 'why', 'with',
]);

function parseArgs(argv) {
  const options = {
    strategies: AVAILABLE_STRATEGIES.slice(),
    questions: defaultQuestions,
    warm: 2,
    json: false,
    report: null,
    keep: false,
    root: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') options.json = true;
    else if (item === '--keep') options.keep = true;
    else if (item === '--help') options.help = true;
    else if (item === '--strategies') options.strategies = (argv[++index] || '').split(',').map((value) => value.trim()).filter(Boolean);
    else if (item === '--questions') options.questions = path.resolve(argv[++index]);
    else if (item === '--warm') options.warm = Number(argv[++index]);
    else if (item === '--report') options.report = path.resolve(argv[++index]);
    else if (item === '--root') options.root = path.resolve(argv[++index]);
    else if (item === '--seed') options.seed = Number(argv[++index]);
    else throw new Error(`unknown argument: ${item}`);
  }
  return options;
}

function usage() {
  return [
    'usage: node scripts/agent-bench.mjs [--strategies rg,mcp,context] [--questions FILE]',
    '       [--warm N] [--json] [--report FILE] [--keep] [--root DIR] [--seed N]',
  ].join('\n');
}

function readQuestions(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function validateQuestions(questions, manifest) {
  const problems = [];
  if (!Array.isArray(questions)) problems.push('question file must be a JSON array');
  if (Array.isArray(questions) && questions.length < 40) {
    problems.push(`expected at least 40 questions, got ${questions.length}`);
  }
  const paths = new Set(manifest.notes.map((note) => note.path));
  const kinds = new Set();
  const ids = new Set();
  let empty = 0;
  for (const question of questions || []) {
    const label = question.id || '<no id>';
    if (!question.id || typeof question.id !== 'string') problems.push(`${label}: missing id`);
    if (ids.has(question.id)) problems.push(`${label}: duplicate id`);
    ids.add(question.id);
    if (typeof question.query !== 'string' || !question.query.trim()) problems.push(`${label}: missing query`);
    if (!['ru', 'en'].includes(question.lang)) problems.push(`${label}: lang must be ru or en`);
    if (typeof question.kind !== 'string' || !question.kind) problems.push(`${label}: missing kind`);
    kinds.add(question.kind);
    if (!Array.isArray(question.expected)) problems.push(`${label}: expected must be an array`);
    else {
      if (question.expected.length === 0) empty += 1;
      for (const expected of question.expected) {
        if (!expected || typeof expected.path !== 'string') problems.push(`${label}: expected entry without path`);
        else if (!paths.has(expected.path)) problems.push(`${label}: expected path is absent from corpus: ${expected.path}`);
        if (expected && expected.lineStart !== undefined && expected.lineEnd !== undefined && expected.lineStart > expected.lineEnd) {          problems.push(`${label}: lineStart is greater than lineEnd for ${expected.path}`);
        }
      }
    }
    for (const forbidden of question.mustNotInclude || []) {
      if (!paths.has(forbidden)) problems.push(`${label}: mustNotInclude path is absent from corpus: ${forbidden}`);
    }
    if (typeof question.notes !== 'string' || !question.notes) problems.push(`${label}: missing notes`);
  }
  for (const kind of QUESTION_KINDS) {
    if (!kinds.has(kind)) problems.push(`question kinds do not cover ${kind}`);
  }
  if (empty < 3) problems.push(`expected at least 3 questions with empty ground truth, got ${empty}`);
  return problems;
}

function environment(dataDir) {
  const value = { ...process.env, OBSIDIUM_DATA_DIR: dataDir };
  delete value.OBSIDIUM_WORKSPACE;
  return value;
}

function runProcess(command, args, options = {}) {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = performance.now() - started;
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ms,
    bytes: Buffer.byteLength(result.stdout || ''),
  };
}

function cli(bin, workspace, dataDir, args) {
  return runProcess(bin, ['--workspace', workspace, '--json', ...args], { env: environment(dataDir) });
}

function parseJson(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label}: exit ${result.status}\n${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label}: stdout is not JSON: ${result.stdout.slice(0, 300)}`);
  }
}

function normalizePath(value, vault) {
  const absolute = path.isAbsolute(value) ? value : path.resolve(vault, value);
  return path.relative(vault, absolute).split(path.sep).join('/');
}

function queryTerms(query, kind) {
  if (kind === 'exact') return [query];
  const raw = query.toLowerCase().replace(/[^\p{L}\p{N}_./-]+/gu, ' ').split(/\s+/);
  const terms = [];
  for (const token of raw) {
    const value = token.replace(/^[./-]+|[./-]+$/g, '');
    if (!value) continue;
    if (STOPWORDS.has(value)) continue;
    if (value.length < 3 && !/\d/.test(value)) continue;
    if (!terms.includes(value)) terms.push(value);
  }
  return terms.length ? terms : [query];
}

function measureRg(question, vault) {
  const patterns = queryTerms(question.query, question.kind);
  const args = ['--json', '--no-messages', '-i', '-F'];
  for (const pattern of patterns) args.push('-e', pattern);
  args.push('.');
  const grep = runProcess('rg', args, { cwd: vault });
  if (grep.status !== 0 && grep.status !== 1) {
    throw new Error(`rg ${question.id}: exit ${grep.status}\n${grep.stderr}`);
  }
  const counts = new Map();
  for (const line of grep.stdout.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'match') continue;
    const relative = normalizePath(event.data.path.text, vault);
    counts.set(relative, (counts.get(relative) || 0) + 1);
  }
  const matched = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'ru'))
    .map(([relative]) => relative);
  const files = [];
  let bytes = grep.bytes;
  const readStarted = performance.now();
  for (const relative of matched) {
    const content = readFileSync(path.join(vault, relative), 'utf8');
    files.push({ path: relative, content });
    bytes += Buffer.byteLength(content);
  }
  const ms = grep.ms + (performance.now() - readStarted);
  return {
    paths: matched,
    results: files,
    connections: new Set(),
    calls: 1 + matched.length,
    bytes,
    ms,
  };
}

function measureMcp(bin, question, vault, dataDir) {
  const search = cli(bin, vault, dataDir, ['search', question.query]);
  const payload = parseJson(search, `search ${question.id}`);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const paths = results.map((result) => result.path);
  const reads = [];
  let bytes = search.bytes;
  let ms = search.ms;
  for (const result of results.slice(0, 3)) {
    const read = cli(bin, vault, dataDir, ['note', 'read', result.path]);
    const note = parseJson(read, `note read ${question.id} ${result.path}`);
    reads.push({ path: result.path, content: note.content || '' });
    bytes += read.bytes;
    ms += read.ms;
  }
  return {
    paths,
    results,
    reads,
    connections: new Set(),
    calls: 1 + Math.min(3, results.length),
    bytes,
    ms,
  };
}

function measureContext(bin, question, vault, dataDir) {
  const search = cli(bin, vault, dataDir, ['context', 'search', question.query]);
  const payload = parseJson(search, `context search ${question.id}`);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const paths = [];
  for (const result of results) {
    if (!paths.includes(result.path)) paths.push(result.path);
  }
  const connections = new Set();
  let bytes = search.bytes;
  let ms = search.ms;
  if (question.kind === 'graph') {
    const related = cli(bin, vault, dataDir, ['context', 'connections', question.query]);
    const graph = parseJson(related, `context connections ${question.id}`);
    for (const node of graph.nodes || []) {
      connections.add(node.path);
      if (!paths.includes(node.path)) paths.push(node.path);
    }
    for (const edge of graph.edges || []) {
      connections.add(edge.from);
      connections.add(edge.to);
      if (!paths.includes(edge.from)) paths.push(edge.from);
      if (!paths.includes(edge.to)) paths.push(edge.to);
    }
    bytes += related.bytes;
    ms += related.ms;
  }
  return {
    paths,
    results,
    connections,
    calls: question.kind === 'graph' ? 2 : 1,
    bytes,
    ms,
  };
}

function expectedLines(question, expected, vault, cache) {
  if (expected.lineStart === undefined) return null;
  if (!cache.has(expected.path)) {
    cache.set(expected.path, readFileSync(path.join(vault, expected.path), 'utf8').split('\n'));
  }
  const lines = cache.get(expected.path);
  return lines.slice(expected.lineStart - 1, expected.lineEnd).join('\n');
}

function supportsContext(measurement, question, vault, cache) {
  return question.expected.every((expected) => {
    if (expected.lineStart === undefined) {
      return measurement.results.some((result) => result.path === expected.path)
        || measurement.connections.has(expected.path);
    }
    return measurement.results.some((result) =>
      result.path === expected.path
      && result.lineStart <= expected.lineStart
      && result.lineEnd >= expected.lineEnd);
  });
}

function supportsMcp(measurement, question, vault, cache) {
  return question.expected.every((expected) => {
    const read = measurement.reads.find((item) => item.path === expected.path);
    if (!read) return false;
    const text = expectedLines(question, expected, vault, cache);
    return text === null || read.content.includes(text);
  });
}

function supportsRg(measurement, question, vault, cache) {
  return question.expected.every((expected) => {
    const file = measurement.results.find((item) => item.path === expected.path);
    if (!file) return false;
    const text = expectedLines(question, expected, vault, cache);
    return text === null || file.content.includes(text);
  });
}

function evaluate(strategy, question, measurement, vault, cache) {
  const paths = measurement.paths;
  const expected = question.expected;
  const recallAt = (limit) => {
    if (expected.length === 0) return paths.length === 0 ? 1 : 0;
    const head = paths.slice(0, limit);
    return expected.filter((item) => head.includes(item.path)).length / expected.length;
  };
  let mrr = 0;
  if (expected.length > 0) {
    const index = paths.findIndex((candidate) => expected.some((item) => item.path === candidate));
    if (index >= 0) mrr = 1 / (index + 1);
  }
  let supported;
  if (expected.length === 0) supported = paths.length === 0;
  else if (strategy === 'rg') supported = supportsRg(measurement, question, vault, cache);
  else if (strategy === 'mcp') supported = supportsMcp(measurement, question, vault, cache);
  else supported = supportsContext(measurement, question, vault, cache);
  const violations = (question.mustNotInclude || []).filter((forbidden) => paths.slice(0, 5).includes(forbidden));
  return {
    recall5: recallAt(5),
    recall10: recallAt(10),
    mrr,
    supported: supported ? 1 : 0,
    falsePositive: expected.length === 0 && paths.length > 0 ? 1 : 0,
    violations: violations.length,
    violationPaths: violations,
    calls: measurement.calls,
    bytes: measurement.bytes,
    ms: measurement.ms,
    paths: paths.slice(0, 10),
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const base = Math.floor(position);
  const rest = position - base;
  if (base + 1 >= sorted.length) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(rows, coldSamples, warmSamples) {
  return {
    questions: rows.length,
    recall5: mean(rows.map((row) => row.recall5)),
    recall10: mean(rows.map((row) => row.recall10)),
    mrr: mean(rows.map((row) => row.mrr)),
    supported: mean(rows.map((row) => row.supported)),
    calls: mean(rows.map((row) => row.calls)),
    bytes: mean(rows.map((row) => row.bytes)),
    tokens: Math.round(mean(rows.map((row) => row.bytes)) / 4),
    falsePositives: rows.reduce((sum, row) => sum + row.falsePositive, 0),
    violations: rows.reduce((sum, row) => sum + row.violations, 0),
    p50Warm: percentile(warmSamples, 0.5),
    p95Warm: percentile(warmSamples, 0.95),
    p50Cold: percentile(coldSamples, 0.5),
    p95Cold: percentile(coldSamples, 0.95),
  };
}

function byKind(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.kind)) groups.set(row.kind, []);
    groups.get(row.kind).push(row);
  }
  const result = {};
  for (const [kind, items] of groups) {
    result[kind] = {
      questions: items.length,
      recall5: mean(items.map((item) => item.recall5)),
      recall10: mean(items.map((item) => item.recall10)),
      mrr: mean(items.map((item) => item.mrr)),
      supported: mean(items.map((item) => item.supported)),
      calls: mean(items.map((item) => item.calls)),
      bytes: mean(items.map((item) => item.bytes)),
      falsePositives: items.reduce((sum, item) => sum + item.falsePositive, 0),
      violations: items.reduce((sum, item) => sum + item.violations, 0),
    };
  }
  return result;
}

function failuresFor(rows) {
  return rows.filter((row) =>
    row.recall5 < 1
    || row.supported < 1
    || row.violationPaths.length > 0
    || row.falsePositive > 0);
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatBytes(value) {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} КиБ`;
  return `${Math.round(value)} Б`;
}

function formatMs(value) {
  return value === null ? '—' : `${value.toFixed(1)} мс`;
}

function printTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length)));
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join(' | ');
  console.log(line(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('-+-'));
  for (const row of rows) console.log(line(row));
}

function commitInfo() {
  const full = runProcess('git', ['rev-parse', 'HEAD']);
  const short = runProcess('git', ['rev-parse', '--short', 'HEAD']);
  return {
    commit: full.status === 0 ? full.stdout.trim() : 'unknown',
    commitShort: short.status === 0 ? short.stdout.trim() : 'unknown',
  };
}

function buildReport(result) {
  const lines = [];
  const { corpus, strategies, questions, commit, commitShort, generatedAt, command } = result;
  lines.push('# Отчёт бенчмарка поиска по базе знаний', '');
  lines.push(`- Коммит: \`${commit}\` (\`${commitShort}\`)`);
  lines.push(`- Дата прогона: ${generatedAt}`);
  lines.push(`- Корпус: ${corpus.count} заметок, seed ${corpus.seed}`);
  lines.push(`- Вопросов: ${questions.total}`);
  lines.push(`- Команда: \`${command}\``);
  lines.push('');
  lines.push('## Сводка по стратегиям', '');
  lines.push('| Стратегия | Recall@5 | Recall@10 | MRR | supported | Вызовов | Контекст | ~токенов | p50 warm | p95 warm | p50 cold | p95 cold | Ложных | Нарушений mustNotInclude |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const name of AVAILABLE_STRATEGIES) {
    const strategy = strategies[name];
    if (!strategy || strategy.skipped) {
      lines.push(`| ${name} | пропущен | — | — | — | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const overall = strategy.overall;
    lines.push(
      `| ${name} | ${formatPercent(overall.recall5)} | ${formatPercent(overall.recall10)} | ` +
      `${overall.mrr.toFixed(3)} | ${formatPercent(overall.supported)} | ${overall.calls.toFixed(1)} | ` +
      `${formatBytes(overall.bytes)} | ${overall.tokens} | ${formatMs(overall.p50Warm)} | ${formatMs(overall.p95Warm)} | ` +
      `${formatMs(overall.p50Cold)} | ${formatMs(overall.p95Cold)} | ${overall.falsePositives} | ${overall.violations} |`,
    );
  }
  lines.push('');
  lines.push('Токены приблизительные: байты контекста делятся на 4. Для `rg` холодный и тёплый замеры совпадают: индекса нет.');
  lines.push('');
  lines.push('## Разбивка по типам вопросов', '');
  lines.push('| Тип | Стратегия | Вопросов | Recall@5 | Recall@10 | MRR | supported | Вызовов | Контекст |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const kind of QUESTION_KINDS) {
    for (const name of AVAILABLE_STRATEGIES) {
      const strategy = strategies[name];
      if (!strategy || strategy.skipped || !strategy.byKind[kind]) continue;
      const item = strategy.byKind[kind];
      lines.push(
        `| ${kind} | ${name} | ${item.questions} | ${formatPercent(item.recall5)} | ` +
        `${formatPercent(item.recall10)} | ${item.mrr.toFixed(3)} | ${formatPercent(item.supported)} | ` +
        `${item.calls.toFixed(1)} | ${formatBytes(item.bytes)} |`,
      );
    }
  }
  lines.push('');
  lines.push('## Где что выигрывает', '');
  const available = AVAILABLE_STRATEGIES.filter((name) => strategies[name] && !strategies[name].skipped);
  const metric = (name, kind, field) => {
    const item = strategies[name] && strategies[name].byKind[kind];
    return item ? item[field] : undefined;
  };
  const pct = (value) => (value === undefined ? '—' : formatPercent(value));
  const kib = (value) => (value === undefined ? '—' : formatBytes(value));
  const join = (kind, field, formatter = pct) =>
    available.map((name) => `${name} ${formatter(metric(name, kind, field))}`).join(', ');
  lines.push(`- Точная строка в одном файле (exact): Recall@5 — ${join('exact', 'recall5')}.`);
  lines.push(`- Большие заметки (large): supported — ${join('large', 'supported')}; контекст — ${join('large', 'bytes', kib)}.`);
  lines.push(`- Синтез по нескольким заметкам (synthesis): supported — ${join('synthesis', 'supported')}; Recall@10 — ${join('synthesis', 'recall10')}.`);
  lines.push(`- Обход графа (graph): supported — ${join('graph', 'supported')}; Recall@10 — ${join('graph', 'recall10')}; контекст — ${join('graph', 'bytes', kib)}.`);
  lines.push(`- Перефраз (paraphrase): Recall@5 — ${join('paraphrase', 'recall5')}.`);
  lines.push(`- Противоречия (contradiction): Recall@5 — ${join('contradiction', 'recall5')}.`);
  lines.push(`- Ловушки near-duplicate: нарушений mustNotInclude — ${join('duplicate', 'violations', (value) => String(value ?? '—'))}.`);
  lines.push(`- Устаревшие данные (stale): нарушений mustNotInclude — ${join('stale', 'violations', (value) => String(value ?? '—'))}.`);
  lines.push(`- Пустые вопросы (empty): ложных срабатываний — ${join('empty', 'falsePositives', (value) => String(value ?? '—'))}.`);
  lines.push('');
  lines.push('## Вопросы, где стратегия не нашла ожидаемое', '');
  for (const name of available) {
    const failures = strategies[name].failures;
    lines.push(`### ${name}`, '');
    if (!failures.length) {
      lines.push('Все вопросы закрыты полностью.', '');
      continue;
    }
    for (const failure of failures) {
      const expected = failure.expected.length ? failure.expected.join(', ') : '(пусто)';
      const got = failure.paths.length ? failure.paths.join(', ') : '(ничего)';
      const reasons = [];
      if (failure.recall5 < 1) reasons.push(`Recall@5 ${formatPercent(failure.recall5)}`);
      if (!failure.supported) reasons.push('ожидаемая строка не попала в контекст');
      if (failure.violations.length) reasons.push(`запрещённые пути: ${failure.violations.join(', ')}`);
      if (failure.falsePositive) reasons.push('ложное срабатывание на пустом вопросе');
      lines.push(`- \`${failure.id}\` (${failure.kind}): ${reasons.join('; ')}. Ожидалось: ${expected}. Получено: ${got}.`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.strategies.length) throw new Error('no strategies selected');
  for (const name of options.strategies) {
    if (!AVAILABLE_STRATEGIES.includes(name)) throw new Error(`unknown strategy: ${name}`);
  }
  if (!Number.isInteger(options.warm) || options.warm < 1) throw new Error('--warm must be a positive integer');
  if (!existsSync(options.questions)) throw new Error(`question file not found: ${options.questions}`);

  const questions = readQuestions(options.questions);
  const autoRoot = !options.root;
  const root = options.root || mkdtempSync(path.join(tmpdir(), 'obsidium-agent-bench-'));
  mkdirSync(root, { recursive: true });
  const { vault, manifest } = generateCorpus({ root, seed: options.seed ?? SEED });
  const problems = validateQuestions(questions, manifest);
  if (problems.length) {
    throw new Error(`question file is invalid:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  }
  if (options.strategies.some((name) => name !== 'rg') && !existsSync(defaultBin)) {
    throw new Error(`obsidium binary not found: ${defaultBin}`);
  }
  const rgAvailable = runProcess('rg', ['--version']).status === 0;
  const commit = commitInfo();
  const generatedAt = new Date().toISOString().slice(0, 10);
  const command = `node scripts/agent-bench.mjs ${process.argv.slice(2).join(' ')}`.trim();
  const expectedCache = new Map();
  const strategies = {};

  for (const name of options.strategies) {
    if (name === 'rg' && !rgAvailable) {
      strategies.rg = { skipped: true, reason: 'ripgrep not found' };
      continue;
    }
    const dataDir = path.join(root, `data-${name}-warm`);
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(dataDir, { recursive: true });
    if (name === 'mcp') {
      parseJson(cli(defaultBin, vault, dataDir, ['search', 'kubernetes']), 'mcp warmup');
    } else if (name === 'context') {
      parseJson(cli(defaultBin, vault, dataDir, ['context', 'search', 'kubernetes']), 'context warmup');
    }
    const rows = [];
    const coldSamples = [];
    const warmSamples = [];
    for (const question of questions) {
      const warmMeasurements = [];
      for (let repeat = 0; repeat < options.warm; repeat += 1) {
        const measurement = name === 'rg'
          ? measureRg(question, vault)
          : name === 'mcp'
            ? measureMcp(defaultBin, question, vault, dataDir)
            : measureContext(defaultBin, question, vault, dataDir);
        warmMeasurements.push(measurement);
        warmSamples.push(measurement.ms);
      }
      const warm = warmMeasurements[0];
      const row = evaluate(name, question, warm, vault, expectedCache);
      row.id = question.id;
      row.kind = question.kind;
      row.expected = question.expected.map((item) => item.path);
      rows.push(row);
      if (name === 'rg') {
        coldSamples.push(warm.ms);
      } else {
        const coldDir = path.join(root, `data-${name}-cold-${question.id}`);
        rmSync(coldDir, { recursive: true, force: true });
        mkdirSync(coldDir, { recursive: true });
        const cold = name === 'mcp'
          ? measureMcp(defaultBin, question, vault, coldDir)
          : measureContext(defaultBin, question, vault, coldDir);
        coldSamples.push(cold.ms);
        rmSync(coldDir, { recursive: true, force: true });
      }
    }
    const overall = summarize(rows, coldSamples, warmSamples);
    strategies[name] = {
      skipped: false,
      overall,
      byKind: byKind(rows),
      failures: failuresFor(rows).map((row) => ({
        id: row.id,
        kind: row.kind,
        recall5: row.recall5,
        recall10: row.recall10,
        supported: row.supported,
        expected: row.expected,
        paths: row.paths,
        violations: row.violationPaths,
        falsePositive: row.falsePositive,
      })),
      rows,
    };
  }

  const result = {
    ...commit,
    generatedAt,
    command,
    corpus: { count: manifest.count, seed: manifest.seed, vault },
    questions: {
      total: questions.length,
      byKind: questions.reduce((acc, question) => {
        acc[question.kind] = (acc[question.kind] || 0) + 1;
        return acc;
      }, {}),
    },
    strategies,
  };

  if (options.report) {
    mkdirSync(path.dirname(options.report), { recursive: true });
    writeFileSync(options.report, buildReport(result), 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`commit ${result.commitShort}, corpus ${result.corpus.count} notes, questions ${result.questions.total}`);
    const rows = [];
    for (const name of AVAILABLE_STRATEGIES) {
      const strategy = strategies[name];
      if (!strategy || strategy.skipped) {
        rows.push([name, 'skipped', '—', '—', '—', '—', '—', '—', '—']);
        continue;
      }
      const overall = strategy.overall;
      rows.push([
        name,
        formatPercent(overall.recall5),
        formatPercent(overall.recall10),
        overall.mrr.toFixed(3),
        formatPercent(overall.supported),
        overall.calls.toFixed(1),
        formatBytes(overall.bytes),
        formatMs(overall.p50Warm),
        formatMs(overall.p95Warm),
      ]);
    }
    printTable(['strategy', 'R@5', 'R@10', 'MRR', 'supported', 'calls', 'context', 'p50 warm', 'p95 warm'], rows);
    if (options.report) console.log(`report: ${options.report}`);
  }

  if (autoRoot && !options.keep) rmSync(root, { recursive: true, force: true });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
