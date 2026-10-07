# Cross-platform builds

## GitHub Actions

All CI checks and release packaging run on GitHub-hosted runners. Do not use the local Windows-only
release script from an Actions job.

`.github/workflows/ci.yml` runs on every branch push, pull request, manual dispatch, and reusable
workflow call. It checks the frontend build and tests, installer-script safety, and Rust formatting,
then packages Windows x64 NSIS, an Apple Silicon macOS DMG, and an Ubuntu 24 x64 `.deb`. npm and Cargo
dependencies are cached; package artifacts remain available for seven days.

The macOS bundle is ad-hoc signed with identity `-`. This produces a code signature but does not make
downloads trusted by Gatekeeper or eligible for notarization. Normal first-launch approval for
quarantined downloads requires an Apple Developer ID certificate and Apple notarization; those
credentials are not configured in this repository's GitHub Actions secrets.

`.github/workflows/release.yml` builds the same three targets into a draft GitHub Release on `v*`
tags. `release-macos.yml`, `release-linux.yml`, and
`release-windows.yml` publish one selected platform without waiting for the other package jobs.
Each single-platform workflow uses `.github/workflows/release-platform.yml`; the package is published
to `v<version>` from `aquilum-app/package.json` and its updater entry is merged with existing
platform entries. Increase the application version before dispatching a new updater release. The scheduled
`Sync upstream fork` workflow syncs `main` from `Freaction/Aquilum` and dispatches CI when upstream
changes arrive.

## Local development

From `aquilum-app/`:

```bash
npm ci
npm run tauri dev
```

Local packaging is not the release path. `scripts/build-release.mjs` remains Windows-specific until
cross-platform packaging and updater manifest generation are moved fully into the hosted workflow.

## macOS architecture

The macOS package targets `aarch64-apple-darwin` on `macos-15` for Apple Silicon (M-series). Linux
packages target `x86_64-unknown-linux-gnu` on `ubuntu-24.04` and produce `.deb` installers.
