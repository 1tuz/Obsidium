#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/Applications"
removed=false
for APP_PATH in "$APP_DIR/Obsidium.app" "$APP_DIR/Aquilum.app"; do
  if [[ -d "$APP_PATH" ]]; then
    rm -rf "$APP_PATH"
    printf 'Removed %s\n' "$APP_PATH"
    removed=true
  fi
done

if [[ "$removed" == false ]]; then
  printf 'Obsidium is not installed in %s\n' "$APP_DIR"
fi

printf 'Vaults, Markdown files, and application data were left untouched.\n'
