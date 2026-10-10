import { mkdirSync } from 'node:fs';
import { collectPlatformAssets, writeUpdaterManifest } from './release-contract.mjs';

const [, , mode, platformOrTag, versionOrRepository, sourceOrAssets, destination] = process.argv;

if (mode === 'collect') {
  const names = collectPlatformAssets(platformOrTag, versionOrRepository, sourceOrAssets, destination);
  process.stdout.write(`${names.join('\n')}\n`);
} else if (mode === 'manifest') {
  mkdirSync(sourceOrAssets, { recursive: true });
  const manifest = writeUpdaterManifest(platformOrTag, versionOrRepository, sourceOrAssets);
  process.stdout.write(`latest.json version ${manifest.version}; ${Object.keys(manifest.platforms).length} platform entries\n`);
} else {
  throw new Error('Usage: prepare-release-assets.mjs collect <platform> <version> <bundle-dir> <output-dir> | manifest <tag> <repository> <assets-dir>');
}
