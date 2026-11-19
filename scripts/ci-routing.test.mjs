import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import test from 'node:test';
import { route } from './ci-routing.mjs';

const REPO = resolve(import.meta.dirname, '..');
const CI = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
const DETECT = join(REPO, 'scripts/rust-build-detect.mjs');

const VERSION_ONLY_MANIFESTS = {
  'obsidium-app/src-tauri/Cargo.toml': '[package]\nname = "obsidium-app"\nversion = "0.5.40"\n\n[workspace]\nmembers = [".", "../core", "../cli"]\n',
  'obsidium-app/core/Cargo.toml': '[package]\nname = "obsidium-core"\nversion = "0.5.40"\n\n[dependencies.serde]\nversion = "1.0.200"\nfeatures = ["derive"]\n',
  'obsidium-app/cli/Cargo.toml': '[package]\nname = "obsidium-cli-package"\nversion = "0.5.40"\n',
  'obsidium-app/src-tauri/Cargo.lock': 'version = 3\n\n[[package]]\nname = "obsidium-app"\nversion = "0.5.40"\n\n[[package]]\nname = "obsidium-core"\nversion = "0.5.40"\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\n',
  'obsidium-app/src-tauri/tauri.conf.json': '{\n  "productName": "Obsidium",\n  "version": "0.5.40",\n  "identifier": "com.obsidium.app"\n}\n',
};

const SOURCES = {
  'obsidium-app/core/src/lib.rs': 'pub fn base() {}\n',
  'obsidium-app/src-tauri/src/lib.rs': 'pub fn base() {}\n',
  'obsidium-app/cli/src/main.rs': 'fn main() {}\n',
};

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'CI',
      GIT_AUTHOR_EMAIL: 'ci@example.com',
      GIT_COMMITTER_NAME: 'CI',
      GIT_COMMITTER_EMAIL: 'ci@example.com',
    },
  });
}

function writeAll(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}

function buildRepo(mutate) {
  const root = mkdtempSync(join(tmpdir(), 'obsidium-rust-detect-'));
  git(root, ['init', '-q', '-b', 'main']);
  writeAll(root, { ...VERSION_ONLY_MANIFESTS, ...SOURCES });
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  mutate(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'change']);
  return root;
}

function detection(root) {
  const output = join(root, 'github-output');
  rmSync(output, { force: true });
  const result = spawnSync(process.execPath, [DETECT], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: 'origin/main', GITHUB_OUTPUT: output },
  });
  assert.equal(result.status, 0, result.stderr);
  const line = readFileSync(output, 'utf8').trim();
  assert.match(line, /^build_required=(true|false)$/u);
  return { buildRequired: line.split('=')[1], stdout: result.stdout };
}

function bumpVersions(root) {
  for (const path of ['obsidium-app/src-tauri/Cargo.toml', 'obsidium-app/core/Cargo.toml', 'obsidium-app/cli/Cargo.toml']) {
    const full = join(root, path);
    writeFileSync(full, readFileSync(full, 'utf8').replace('version = "0.5.40"', 'version = "0.5.41"'));
  }
  const lock = join(root, 'obsidium-app/src-tauri/Cargo.lock');
  writeFileSync(lock, readFileSync(lock, 'utf8').replaceAll('version = "0.5.40"', 'version = "0.5.41"'));
  const conf = join(root, 'obsidium-app/src-tauri/tauri.conf.json');
  writeFileSync(conf, readFileSync(conf, 'utf8').replace('"version": "0.5.40"', '"version": "0.5.41"'));
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test('every owner push runs scoped checks and owner auto-merge', () => {
  assert.deepEqual(route('push'), {
    runChecks: true,
    runAutoMerge: true,
    fullChecks: false,
  });
});

test('CI has no pull request trigger that can require a second approval', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /  push:/u);
  assert.match(ci, /  workflow_dispatch:/u);
  assert.doesNotMatch(ci, /^  pull_request:/mu);
  assert.doesNotMatch(ci, /Find an open pull request for this branch/u);
  assert.match(ci, /github\.event_name == 'push' && github\.actor == github\.repository_owner/u);
  assert.doesNotMatch(ci, /github\.event_name == 'pull_request'/u);
});

test('owner merge never asks GitHub to enable auto-merge', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /gh pr merge[^\n]*--merge/u);
  assert.doesNotMatch(ci, /--auto/u);
});

test('a lockfile-only change resolves the lock instead of compiling the workspace', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /Resolve the committed lockfile/u);
  assert.match(ci, /cargo metadata --locked/u);
  const filters = readFileSync('.github/filters.yml', 'utf8');
  assert.match(filters, /rust_lock:\n\s+- 'obsidium-app\/src-tauri\/Cargo\.lock'/u);
});

test('a version-only release bump does not rebuild the workspace', () => {
  const root = buildRepo(bumpVersions);
  try {
    const result = detection(root);
    assert.equal(result.buildRequired, 'false');
    assert.match(result.stdout, /Only package versions changed/u);
  } finally {
    cleanup(root);
  }
});

test('a dependency-table version bump forces the full build', () => {
  const root = buildRepo((dir) => {
    const path = join(dir, 'obsidium-app/core/Cargo.toml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('version = "1.0.200"', 'version = "1.0.201"'));
  });
  try {
    assert.equal(detection(root).buildRequired, 'true');
  } finally {
    cleanup(root);
  }
});

test('a mixed source change and version bump forces the full build', () => {
  const root = buildRepo((dir) => {
    bumpVersions(dir);
    const path = join(dir, 'obsidium-app/core/src/lib.rs');
    writeFileSync(path, `${readFileSync(path, 'utf8')}pub fn added() {}\n`);
  });
  try {
    assert.equal(detection(root).buildRequired, 'true');
  } finally {
    cleanup(root);
  }
});

test('a build or toolchain configuration change forces the full build', () => {
  const root = buildRepo((dir) => {
    bumpVersions(dir);
    writeFileSync(join(dir, 'obsidium-app/src-tauri/build.rs'), 'fn main() {}\n');
  });
  try {
    assert.equal(detection(root).buildRequired, 'true');
  } finally {
    cleanup(root);
  }
});

test('a non-workspace lock entry version change forces the full build', () => {
  const root = buildRepo((dir) => {
    const path = join(dir, 'obsidium-app/src-tauri/Cargo.lock');
    writeFileSync(path, readFileSync(path, 'utf8').replace('name = "serde"\nversion = "1.0.200"', 'name = "serde"\nversion = "1.0.201"'));
  });
  try {
    assert.equal(detection(root).buildRequired, 'true');
  } finally {
    cleanup(root);
  }
});

test('a missing or unparseable version anchor is never treated as version-only', () => {
  const missing = buildRepo((dir) => {
    const path = join(dir, 'obsidium-app/cli/Cargo.toml');
    writeFileSync(path, readFileSync(path, 'utf8').replace('version = "0.5.40"\n', ''));
  });
  const broken = buildRepo((dir) => writeFileSync(join(dir, 'obsidium-app/src-tauri/tauri.conf.json'), 'not json\n'));
  try {
    assert.equal(detection(missing).buildRequired, 'true');
    assert.equal(detection(broken).buildRequired, 'true');
  } finally {
    cleanup(missing);
    cleanup(broken);
  }
});

test('the routed Rust test step runs the real Cargo commands for each changed crate', () => {
  const step = CI.match(/      - name: Test changed Rust packages\n([\s\S]*?)\n      - name: Run the agent surface smoke test/u);
  assert.ok(step, 'the Rust test step is missing');
  const block = step[1].match(/        run: \|\n([\s\S]*)$/u);
  assert.ok(block, 'the Rust test step must keep an executable script');
  const script = block[1].replace(/^ {10}/gmu, '');
  assert.match(step[0], /steps\.rust_build\.outputs\.build_required == 'true'/u);

  const cases = [
    [{ WORKSPACE_CHANGED: 'true' }, ['--workspace']],
    [{ CORE_CHANGED: 'true' }, ['-p obsidium-core']],
    [{ APP_CHANGED: 'true', CLI_CHANGED: 'true' }, ['-p obsidium-app', '-p obsidium-cli-package']],
  ];
  for (const [env, expected] of cases) {
    const root = mkdtempSync(join(tmpdir(), 'obsidium-cargo-stub-'));
    try {
      const bin = join(root, 'bin');
      const log = join(root, 'cargo.log');
      mkdirSync(bin);
      const stub = join(bin, 'cargo');
      writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n`);
      chmodSync(stub, 0o755);
      const fullEnv = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, ...env };
      const result = spawnSync('bash', ['-c', script], { cwd: REPO, encoding: 'utf8', env: fullEnv });
      assert.equal(result.status, 0, result.stderr);
      const invocations = readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(invocations.length, expected.length);
      for (const [index, invocation] of invocations.entries()) {
        assert.ok(invocation.includes(expected[index]), `${invocation} must select ${expected[index]}`);
        assert.ok(invocation.includes('--locked --manifest-path obsidium-app/src-tauri/Cargo.toml'), invocation);
      }
    } finally {
      cleanup(root);
    }
  }
});

test('CI routes against origin/main because main pushes never trigger it', () => {
  assert.match(CI, /  push:\n    branches-ignore: \[main\]/u);
  assert.doesNotMatch(CI, /github\.event\.before/u);
  assert.match(CI, /BASE_REF: origin\/main/u);
  assert.match(CI, /node scripts\/rust-build-detect\.mjs/u);
});

test('manual CI runs every lightweight check and does not auto-merge', () => {
  assert.deepEqual(route('workflow_dispatch'), {
    runChecks: true,
    runAutoMerge: false,
    fullChecks: true,
  });
});

test('repeated pushes cancel the previous CI run for the same branch', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /cancel-in-progress:\s*true/u);
  assert.match(ci, /group:\s*ci-\$\{\{\s*github\.ref\s*\}\}/u);
});

test('nightly runs full checks at 02:00 UTC+3 and has no release publication', () => {
  const nightly = readFileSync('.github/workflows/nightly-tests.yml', 'utf8');
  assert.match(nightly, /cron:\s*['"]?0 23 \* \* \*['"]?/u);
  assert.match(nightly, /npm test/u);
  assert.match(nightly, /cargo test[^\n]*--workspace/u);
  assert.match(nightly, /npm run build/u);
  assert.doesNotMatch(nightly, /tauri-action|gh release|upload-artifact/iu);
});

test('the agent surface filter covers the CLI, MCP, links, wiki, and task sources', () => {
  const filters = readFileSync('.github/filters.yml', 'utf8');
  const block = filters.match(/agent_surface:\n((?:\s+- '[^']+'\n)+)/u);
  assert.ok(block, 'agent_surface filter is missing');
  for (const pattern of [
    'obsidium-app/cli/**',
    'obsidium-app/core/src/mcp/**',
    'obsidium-app/core/src/links/**',
    'obsidium-app/core/src/wiki/**',
    'obsidium-app/core/src/search/tasks/**',
    'scripts/agent-smoke.mjs',
  ]) {
    assert.ok(block[1].includes(`- '${pattern}'`), `agent_surface must include ${pattern}`);
  }
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /steps\.changes\.outputs\.agent_surface == 'true'/u);
  assert.match(ci, /node scripts\/agent-smoke\.mjs/u);
  assert.match(ci, /cargo build --locked --manifest-path obsidium-app\/src-tauri\/Cargo\.toml -p obsidium-cli-package/u);
});
test('the CLI package name stays distinct from its shipped sidecar binary names', () => {
  const manifest = readFileSync('obsidium-app/cli/Cargo.toml', 'utf8');
  assert.match(manifest, /^name = "obsidium-cli-package"$/mu);
  assert.match(manifest, /^name = "obsidium"$/mu);
});

test('nightly runs the full agent surface smoke test', () => {
  const nightly = readFileSync('.github/workflows/nightly-tests.yml', 'utf8');
  assert.match(nightly, /agent-integration:/u);
  assert.match(nightly, /timeout-minutes:/u);
  assert.match(nightly, /node scripts\/agent-smoke\.mjs --full/u);
});

test('release builds all platforms before the single publish job', () => {
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(release, /tags:\s*\[['"]v\*['"]\]/u);
  assert.match(release, /workflow_dispatch:/u);
  assert.match(release, /cancel-in-progress:\s*false/u);
  assert.match(release, /platform: Windows[\s\S]*platform: macOS[\s\S]*platform: Linux/u);
  assert.match(release, /needs:\s*\[preflight, build\]/u);
  assert.equal((release.match(/gh release edit[^\n]*--draft=false/gu) ?? []).length, 1);
});

test('Rust formatting receives changed source paths without formatting unrelated files', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /RUST_CORE_FILES:[^\n]*rust_core_files/u);
  assert.match(ci, /RUST_APP_FILES:[^\n]*rust_app_files/u);
  assert.match(ci, /RUST_CLI_FILES:[^\n]*rust_cli_files/u);
  assert.match(ci, /node scripts\/check-rust-format\.mjs/u);
});

test('the performance gate benchmarks core changes and fails on a baseline regression', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const job = ci.match(/\n  performance:\n([\s\S]*?)\n  auto-merge:/u);
  assert.ok(job, 'performance job is missing');
  assert.match(job[1], /steps\.changes\.outputs\.rust_core_bench/u);
  assert.match(job[1], /OBSIDIUM_BENCH_SIZES: '1000'/u);
  assert.match(job[1], /for bench in benchmark_indexing benchmark_search_pipeline/u);
  assert.match(job[1], /summarize\.mjs --format=summary/u);
  assert.match(job[1], /check-regression\.mjs/u);
  assert.match(job[1], /--baseline=obsidium-app\/scripts\/bench\/baseline\.json/u);
  assert.match(job[1], /GITHUB_STEP_SUMMARY/u);
  assert.match(ci, /needs:\s*\[route, quality, performance\]/u);

  const filters = readFileSync('.github/filters.yml', 'utf8');
  assert.match(filters, /rust_core_bench:\n\s+- 'obsidium-app\/core\/\*\*'/u);

  const baseline = JSON.parse(readFileSync('obsidium-app/scripts/bench/baseline.json', 'utf8'));
  assert.ok(baseline.ratio > 1, 'the baseline must define a regression ratio above 1');
  for (const metric of ['search_us', 'bm25f_warm_us']) {
    assert.ok(baseline.sizes['1000'].benchmark_search_pipeline[metric] > 0, `baseline must gate ${metric}`);
  }
  assert.ok(baseline.sizes['1000'].benchmark_indexing.cold_ms > 0, 'baseline must gate cold_ms');
});

test('the strict YAML parser rejects duplicate keys in filters and workflows', () => {
  const checker = resolve(REPO, 'scripts/check-workflow-yaml.rb');
  const clean = spawnSync('ruby', [checker], { cwd: REPO, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /\.github\/filters\.yml: valid/u);

  const root = mkdtempSync(join(tmpdir(), 'obsidium-yaml-'));
  try {
    const duplicated = join(root, 'filters.yml');
    writeFileSync(duplicated, readFileSync(join(REPO, '.github/filters.yml'), 'utf8') + '\nworkflow:\n  - \'scripts/ci-routing.mjs\'\n');
    const result = spawnSync('ruby', [checker, duplicated], { cwd: REPO, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate key workflow/u);
  } finally {
    cleanup(root);
  }
});

test('editing the routing helper re-runs the workflow checks', () => {
  const filters = readFileSync(join(REPO, '.github/filters.yml'), 'utf8');
  const block = filters.match(/workflow:\n((?:\s+- '[^']+'\n)+)/u);
  assert.ok(block, 'workflow filter is missing');
  for (const pattern of ['scripts/rust-build-detect.mjs', 'scripts/ci-routing.test.mjs', '.github/filters.yml']) {
    assert.ok(block[1].includes(`- '${pattern}'`), `workflow filter must include ${pattern}`);
  }
});
