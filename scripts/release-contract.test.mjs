import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectPlatformAssets, createUpdaterManifest, versionFromTag } from './release-contract.mjs';

test('release tags accept only stable semantic versions', () => {
  assert.equal(versionFromTag('v0.3.7'), '0.3.7');
  assert.throws(() => versionFromTag('0.3.7'));
  assert.throws(() => versionFromTag('v0.3.7-rc.1'));
});

test('collects exact platform installers and updater signatures', () => {
  const root = mkdtempSync(join(tmpdir(), 'obsidium-release-test-'));
  const source = join(root, 'bundle');
  const destination = join(root, 'assets');
  mkdirSync(source);
  for (const name of ['Obsidium_0.3.7_x64-setup.exe', 'Obsidium_0.3.7_x64-setup.exe.sig']) {
    writeFileSync(join(source, name), 'signed');
  }
  try {
    assert.deepEqual(collectPlatformAssets('windows', '0.3.7', source, destination).sort(), [
      'Obsidium_0.3.7_x64-setup.exe', 'Obsidium_0.3.7_x64-setup.exe.sig',
    ]);
    assert.equal(readFileSync(join(destination, 'Obsidium_0.3.7_x64-setup.exe.sig'), 'utf8'), 'signed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renames macOS updater outputs to the versioned manifest names', () => {
  const root = mkdtempSync(join(tmpdir(), 'obsidium-macos-release-test-'));
  const source = join(root, 'bundle');
  const destination = join(root, 'assets');
  mkdirSync(source);
  for (const name of ['Obsidium_0.3.7_aarch64.dmg', 'Obsidium.app.tar.gz', 'Obsidium.app.tar.gz.sig']) {
    writeFileSync(join(source, name), 'signed');
  }
  try {
    assert.deepEqual(collectPlatformAssets('macos', '0.3.7', source, destination).sort(), [
      'Obsidium_0.3.7_aarch64.app.tar.gz',
      'Obsidium_0.3.7_aarch64.app.tar.gz.sig',
      'Obsidium_0.3.7_aarch64.dmg',
    ]);
    assert.equal(readFileSync(join(destination, 'Obsidium_0.3.7_aarch64.app.tar.gz'), 'utf8'), 'signed');
    assert.equal(readFileSync(join(destination, 'Obsidium_0.3.7_aarch64.app.tar.gz.sig'), 'utf8'), 'signed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updater manifest includes the three signed platform targets and compatibility aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'obsidium-manifest-test-'));
  const names = [
    'Obsidium_0.3.7_amd64.deb.sig',
    'Obsidium_0.3.7_aarch64.app.tar.gz.sig',
    'Obsidium_0.3.7_x64-setup.exe.sig',
  ];
  try {
    for (const name of names) writeFileSync(join(root, name), 'signature');
    const manifest = createUpdaterManifest('v0.3.7', '1tuz/Obsidium', root, '2026-10-09T00:00:00.000Z');
    assert.equal(manifest.version, '0.3.7');
    assert.equal(manifest.platforms['darwin-aarch64'].url,
      'https://github.com/1tuz/Obsidium/releases/download/v0.3.7/Obsidium_0.3.7_aarch64.app.tar.gz');
    assert.deepEqual(manifest.platforms['linux-x86_64-deb'], manifest.platforms['linux-x86_64']);
    assert.deepEqual(manifest.platforms['windows-x86_64-nsis'], manifest.platforms['windows-x86_64']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
