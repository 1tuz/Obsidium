#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/Applications"
removed=false
system="$(uname -s)"
architecture="$(uname -m)"
case "$system:$architecture" in
  Darwin:arm64)
    for APP_PATH in "$APP_DIR/Obsidium.app" "$APP_DIR/Aquilum.app"; do
      if [[ -d "$APP_PATH" ]]; then
        rm -rf "$APP_PATH"
        printf 'Removed %s\n' "$APP_PATH"
        removed=true
      fi
    done ;;
  Linux:x86_64)
    os_release="${OS_RELEASE_FILE:-/etc/os-release}"
    if [[ ! -r "$os_release" ]]; then
      printf 'Obsidium Linux uninstaller requires Ubuntu 24.04.\n' >&2
      exit 1
    fi
    . "$os_release"
    if [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != 24.04 ]]; then
      printf 'Obsidium Linux uninstaller supports Ubuntu 24.04 x64 only.\n' >&2
      exit 1
    fi
    if dpkg-query -W -f='${Status}' com.dmitriy.aquilum-app 2>/dev/null | grep -q 'install ok installed'; then
      sudo dpkg --remove com.dmitriy.aquilum-app
      removed=true
    fi ;;
  *) printf 'Obsidium uninstaller supports Apple Silicon macOS and Ubuntu 24.04 x64 only.\n' >&2; exit 1 ;;
esac

if [[ "$removed" == false ]]; then
  printf 'Obsidium is not installed in %s\n' "$APP_DIR"
fi

printf 'Vaults, Markdown files, and application data were left untouched.\n'
