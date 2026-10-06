#!/usr/bin/env node
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');
const source = join(projectRoot, 'Aquilum-logo.png');
const output = join(projectRoot, 'src-tauri', 'icons');
const tauriBin = join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
);

if (!existsSync(source)) {
  throw new Error(`Icon source not found: ${source}`);
}
if (!existsSync(tauriBin)) {
  throw new Error('Tauri CLI is not installed. Run npm install first.');
}

console.log(`Updating Tauri icons from ${source}`);
if (process.platform === 'win32') {
  execSync(`"${tauriBin}" icon "${source}" --output "${output}"`, {
    cwd: projectRoot,
    stdio: 'inherit',
  });
} else {
  execFileSync(tauriBin, ['icon', source, '--output', output], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}
console.log('Tauri icons updated. Restart the running dev app to see the new icon.');
