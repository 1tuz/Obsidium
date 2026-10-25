#!/usr/bin/env node
// Compares measured `BENCH-*` lines with scripts/bench/baseline.json and fails on a regression.
//
//   node scripts/bench/check-regression.mjs --baseline=scripts/bench/baseline.json LOG...
//   node scripts/bench/check-regression.mjs --baseline=... --ratio=1.5 LOG...
//
// The baseline holds the recorded value of every gated metric per vault size; the limit is
// `baseline * ratio`. A measured value above the limit fails the run and names the metric, the
// measured value, the baseline and the limit. Sizes without a baseline entry are reported as
// notices instead of failures, so a nightly 10000-note run can use the same baseline file.
import { readFileSync } from 'node:fs';
import { parseLog } from './summarize.mjs';

function parseArguments(argv) {
  const options = { baseline: null, ratio: null, paths: [] };
  for (const argument of argv) {
    if (argument.startsWith('--baseline=')) options.baseline = argument.slice('--baseline='.length);
    else if (argument.startsWith('--ratio=')) options.ratio = Number(argument.slice('--ratio='.length));
    else if (argument.startsWith('--')) throw new Error(`unknown option: ${argument}`);
    else options.paths.push(argument);
  }
  return options;
}

function latestMeasurements(paths) {
  const latest = new Map();
  for (const path of paths) {
    for (const row of parseLog(readFileSync(path, 'utf8'), path)) {
      const key = `${row.kind}:${row.fields.documents}`;
      const current = latest.get(key);
      if (!current || (row.timestamp ?? 0) >= (current.timestamp ?? 0)) latest.set(key, row);
    }
  }
  return latest;
}

function sizeLabel(documents) {
  return documents.toLocaleString('en-US').replace(/,/gu, ' ');
}

function formatNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error('usage: check-regression.mjs --baseline=PATH [--ratio=1.5] LOG...');
    process.exit(2);
  }
  if (!options.baseline || options.paths.length === 0) {
    console.error('usage: check-regression.mjs --baseline=PATH [--ratio=1.5] LOG...');
    process.exit(2);
  }

  const baseline = JSON.parse(readFileSync(options.baseline, 'utf8'));
  const ratio = options.ratio ?? baseline.ratio ?? 1.5;
  const sizes = Object.keys(baseline.sizes ?? {}).map(Number);
  const measurements = latestMeasurements(options.paths);

  if (measurements.size === 0) {
    console.error(`::error title=Performance gate::no BENCH- lines in ${options.paths.join(', ')}`);
    process.exit(1);
  }

  const table = [
    '| Notes | Benchmark | Metric | Baseline | Limit | Measured | Ratio | Result |',
    '| ---: | --- | --- | ---: | ---: | ---: | ---: | :-- |',
  ];
  const regressions = [];
  const missing = [];
  const notices = [];

  for (const [key, row] of [...measurements].sort((left, right) => left[0].localeCompare(right[0]))) {
    const documents = row.fields.documents;
    const recorded = baseline.sizes?.[String(documents)]?.[row.kind];
    if (!recorded) {
      console.error(`::notice title=Performance gate::no baseline for ${row.kind} at ${documents} notes; measured values are reported only.`);
      notices.push(`No baseline for \`${row.kind}\` at ${sizeLabel(documents)} notes: measured values are reported only.`);
      continue;
    }
    for (const [name, expected] of Object.entries(recorded)) {
      const measured = row.fields[name];
      if (!Number.isFinite(measured)) {
        missing.push(`${row.kind} at ${documents} notes: the baseline gates \`${name}\`, but the log has no such field`);
        continue;
      }
      const limit = expected * ratio;
      const ratioToBaseline = expected === 0 ? Infinity : measured / expected;
      const failed = measured > limit;
      if (failed) {
        regressions.push(
          `${row.kind} at ${documents} notes: \`${name}\` = ${formatNumber(measured)}, baseline ${formatNumber(expected)}, limit ${formatNumber(limit)} (${ratio}x).`,
        );
      }
      table.push(
        `| ${sizeLabel(documents)} | \`${row.kind}\` | \`${name}\` | ${formatNumber(expected)} | ${formatNumber(limit)} | ${formatNumber(measured)} | ${Number.isFinite(ratioToBaseline) ? `${ratioToBaseline.toFixed(2)}x` : '∞'} | ${failed ? '**regression**' : 'ok'} |`,
      );
    }
  }

  for (const size of sizes) {
    if (![...measurements.values()].some((row) => row.fields.documents === size)) {
      console.error(`::notice title=Performance gate::the baseline has ${size} notes, but this run measured no such size.`);
      notices.push(`The baseline has ${sizeLabel(size)} notes, but this run measured no such size.`);
    }
  }

  console.log(table.join('\n'));
  for (const notice of notices) console.log(`\n${notice}`);

  if (missing.length > 0 || regressions.length > 0) {
    console.log('');
    for (const problem of missing) console.error(`::error title=Performance gate::${problem}`);
    for (const regression of regressions) console.error(`::error title=Performance regression::${regression}`);
    console.log(`\n**Performance gate failed:** ${regressions.length} regression(s), ${missing.length} missing metric(s).`);
    if (regressions.length > 0) {
      console.log('');
      console.log('Every listed metric grew past its recorded baseline by more than the allowed ratio. Revert the change, or — when the slowdown is intended and measured — update `obsidium-app/scripts/bench/baseline.json` as described in `knowledge base/ci-pipelines.md`.');
      for (const regression of regressions) console.log(`- ${regression}`);
    }
    process.exit(1);
  }

  console.log(`\n**Performance gate passed:** ${table.length - 2} metric(s) within ${ratio}x of the baseline.`);
}

main();
