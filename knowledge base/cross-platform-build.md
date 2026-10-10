# Cross-platform builds

## GitHub Actions

All CI checks and release packaging run on GitHub-hosted runners. Do not use the local Windows-only
release script from an Actions job.

`.github/workflows/ci.yml` routes focused frontend and Rust checks from the full change set and checks
workflow/release contracts when their files change. Documentation-only changes receive a whitespace
check. Mocked installer-script checks are lightweight source checks; actual package installation is
not run in CI. Tagged releases use `release.yml` to build all three platform packages.

`.github/workflows/docs.yml` runs only when Markdown, screenshots, or README assets change on a branch
or pull request. It checks patch whitespace with `git diff --check`; it does not lint or validate
documentation content. Branch filters exclude tag pushes.

The macOS bundle is ad-hoc signed with identity `-`. This produces a code signature but does not make
downloads trusted by Gatekeeper or eligible for notarization. Normal first-launch approval for
quarantined downloads requires an Apple Developer ID certificate and Apple notarization; those
credentials are not configured in this repository's GitHub Actions secrets.

`.github/workflows/release.yml` builds the three targets on `v*` tags and publishes a GitHub Release
only after all platform packages, signatures, and `latest.json` pass validation. The scheduled
`Sync upstream fork` workflow syncs `main` from `Freaction/Aquilum` and dispatches CI when upstream
changes arrive.

## Local development

From `obsidium-app/`:

```bash
npm ci
npm run tauri dev
```

Local packaging is not the release path. `scripts/build-release.mjs` remains Windows-specific until
cross-platform packaging and updater manifest generation are moved fully into the hosted workflow.

## macOS architecture

The macOS package targets `aarch64-apple-darwin` on `macos-15` for Apple Silicon (M-series). Linux
packages target `x86_64-unknown-linux-gnu` on `ubuntu-24.04` and produce `.deb` installers.
