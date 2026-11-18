import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF ?? 'origin/main';

const RUST_ROOTS = [
  'obsidium-app/src-tauri', 'obsidium-app/core', 'obsidium-app/cli',
  '.cargo', 'obsidium-app/.cargo', 'obsidium-app/rust-toolchain',
  'obsidium-app/rust-toolchain.toml', 'rustfmt.toml', '.rustfmt.toml',
];

const VERSION_ONLY_PATHS = new Set([
  'obsidium-app/core/Cargo.toml',
  'obsidium-app/cli/Cargo.toml',
  'obsidium-app/src-tauri/Cargo.toml',
  'obsidium-app/src-tauri/Cargo.lock',
  'obsidium-app/src-tauri/tauri.conf.json',
]);

const WORKSPACE_CRATES = new Set(['obsidium-app', 'obsidium-core', 'obsidium-cli']);

const PACKAGE_VERSION_LINE = /^version\s*=\s*"[^"]*"\s*$/;
const TABLE_HEADER_LINE = /^\s*\[/;
const LOCK_VERSION_LINE = /^version\s*=\s*"[^"]*"\s*$/;
const LOCK_NAME_LINE = /^name\s*=\s*"([^"]+)"\s*$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function readBase(path, base = BASE_REF) {
  try {
    return git(['show', `${base}:${path}`]);
  } catch {
    return null;
  }
}

function readWorktree(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function withoutPackageVersion(text) {
  const lines = text.split('\n');
  let index = lines.findIndex((line) => line.trim() === '[package]');
  if (index < 0) return null;
  index += 1;
  for (; index < lines.length && !TABLE_HEADER_LINE.test(lines[index]); index += 1) {
    if (PACKAGE_VERSION_LINE.test(lines[index])) {
      lines.splice(index, 1);
      return lines.join('\n');
    }
  }
  return null;
}

function withoutTauriVersion(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  delete parsed.version;
  return JSON.stringify(parsed);
}

function withoutWorkspaceLockVersions(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '[[package]]') {
      current = { lines: [], name: null };
      blocks.push(current);
      continue;
    }
    if (!current) {
      blocks.push({ lines: [line], name: null });
      continue;
    }
    current.lines.push(line);
    if (current.name === null) {
      const match = LOCK_NAME_LINE.exec(line);
      if (match) current.name = match[1];
    }
  }
  return blocks
    .map((block) => {
      const lines = block.name !== null && WORKSPACE_CRATES.has(block.name)
        ? block.lines.filter((line) => !LOCK_VERSION_LINE.test(line))
        : block.lines;
      return lines.join('\n');
    })
    .join('\n');
}

function strippedText(path, text) {
  if (text === null) return null;
  if (path.endsWith('Cargo.lock')) return withoutWorkspaceLockVersions(text);
  if (path.endsWith('tauri.conf.json')) return withoutTauriVersion(text);
  return withoutPackageVersion(text);
}

function rustChanges(base) {
  return git(['diff', '--name-only', base, '--', ...RUST_ROOTS])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function isVersionOnly(paths, baseText, worktreeText) {
  if (paths.length === 0) return false;
  for (const path of paths) {
    if (!VERSION_ONLY_PATHS.has(path)) return false;
    const base = strippedText(path, baseText(path));
    const worktree = strippedText(path, worktreeText(path));
    if (base === null || worktree === null || base !== worktree) return false;
  }
  return true;
}

export function detect(paths, readBaseText = readBase, readWorktreeText = readWorktree) {
  return isVersionOnly(paths, readBaseText, readWorktreeText) ? 'false' : 'true';
}

function emit(buildRequired) {
  const line = `build_required=${buildRequired}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  else process.stdout.write(`${line}\n`);
  if (buildRequired === 'false') {
    console.log('Only package versions changed; skipping Linux Tauri dependencies and sidecar build.');
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const base = git(['merge-base', BASE_REF, 'HEAD']).trim();
  emit(detect(rustChanges(base), (path) => readBase(path, base)));
}
