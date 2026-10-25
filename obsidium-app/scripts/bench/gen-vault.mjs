#!/usr/bin/env node
// Generates a deterministic Markdown vault for performance measurements.
//
//   node scripts/bench/gen-vault.mjs --out /tmp/vault --notes 1000 [--avg-lines 60]
//                                    [--large 10] [--seed 42] [--folders 10]
//
// `--large N` additionally writes N notes of ~10 000 lines (the "big document" scenario).
// The size mix is meant to be representative of a personal knowledge base: mostly short notes,
// a few medium ones, a handful of huge ones.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const out = arg('out');
if (!out) {
  console.error('usage: gen-vault.mjs --out DIR [--notes N] [--avg-lines N] [--large N]');
  process.exit(2);
}
const notes = Number(arg('notes', 1000));
const avgLines = Number(arg('avg-lines', 60));
const largeNotes = Number(arg('large', 0));
const folders = Math.max(1, Number(arg('folders', 10)));
let seed = Number(arg('seed', 42)) >>> 0;

function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}
const pick = (items) => items[Math.floor(random() * items.length)];

const WORDS = `knowledge graph note index search markdown vault editor render cache memory
latency query token document workspace link backlink heading paragraph frontmatter task
embedding vector database sqlite tantivy engine storage sync conflict history revision
plugin theme canvas table diagram export import archive meeting project research draft
review metric benchmark profile allocation thread worker queue batch commit flush`.split(/\s+/);

const TOPICS = ['Architecture', 'Research', 'Meeting', 'Project', 'Inbox', 'Reading', 'Design', 'Ops'];

function sentence(words = 12) {
  const parts = [];
  for (let i = 0; i < words; i += 1) parts.push(pick(WORDS));
  const text = parts.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

function paragraph() {
  return Array.from({ length: 3 + Math.floor(random() * 4) }, () => sentence(8 + Math.floor(random() * 12))).join(' ');
}

function noteBody(index, lines) {
  const title = `${pick(TOPICS)} ${index}`;
  const out = [`---`, `title: ${title}`, `created: 2026-0${1 + (index % 9)}-1${index % 9}`, `tags: [${pick(WORDS)}, ${pick(WORDS)}]`, `---`, ``, `# ${title}`, ``];
  let written = out.length;
  let section = 0;
  while (written < lines) {
    if (section % 5 === 0) {
      out.push(`## Section ${section}`);
      out.push('');
      written += 2;
    }
    out.push(paragraph());
    out.push('');
    written += 2;
    if (random() < 0.08) {
      const target = Math.floor(random() * notes);
      out.push(`- [[${pick(TOPICS)} ${target}]] — related note`);
      out.push('');
      written += 2;
    }
    if (random() < 0.05) {
      out.push(`- [ ] follow up on ${pick(WORDS)} ${pick(WORDS)}`);
      out.push('');
      written += 2;
    }
    if (random() < 0.03) {
      out.push('| metric | value |', '| --- | --- |', `| ${pick(WORDS)} | ${Math.floor(random() * 1000)} |`, '');
      written += 4;
    }
    section += 1;
  }
  return out.join('\n');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const started = Date.now();
let bytes = 0;
for (let index = 0; index < notes; index += 1) {
  const folder = join(out, `folder-${index % folders}`);
  mkdirSync(folder, { recursive: true });
  const lines = Math.max(8, Math.round(avgLines * (0.3 + random() * 1.7)));
  const body = noteBody(index, lines);
  const path = join(folder, `${pick(TOPICS)} ${index}.md`);
  writeFileSync(path, body);
  bytes += Buffer.byteLength(body);
}
for (let index = 0; index < largeNotes; index += 1) {
  const body = noteBody(notes + index, 10_000);
  const path = join(out, `Large ${index}.md`);
  writeFileSync(path, body);
  bytes += Buffer.byteLength(body);
}

console.log(
  JSON.stringify({
    vault: out,
    notes: notes + largeNotes,
    large_notes: largeNotes,
    avg_lines: avgLines,
    markdown_bytes: bytes,
    markdown_mb: Number((bytes / 1024 / 1024).toFixed(2)),
    generation_ms: Date.now() - started,
  }),
);
