import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = JSON.parse(process.env.CHANGED_FILES ?? '[]')
  .filter((path) => path.startsWith('obsidium-app/'))
  .map((path) => path.slice('obsidium-app/'.length))
  .filter((path) => existsSync(path));

if (files.length === 0) process.exit(0);

const result = spawnSync('npx', ['vitest', 'related', '--run', '--passWithNoTests', ...files], {
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
