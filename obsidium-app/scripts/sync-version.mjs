#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const packageJsonPath = join(projectRoot, 'package.json');
const tauriConfPath = join(projectRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = join(projectRoot, 'src-tauri', 'Cargo.toml');
const coreCargoTomlPath = join(projectRoot, 'core', 'Cargo.toml');

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const version = packageJson.version;
if (!version) throw new Error('package.json has no version field');

async function setFilePattern(path, pattern, replacement) {
  const content = await readFile(path, 'utf8');
  const next = content.replace(pattern, replacement);
  if (content === next) return false;
  await writeFile(path, next, 'utf8');
  return true;
}

const tauriChanged = await setFilePattern(tauriConfPath, /"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
const cargoChanged = await setFilePattern(cargoTomlPath, /^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
const coreChanged = await setFilePattern(coreCargoTomlPath, /^version\s*=\s*"[^"]+"/m, `version = "${version}"`);

if (tauriChanged || cargoChanged || coreChanged) {
  console.log(`Synced app version ${version} from package.json`);
}

if (cargoChanged || coreChanged) {
  const result = spawnSync(
    'cargo',
    ['metadata', '--format-version', '1', '--manifest-path', join(projectRoot, 'src-tauri', 'Cargo.toml')],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('cargo metadata failed after the version sync');
}

console.log(version);
