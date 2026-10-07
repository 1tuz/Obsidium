# Cross-platform builds

## GitHub Actions

All CI checks and release packaging run on GitHub-hosted runners. Do not use the local Windows-only
release script from an Actions job.

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, manual dispatch, and as a
reusable workflow. The Ubuntu job checks the frontend build and unit tests. A Windows job checks
the Rust entrypoint formatting, `cargo check`, and `cargo test`. The repository-wide
`cargo fmt --check` currently reports formatting differences in untouched files, so the CI formatting
gate is limited to the changed entrypoint. It does not package installers.

`.github/workflows/release.yml` runs for `v*.*.*` tags. It waits for CI, then builds the Windows x64
NSIS installer and separate Apple Silicon and Intel macOS DMGs. The Tauri updater private key and
password are optional GitHub Actions secrets; without them, the build disables updater artifact
generation while still producing installers. Apple Developer signing and notarization are separate
from Tauri updater signing.

For signed and notarized macOS releases, configure all of `APPLE_CERTIFICATE` (base64 `.p12`),
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and
`APPLE_TEAM_ID`. Leave all six unset for an ad-hoc signed, unnotarized DMG. A partial set fails the
release job before packaging.

The workflow creates a draft GitHub Release. Review the generated assets and publish the draft after
checking the release contents. The first run must confirm runner/toolchain compatibility before the
platforms can be described as verified.

## Local development

From `aquilum-app/`:

```bash
npm ci
npm run tauri dev
```

Local packaging is not the release path. `scripts/build-release.mjs` remains Windows-specific until
cross-platform packaging and updater manifest generation are moved fully into the hosted workflow.

## macOS architecture

The release matrix uses native GitHub runners: `macos-15` for `aarch64-apple-darwin` and
`macos-15-intel` for `x86_64-apple-darwin`. Separate builds avoid cross-compiling native
dependencies. Universal builds are deferred until both native artifacts pass release validation.
