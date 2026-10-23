#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT
mock_bin="$temporary_root/bin"
mkdir -p "$mock_bin"
printf 'ID=ubuntu\nVERSION_ID="24.04"\n' > "$temporary_root/ubuntu-release"

cat > "$mock_bin/uname" <<'EOF'
#!/usr/bin/env bash
case "${1:-s}" in
  -s) printf '%s\n' "$MOCK_OS" ;;
  -m) printf '%s\n' "$MOCK_ARCH" ;;
esac
EOF
cat > "$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"releases/latest"* ]]; then
  printf '{\n  "browser_download_url": "https://example.invalid/Obsidium_1.2.3_amd64.deb"\n}\n' > "${@: -1}"
else
  printf 'mock package' > "${@: -1}"
fi
printf 'curl %s\n' "$*" >> "$MOCK_LOG"
EOF
cat > "$mock_bin/sudo" <<'EOF'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >> "$MOCK_LOG"
"$@"
EOF
cat > "$mock_bin/dpkg" <<'EOF'
#!/usr/bin/env bash
printf 'dpkg %s\n' "$*" >> "$MOCK_LOG"
EOF
cat > "$mock_bin/dpkg-query" <<'EOF'
#!/usr/bin/env bash
printf 'install ok installed'
EOF
chmod +x "$mock_bin"/*

run_with_mocks() {
  local os="$1" arch="$2" log="$3" home="$4"
  shift 4
  PATH="$mock_bin:$PATH" HOME="$home" MOCK_OS="$os" MOCK_ARCH="$arch" MOCK_LOG="$log" OS_RELEASE_FILE="$temporary_root/ubuntu-release" "$@"
}

mkdir -p "$temporary_root/home/Applications/Obsidium.app" "$temporary_root/home/Documents"
printf 'settings stay\n' > "$temporary_root/home/Documents/notes.md"
: > "$temporary_root/install.log"
run_with_mocks Linux x86_64 "$temporary_root/install.log" "$temporary_root/home" bash "$script_dir/install.sh"
[[ "$(cat "$temporary_root/install.log")" == *"dpkg -i "* ]]
[[ "$(cat "$temporary_root/home/Documents/notes.md")" == 'settings stay' ]]

: > "$temporary_root/uninstall.log"
run_with_mocks Linux x86_64 "$temporary_root/uninstall.log" "$temporary_root/home" bash "$script_dir/uninstall.sh"
[[ "$(cat "$temporary_root/uninstall.log")" == *"dpkg --remove com.obsidium.app"* ]]
[[ "$(cat "$temporary_root/home/Documents/notes.md")" == 'settings stay' ]]

for unsupported in 'Linux aarch64' 'Darwin x86_64' 'FreeBSD x86_64'; do
  read -r os arch <<< "$unsupported"
  : > "$temporary_root/unsupported.log"
  if run_with_mocks "$os" "$arch" "$temporary_root/unsupported.log" "$temporary_root/home" bash "$script_dir/install.sh" >/dev/null 2>&1; then
    exit 1
  fi
  [[ ! -s "$temporary_root/unsupported.log" ]]
done

printf 'ID=debian\nVERSION_ID="12"\n' > "$temporary_root/ubuntu-release"
: > "$temporary_root/unsupported.log"
if run_with_mocks Linux x86_64 "$temporary_root/unsupported.log" "$temporary_root/home" bash "$script_dir/install.sh" >/dev/null 2>&1; then
  exit 1
fi
[[ ! -s "$temporary_root/unsupported.log" ]]
printf 'ID=ubuntu\nVERSION_ID="24.04"\n' > "$temporary_root/ubuntu-release"

mkdir -p "$temporary_root/home/Applications/Aquilum.app" "$temporary_root/home/Applications/Obsidium.app"
: > "$temporary_root/mac-uninstall.log"
run_with_mocks Darwin arm64 "$temporary_root/mac-uninstall.log" "$temporary_root/home" bash "$script_dir/uninstall.sh" >/dev/null
[[ ! -e "$temporary_root/home/Applications/Aquilum.app" ]]
[[ ! -e "$temporary_root/home/Applications/Obsidium.app" ]]
[[ "$(cat "$temporary_root/home/Documents/notes.md")" == 'settings stay' ]]

cli_root="$temporary_root/cli"
cli_home="$cli_root/home"
cli_app="$cli_root/app/Obsidium.app"
cli_binary="$cli_app/Contents/MacOS/obsidium"
cli_prefix="$cli_home/.local/bin"
cli_link="$cli_prefix/obsidium"
cli_path="/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$cli_home" "$cli_app/Contents/MacOS"
printf '#!/bin/sh\nprintf obsidium-cli\n' > "$cli_binary"
chmod +x "$cli_binary"
printf 'plist stays\n' > "$cli_app/Contents/Info.plist"

run_cli() {
  PATH="$cli_path" HOME="$cli_home" /bin/sh "$@"
}

output="$(run_cli "$script_dir/install-cli.sh" --app "$cli_app")"
[[ -L "$cli_link" ]]
[[ "$(readlink "$cli_link")" == "$cli_binary" ]]
[[ "$output" == *"export PATH=\"$cli_prefix:\$PATH\""* ]]
[[ "$(cat "$cli_app/Contents/Info.plist")" == 'plist stays' ]]
[[ "$("$cli_link")" == 'obsidium-cli' ]]

run_cli "$script_dir/install-cli.sh" --app "$cli_app" >/dev/null
[[ -L "$cli_link" ]]
[[ "$(readlink "$cli_link")" == "$cli_binary" ]]

rm -f "$cli_link"
printf 'user file\n' > "$cli_link"
if run_cli "$script_dir/install-cli.sh" --app "$cli_app" >/dev/null 2>&1; then
  exit 1
fi
[[ ! -L "$cli_link" ]]
[[ "$(cat "$cli_link")" == 'user file' ]]

run_cli "$script_dir/uninstall-cli.sh" >/dev/null
[[ -f "$cli_link" ]]
[[ "$(cat "$cli_link")" == 'user file' ]]
rm -f "$cli_link"

run_cli "$script_dir/install-cli.sh" --app "$cli_app" >/dev/null
run_cli "$script_dir/uninstall-cli.sh" >/dev/null
[[ ! -e "$cli_link" ]]
[[ ! -L "$cli_link" ]]

ln -s /usr/bin/true "$cli_link"
if run_cli "$script_dir/uninstall-cli.sh" >/dev/null 2>&1; then
  exit 1
fi
[[ -L "$cli_link" ]]
rm -f "$cli_link"

custom_prefix="$cli_root/custom/bin"
run_cli "$script_dir/install-cli.sh" --app "$cli_app" --prefix "$custom_prefix" >/dev/null
[[ -L "$custom_prefix/obsidium" ]]
[[ ! -e "$cli_link" ]]

mkdir -p "$cli_root/broken/Obsidium.app/Contents/MacOS"
if run_cli "$script_dir/install-cli.sh" --app "$cli_root/broken/Obsidium.app" >/dev/null 2>&1; then
  exit 1
fi
[[ ! -e "$cli_link" ]]

output="$(PATH="$cli_prefix:/usr/bin:/bin" HOME="$cli_home" /bin/sh "$script_dir/install-cli.sh" --app "$cli_app")"
[[ "$output" != *"export PATH="* ]]
[[ -L "$cli_link" ]]
