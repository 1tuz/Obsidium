import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoRoot, 'obsidium-app');
const manifest = path.join(appDir, 'src-tauri/Cargo.toml');
const binaries = path.join(appDir, 'src-tauri/binaries');
const profile = process.argv.includes('--release') ? 'release' : 'debug';

function hostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const line = result.stdout.split('\n').find((entry) => entry.startsWith('host: '));
  if (!line) throw new Error('rustc did not report a host triple');
  return line.slice('host: '.length).trim();
}

function run(command, args, options) {
  const result = spawnSync(command, args, { cwd: appDir, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const triple = hostTriple();
const suffix = process.platform === 'win32' ? '.exe' : '';
const source = path.join(appDir, 'src-tauri/target', profile, `obsidium${suffix}`);
const destination = path.join(binaries, `obsidium-${triple}${suffix}`);

const args = ['build', '--locked', '-p', 'obsidium-cli', '--manifest-path', manifest];
if (profile === 'release') args.push('--release');
run('cargo', args);

if (!existsSync(source)) throw new Error(`the CLI binary is missing at ${source}`);
mkdirSync(binaries, { recursive: true });
copyFileSync(source, destination);
console.log(`sidecar ready: ${path.relative(repoRoot, destination)}`);
