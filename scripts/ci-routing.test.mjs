import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { route } from './ci-routing.mjs';

test('a push without an open PR runs scoped checks and owner auto-merge', () => {
  assert.deepEqual(route('push'), {
    runChecks: true,
    runAutoMerge: true,
    fullChecks: false,
  });
});

test('a push with an open PR delegates checks to the full PR diff', () => {
  assert.deepEqual(route('push', true), {
    runChecks: false,
    runAutoMerge: false,
    fullChecks: false,
  });
});

test('pull requests run full-diff checks and owner PRs may merge after the gate', () => {
  assert.deepEqual(route('pull_request'), {
    runChecks: true,
    runAutoMerge: true,
    fullChecks: false,
  });
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
  assert.match(ci, /group:\s*ci-\$\{\{[^\n]+ref_name/u);
  assert.match(ci, /group:\s*ci-\$\{\{\s*github\.event_name/u);
});

test('nightly runs full checks at 02:00 UTC+3 and has no release publication', () => {
  const nightly = readFileSync('.github/workflows/nightly-tests.yml', 'utf8');
  assert.match(nightly, /cron:\s*['"]?0 23 \* \* \*['"]?/u);
  assert.match(nightly, /npm test/u);
  assert.match(nightly, /cargo test[^\n]*--workspace/u);
  assert.match(nightly, /npm run build/u);
  assert.doesNotMatch(nightly, /tauri-action|gh release|upload-artifact/iu);
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
