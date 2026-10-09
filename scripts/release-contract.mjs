import { readFileSync, readdirSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export function versionFromTag(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(tag);
  if (!match) throw new Error(`Release tag must use vMAJOR.MINOR.PATCH: ${tag}`);
  return match.slice(1).join('.');
}

export function validateVersions(root, tag) {
  const version = versionFromTag(tag);
  const packageJson = JSON.parse(readFileSync(join(root, 'aquilum-app/package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(join(root, 'aquilum-app/package-lock.json'), 'utf8'));
  const tauri = JSON.parse(readFileSync(join(root, 'aquilum-app/src-tauri/tauri.conf.json'), 'utf8'));
  const cargoLock = readFileSync(join(root, 'aquilum-app/src-tauri/Cargo.lock'), 'utf8');
  const cargoManifest = 'aquilum-app/src-tauri/Cargo.toml';
  const cargoContent = readFileSync(join(root, cargoManifest), 'utf8');
  const cargoVersion = /^version\s*=\s*"([^"]+)"/mu.exec(cargoContent)?.[1];
  const lockVersion = /^name\s*=\s*"aquilum-app"\nversion\s*=\s*"([^"]+)"/mu.exec(cargoLock)?.[1];
  if (!cargoVersion) throw new Error(`${cargoManifest} has no package version`);
  if (!lockVersion) throw new Error('aquilum-app/src-tauri/Cargo.lock has no aquilum-app package');
  const versions = [
    ['aquilum-app/package.json', packageJson.version],
    ['aquilum-app/package-lock.json', packageLock.version],
    ['aquilum-app/package-lock.json packages root', packageLock.packages?.['']?.version],
    ['aquilum-app/src-tauri/tauri.conf.json', tauri.version],
    [cargoManifest, cargoVersion],
    ['aquilum-app/src-tauri/Cargo.lock aquilum-app', lockVersion],
  ];
  for (const [path, found] of versions) {
    if (found !== version) throw new Error(`${path} version ${found} does not match ${tag}`);
  }
  return version;
}

function filesBelow(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function one(files, pattern, label) {
  const matches = files.filter((path) => pattern.test(basename(path)));
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.length}`);
  return matches[0];
}

export function collectPlatformAssets(platform, version, source, destination) {
  const files = filesBelow(source);
  const names = {
    windows: [[new RegExp(`^Obsidium_${version}_x64-setup\\.exe$`, 'u'), 'Windows installer'], [new RegExp(`^Obsidium_${version}_x64-setup\\.exe\\.sig$`, 'u'), 'Windows signature']],
    macos: [[new RegExp(`^Obsidium_${version}_aarch64\\.dmg$`, 'u'), 'macOS DMG'], [new RegExp(`^Obsidium_${version}_aarch64\\.app\\.tar\\.gz$`, 'u'), 'macOS updater archive'], [new RegExp(`^Obsidium_${version}_aarch64\\.app\\.tar\\.gz\\.sig$`, 'u'), 'macOS updater signature']],
    linux: [[new RegExp(`^Obsidium_${version}_amd64\\.deb$`, 'u'), 'Linux installer'], [new RegExp(`^Obsidium_${version}_amd64\\.deb\\.sig$`, 'u'), 'Linux signature']],
  }[platform];
  if (!names) throw new Error(`Unsupported release platform: ${platform}`);
  const selected = names.map(([pattern, label]) => one(files, pattern, label));
  const signatures = selected.filter((path) => path.endsWith('.sig'));
  for (const signature of signatures) {
    if (readFileSync(signature, 'utf8').trim().length === 0) throw new Error(`Empty signature: ${signature}`);
  }
  mkdirSync(destination, { recursive: true });
  for (const path of selected) copyFileSync(path, join(destination, basename(path)));
  return selected.map((path) => basename(path));
}

export function createUpdaterManifest(tag, repository, assets, publishedAt = new Date().toISOString()) {
  const version = versionFromTag(tag);
  const platformAssets = {
    'linux-x86_64': [`Obsidium_${version}_amd64.deb`, `Obsidium_${version}_amd64.deb.sig`],
    'darwin-aarch64': [`Obsidium_${version}_aarch64.app.tar.gz`, `Obsidium_${version}_aarch64.app.tar.gz.sig`],
    'windows-x86_64': [`Obsidium_${version}_x64-setup.exe`, `Obsidium_${version}_x64-setup.exe.sig`],
  };
  const platforms = {};
  for (const [key, [asset, signature]] of Object.entries(platformAssets)) {
    const signatureText = readFileSync(join(assets, signature), 'utf8').trim();
    if (!signatureText) throw new Error(`Empty signature: ${signature}`);
    const url = `https://github.com/${repository}/releases/download/${tag}/${asset}`;
    const update = { signature: signatureText, url };
    platforms[key] = update;
    if (key === 'linux-x86_64') platforms['linux-x86_64-deb'] = update;
    if (key === 'darwin-aarch64') platforms['darwin-aarch64-app'] = update;
    if (key === 'windows-x86_64') platforms['windows-x86_64-nsis'] = update;
  }
  return { version, notes: 'See the release notes below.', pub_date: publishedAt, platforms };
}

export function writeUpdaterManifest(tag, repository, assets) {
  const manifest = createUpdaterManifest(tag, repository, assets);
  writeFileSync(join(assets, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
