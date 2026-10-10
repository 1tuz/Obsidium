# Cross-platform one-command installers

## Goal

Let users install or remove the latest Obsidium release with one command on the three platforms already packaged by the release workflow: Apple Silicon macOS, Ubuntu 24 x64, and Windows x64. Keep vaults and application data when removing the application, and document the commands in English and Russian.

## Design

Extend `scripts/install.sh` and `scripts/uninstall.sh` to dispatch by operating system and architecture. Keep the current macOS DMG flow. On Ubuntu 24 x64, select exactly one `Obsidium_<version>_amd64.deb` asset from the public latest-release API, download it over HTTPS, and install it with `sudo apt install ./<package>`; the package name is `obsidium`. Removal uses `sudo apt remove obsidium`, never `purge`, which leaves the user's data in place. Reject unsupported operating systems, distributions, versions, and architectures before downloading or changing the machine. Fail if an expected asset is missing or ambiguous.

Add `scripts/install.ps1` and `scripts/uninstall.ps1` for Windows x64. The installer selects exactly one `Obsidium_<version>_x64-setup.exe` asset and runs it for the current user, matching `tauri.conf.json`'s `installMode: currentUser`. The uninstaller searches only `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall` for an entry whose `DisplayName` exactly matches `Obsidium`, then invokes that entry's uninstall command. It must not select machine-wide or legacy-product entries. Both scripts remove or replace application files only; neither purges application data or vault files. Reject unsupported Windows architectures and fail if an expected asset or uninstall entry is missing or ambiguous. Publish one-line PowerShell commands that fetch these scripts from `1tuz/Obsidium`'s `main` branch.

Document platform requirements, install and uninstall commands, unsupported targets, and Windows SmartScreen behavior in `README.md`, `README.ru.md`, `knowledge base/release-and-updates.md`, and `knowledge base/cross-platform-build.md`. Correct stale claims that releases contain only macOS assets or that quick CI runs installer-script checks. Keep the upstream repository and release build matrix unchanged.

## Error handling and data safety

- Fail with a clear message if the latest release has no matching platform asset, a download fails, or a required package manager is unavailable.
- Require installer download URLs to use HTTPS and the `github.com` release asset host; reject zero or multiple exact asset matches before execution.
- Check platform, distribution/version, and architecture before downloading or installing.
- Never run package purge commands or delete vaults, Markdown files, attachments, settings, or application data as part of uninstall.
- Linux package installation may request `sudo`; Windows installation stays scoped to the current user and does not request elevation.
- Keep the existing legacy macOS app cleanup behavior needed to replace an older app bundle.

## Verification

Extend `scripts/test-install-scripts.sh` with isolated checks for Bash platform dispatch and uninstall data preservation; tests must not contact GitHub or modify the host. Validate both PowerShell files parse on Windows and cover asset selection and uninstall safety with focused checks. Run Bash syntax and installer checks, PowerShell checks, documentation diff checks, and only the repository's relevant fast CI gates. A release workflow run remains the proof that the already-supported platform packages build and publish together; do not add new package formats or alter release versioning as part of the installer change.

## Scope exclusions

No RPM, AppImage, or other Linux package formats; no upstream changes; no migration or deletion of user data; no dependency additions; no changes to the release package matrix or updater protocol.
