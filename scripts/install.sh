#!/usr/bin/env bash
set -euo pipefail

REPO="1tuz/Obsidium"
APP_DIR="$HOME/Applications"
APP_PATH="$APP_DIR/Obsidium.app"

print_banner() {
  cat >&2 <<'EOF'

        /\
       /  \
      / /\ \
     /_/  \_\
     \ \  / /
      \ \/ /
       \  /
        \/
     OBSIDIUM
  local-first Markdown vault

EOF
}

print_banner

system="$(uname -s)"
architecture="$(uname -m)"
case "$system:$architecture" in
  Darwin:arm64) platform="macos"; target="aarch64" ;;
  Linux:x86_64)
    os_release="${OS_RELEASE_FILE:-/etc/os-release}"
    if [[ ! -r "$os_release" ]]; then
      printf 'Obsidium Linux installer requires Ubuntu 24.04.\n' >&2
      exit 1
    fi
    . "$os_release"
    if [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != 24.04 ]]; then
      printf 'Obsidium Linux installer supports Ubuntu 24.04 x64 only.\n' >&2
      exit 1
    fi
    platform="linux" ;;
  *) printf 'Obsidium installer supports Apple Silicon macOS and Ubuntu 24.04 x64 only.\n' >&2; exit 1 ;;
esac

work_dir="$(mktemp -d)"
mount_dir="$work_dir/mount"
mkdir "$mount_dir"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_dir" -quiet || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" -o "$work_dir/release.json"
if [[ "$platform" == macos ]]; then
  asset_pattern="_${target}\.dmg$"
else
  asset_pattern="_amd64\.deb$"
fi
download_url="$(sed -n 's/^[[:space:]]*"browser_download_url":[[:space:]]*"\(.*\)",\{0,1\}$/\1/p' "$work_dir/release.json" | grep "$asset_pattern" | head -n 1 || true)"
if [[ -z "$download_url" ]]; then
  printf 'Latest GitHub release has no installer for %s.\n' "$platform" >&2
  exit 1
fi

if [[ "$platform" == linux ]]; then
  curl -fL --proto '=https' --tlsv1.2 --progress-bar --show-error "$download_url" -o "$work_dir/Obsidium.deb"
  sudo dpkg -i "$work_dir/Obsidium.deb"
  printf 'Installed Obsidium for all users. Vaults, Markdown files, and application data were left untouched.\n'
  exit 0
fi

curl -fL --proto '=https' --tlsv1.2 --progress-bar --show-error "$download_url" -o "$work_dir/Obsidium.dmg"
hdiutil attach -nobrowse -readonly -mountpoint "$mount_dir" "$work_dir/Obsidium.dmg" >/dev/null
mounted=true
source_app="$(find "$mount_dir" -maxdepth 3 -type d -name 'Obsidium.app' -print -quit)"
if [[ -z "$source_app" ]]; then
  source_app="$(find "$mount_dir" -maxdepth 3 -type d -name 'Aquilum.app' -print -quit)"
fi
if [[ -z "$source_app" ]]; then
  printf 'No Obsidium app bundle was found in the downloaded DMG.\n' >&2
  exit 1
fi

mkdir -p "$APP_DIR"
rm -rf "$APP_PATH" "$APP_DIR/Aquilum.app"
ditto "$source_app" "$APP_PATH"
printf 'Installed Obsidium to %s\n' "$APP_PATH"
