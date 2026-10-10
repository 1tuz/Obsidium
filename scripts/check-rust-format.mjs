import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function changedRustFiles() {
  const base = process.env.GITHUB_REF_NAME === 'main'
    ? ['HEAD^', 'HEAD']
    : [`${process.env.CI_BASE_REF || 'origin/main'}...HEAD`];
  const result = spawnSync('git', ['diff', '--name-only', ...base], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.split('\n').filter((path) => path.endsWith('.rs'));
}

const inputs = process.env.CI_EVENT === 'workflow_dispatch'
  ? [JSON.stringify(changedRustFiles())]
  : [process.env.RUST_CORE_FILES, process.env.RUST_APP_FILES, process.env.RUST_CLI_FILES];
const files = [...new Set(inputs.flatMap((value) => JSON.parse(value || '[]')))]
  .filter((path) => path.endsWith('.rs') && existsSync(path));

if (files.length === 0) process.exit(0);

const result = spawnSync('rustfmt', [
  '--check', '--edition', '2021', '--config', 'skip_children=true', ...files,
], { stdio: 'inherit' });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
