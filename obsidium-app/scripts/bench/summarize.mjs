#!/usr/bin/env node
// Turns benchmark logs into the Markdown tables used by the CI job summary and README.md.
//
//   node scripts/bench/summarize.mjs [--format=summary|readme] [--at=TIMESTAMP,...] LOG...
//
// Reads both shapes of a log line: the raw `BENCH-INDEX ...` / `BENCH-SEARCH ...` stdout of a
// release test run, and the `[timestamp] key=value ...` lines that the harness appends to
// `.artifacts/benchmarks/<name>.log`. The bench kind comes from the `BENCH-*` tag or the file name.
// `--at` pins a historical set of runs by their log timestamps, which is how the README table keeps
// one coherent run per vault size instead of mixing every experiment recorded in the log.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const KIND_BY_TAG = {
  INDEX: 'benchmark_indexing',
  SEARCH: 'benchmark_search_pipeline',
  LINK: 'benchmark_link_pipeline',
  GRAPH: 'benchmark_graph_layout',
};

const KIND_BY_FILE = {
  indexing: 'benchmark_indexing',
  search_pipeline: 'benchmark_search_pipeline',
  link_pipeline: 'benchmark_link_pipeline',
  graph_layout: 'benchmark_graph_layout',
};

const NUMBER = /^-?\d+(?:\.\d+)?$/u;

function parseValue(raw) {
  return NUMBER.test(raw) ? Number(raw) : raw;
}

export function parseLog(text, source = '') {
  const fromFile = KIND_BY_FILE[basename(source).replace(/\.log$/u, '')] ?? 'unknown';
  const rows = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) continue;
    const tag = /^BENCH-([A-Z]+)\s+(?=\S)/u.exec(line);
    let body = tag ? line.slice(tag[0].length) : line;
    const stamp = /^\[(\d+)\]\s*/u.exec(body);
    const timestamp = stamp ? Number(stamp[1]) : null;
    if (stamp) body = body.slice(stamp[0].length);
    const fields = {};
    for (const token of body.split(/\s+/u)) {
      const separator = token.indexOf('=');
      if (separator > 0) fields[token.slice(0, separator)] = parseValue(token.slice(separator + 1));
    }
    if (!Number.isFinite(fields.documents)) continue;
    rows.push({ kind: (tag && KIND_BY_TAG[tag[1]]) ?? fromFile, source, timestamp, fields });
  }
  return rows;
}

export function readLogs(paths) {
  return paths.flatMap((path) => parseLog(readFileSync(path, 'utf8'), path));
}

function metric(row, key) {
  const value = row?.fields[key];
  return Number.isFinite(value) ? value : null;
}

function latestBySize(rows, kind) {
  const latest = new Map();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const size = row.fields.documents;
    const current = latest.get(size);
    if (!current || (row.timestamp ?? 0) >= (current.timestamp ?? 0)) latest.set(size, row);
  }
  return latest;
}

function selectRows(rows, kind, pinned) {
  const latest = latestBySize(
    pinned ? rows.filter((row) => row.timestamp !== null && pinned.has(row.timestamp)) : rows,
    kind,
  );
  return [...latest.values()].sort((left, right) => left.fields.documents - right.fields.documents);
}

function fixed(value, digits) {
  const text = value.toFixed(digits);
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/u, '').replace(/\.$/u, '');
  return trimmed === '-0' ? '0' : trimmed;
}

function cell(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Math.abs(value) >= 100 ? fixed(value, 0) : fixed(value, digits);
}

function milliseconds(microseconds) {
  return microseconds === null ? null : microseconds / 1000;
}

function seconds(millisecondsValue) {
  return millisecondsValue === null ? null : millisecondsValue / 1000;
}

function bytes(value) {
  if (value === null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${units[unit]}`;
}

function sizeLabel(documents) {
  return documents.toLocaleString('en-US').replace(/,/gu, ' ');
}

function peakRssMb(directory, documents) {
  const path = join(directory, `app-cold-${documents}.tsv`);
  if (!existsSync(path)) return null;
  let peak = 0;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 2) continue;
    const rss = Number(columns[1]);
    if (Number.isFinite(rss) && rss > peak) peak = rss;
  }
  return peak === 0 ? null : peak / 1024;
}

function table(headers, rows) {
  const divider = headers.map(() => '---:').join(' | ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${divider} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function indexingTable(rows) {
  const body = rows.map((row) => [
    sizeLabel(row.fields.documents),
    cell(metric(row, 'cold_ms')),
    cell(metric(row, 'incremental_ms')),
    cell(metric(row, 'save_median_ms')),
    cell(metric(row, 'docs_per_sec_cold'), 0),
    bytes(metric(row, 'index_bytes')),
  ]);
  return table(
    ['Notes', 'Cold, ms', 'Incremental, ms', 'Single save (median), ms', 'Docs/s', 'Index'],
    body,
  );
}

function searchTable(rows) {
  const body = rows.map((row) => [
    sizeLabel(row.fields.documents),
    cell(metric(row, 'initial_scan_ms')),
    cell(metric(row, 'warm_scan_ms')),
    cell(milliseconds(metric(row, 'repeated_search_median_us')), 2),
    cell(milliseconds(metric(row, 'bm25f_cold_us')), 2),
    cell(milliseconds(metric(row, 'bm25f_warm_us')), 2),
    bytes(metric(row, 'index_bytes')),
  ]);
  return table(
    [
      'Notes',
      'First scan, ms',
      'Warm scan, ms',
      'Search (median), ms',
      'BM25F cold, ms',
      'BM25F warm, ms',
      'Index',
    ],
    body,
  );
}

function readmeRows(rows, pinned) {
  const merged = new Map();
  for (const row of rows) {
    if (row.kind !== 'benchmark_indexing' && row.kind !== 'benchmark_search_pipeline') continue;
    if (pinned && (row.timestamp === null || !pinned.has(row.timestamp))) continue;
    const documents = row.fields.documents;
    const entry = merged.get(documents) ?? {
      documents,
      coldMs: null,
      warmUs: null,
      bm25fWarmUs: null,
      indexBytes: null,
      directory: dirname(row.source),
    };
    if (row.kind === 'benchmark_indexing') {
      entry.coldMs = metric(row, 'cold_ms') ?? entry.coldMs;
      entry.indexBytes = metric(row, 'index_bytes') ?? entry.indexBytes;
    } else {
      entry.coldMs = metric(row, 'initial_scan_ms') ?? entry.coldMs;
      entry.warmUs = metric(row, 'repeated_search_median_us') ?? metric(row, 'search_us') ?? entry.warmUs;
      entry.bm25fWarmUs = metric(row, 'bm25f_warm_us') ?? entry.bm25fWarmUs;
      entry.indexBytes = metric(row, 'index_bytes') ?? entry.indexBytes;
    }
    merged.set(documents, entry);
  }
  return [...merged.values()].sort((left, right) => left.documents - right.documents);
}

function rssCell(entry) {
  const rss = peakRssMb(entry.directory, entry.documents);
  return rss === null ? '—' : `${rss.toFixed(0)} MB`;
}

function readmeTable(rows, pinned) {
  const body = readmeRows(rows, pinned).map((entry) => [
    sizeLabel(entry.documents),
    entry.coldMs === null ? '—' : `${fixed(seconds(entry.coldMs), 2)} s`,
    entry.warmUs === null ? '—' : `${fixed(milliseconds(entry.warmUs), 2)} ms`,
    entry.bm25fWarmUs === null ? '—' : `${fixed(milliseconds(entry.bm25fWarmUs), 2)} ms`,
    bytes(entry.indexBytes),
    rssCell(entry),
  ]);
  return table(['Notes', 'Cold indexing', 'Warm search', 'BM25F, warm', 'Index size', 'Process RSS'], body);
}

function parseArguments(argv) {
  const options = { format: 'summary', pinned: null, paths: [] };
  for (const argument of argv) {
    if (argument.startsWith('--format=')) options.format = argument.slice('--format='.length);
    else if (argument.startsWith('--at=')) {
      options.pinned = new Set(
        argument
          .slice('--at='.length)
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isFinite(value)),
      );
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown option: ${argument}`);
    } else options.paths.push(argument);
  }
  if (options.format !== 'summary' && options.format !== 'readme') {
    throw new Error(`unknown format: ${options.format}`);
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('usage: summarize.mjs [--format=summary|readme] [--at=TIMESTAMP,...] LOG...');
    process.exit(2);
  }
  if (options.paths.length === 0) {
    console.error('usage: summarize.mjs [--format=summary|readme] [--at=TIMESTAMP,...] LOG...');
    process.exit(2);
  }

  const rows = readLogs(options.paths);
  if (options.format === 'readme') {
    const body = readmeRows(rows, options.pinned);
    if (body.length === 0) {
      console.error(`no benchmark lines in ${options.paths.join(', ')}`);
      process.exit(1);
    }
    console.log(readmeTable(rows, options.pinned));
    return;
  }

  const indexing = selectRows(rows, 'benchmark_indexing', options.pinned);
  const search = selectRows(rows, 'benchmark_search_pipeline', options.pinned);
  if (indexing.length === 0 && search.length === 0) {
    console.error(`no benchmark lines in ${options.paths.join(', ')}`);
    process.exit(1);
  }
  const sections = [];
  if (indexing.length > 0) sections.push(`**Indexing**\n\n${indexingTable(indexing)}`);
  if (search.length > 0) sections.push(`**Search**\n\n${searchTable(search)}`);
  console.log(sections.join('\n\n'));
}

if (process.argv[1] && basename(process.argv[1]) === 'summarize.mjs') main();
