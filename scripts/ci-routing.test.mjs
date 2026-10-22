import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { route } from './ci-routing.mjs';

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
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /Only package versions changed/u);
  assert.match(ci, /cargo test --locked --manifest-path "\$manifest" --workspace/u);
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
  assert.match(ci, /cargo build --locked --manifest-path obsidium-app\/src-tauri\/Cargo\.toml -p obsidium-cli/u);
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
