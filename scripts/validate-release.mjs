import { spawnSync } from 'node:child_process';
import { validateVersions } from './release-contract.mjs';

const [, , tag, latestTag] = process.argv;
const version = validateVersions(process.cwd(), tag);
if (process.env.RELEASE_VERSION && process.env.RELEASE_VERSION !== version) {
  throw new Error(`Release version ${version} does not match tag ${tag}`);
}
if (!latestTag || latestTag === tag) throw new Error(`Refusing to rebuild an existing published release: ${tag}`);
const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', latestTag, 'HEAD'], { stdio: 'inherit' });
if (ancestry.error) throw ancestry.error;
if (ancestry.status !== 0) throw new Error(`${tag} is not based on the latest published release ${latestTag}`);
process.stdout.write(`Release preflight passed: ${tag} follows ${latestTag}\n`);
