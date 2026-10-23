#!/bin/sh
set -eu

default_prefix="$HOME/.local/bin"
app_path=""
app_given=false
prefix="$default_prefix"
uninstall=false

usage() {
  cat >&2 <<'EOF'
usage: install-cli.sh [--app PATH] [--prefix DIR] [--uninstall]

Symlinks the Obsidium CLI from the macOS app bundle into DIR
(default: ~/.local/bin). PATH is never modified by this script.

  --app PATH     app bundle to link from (default: /Applications/Obsidium.app,
                 then ~/Applications/Obsidium.app)
  --prefix DIR   directory that receives the obsidium symlink
  --uninstall    remove the symlink if it points into an Obsidium.app
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      app_path="$2"
      app_given=true
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      prefix="$2"
      shift 2
      ;;
    --uninstall)
      uninstall=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'install-cli.sh: unknown argument: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
done

[ -n "$prefix" ] || { printf 'install-cli.sh: --prefix must not be empty\n' >&2; exit 2; }
while [ "$prefix" != "/" ] && [ "${prefix%/}" != "$prefix" ]; do
  prefix=${prefix%/}
done
link="$prefix/obsidium"

if [ "$uninstall" = true ]; then
  if [ ! -e "$link" ] && [ ! -L "$link" ]; then
    printf 'No Obsidium CLI link at %s; nothing to remove.\n' "$link"
    exit 0
  fi
  if [ ! -L "$link" ]; then
    printf 'Leaving %s alone: it is not a symlink.\n' "$link" >&2
    exit 0
  fi
  link_target="$(readlink "$link")"
  case "$link_target" in
    */Obsidium.app/*) rm -f "$link"; printf 'Removed %s\n' "$link" ;;
    *) printf 'Refusing to remove %s: it points to %s\n' "$link" "$link_target" >&2; exit 1 ;;
  esac
  exit 0
fi

if [ "$app_given" = false ]; then
  if [ -f "/Applications/Obsidium.app/Contents/MacOS/obsidium" ]; then
    app_path="/Applications/Obsidium.app"
  elif [ -f "$HOME/Applications/Obsidium.app/Contents/MacOS/obsidium" ]; then
    app_path="$HOME/Applications/Obsidium.app"
  else
    app_path="/Applications/Obsidium.app"
  fi
fi

resolved_app="$(CDPATH= cd "$app_path" 2>/dev/null && pwd)" || {
  printf 'install-cli.sh: app bundle not found: %s\n' "$app_path" >&2
  exit 1
}
binary="$resolved_app/Contents/MacOS/obsidium"
if [ ! -f "$binary" ]; then
  printf 'install-cli.sh: no CLI at %s\n' "$binary" >&2
  printf 'Reinstall Obsidium or pass --app with the bundle location.\n' >&2
  exit 1
fi

if [ -e "$link" ] && [ ! -L "$link" ]; then
  printf 'install-cli.sh: %s exists and is not a symlink; remove it first\n' "$link" >&2
  exit 1
fi

mkdir -p "$prefix"
rm -f "$link"
ln -s "$binary" "$link"
printf 'Linked %s -> %s\n' "$link" "$binary"

case ":${PATH:-}:" in
  *":$prefix:"*) ;;
  *) printf 'Add %s to PATH with:\n  export PATH="%s:$PATH"\n' "$prefix" "$prefix" ;;
esac
