# Obsidium

Настройка с нуля и все требования — в разделе «Быстрый старт» файла [`../DEVELOPMENT.md`](../DEVELOPMENT.md).
Здесь только то, что относится к каталогу приложения.

## Разработка

```bash
npm ci
npm run tauri dev
```

`npm run tauri dev` идёт через `scripts/tauri.mjs`: он ставит Cargo-каталог `.artifacts/cargo-dev` и
синхронизирует иконки. Отдельный `CARGO_TARGET_DIR` не задавайте — Tauri ACL ломается.

## Проверки

```bash
npx tsc --noEmit
npm test
cargo test --manifest-path src-tauri/Cargo.toml -p obsidium-core
```

Полные наборы (`npm test` целиком, `cargo test --workspace`, тесты установщиков) гоняет ночной
workflow; локально достаточно целевых проверок затронутого модуля. Что включает каждый флаг
роутинга CI — в [`../knowledge base/ci-pipelines.md`](../knowledge%20base/ci-pipelines.md).

## Релиз

Релиз собирают GitHub Actions по тегу `v*`; `npm run release` — только локальная Windows-сборка.
Подробности: [`../knowledge base/release-and-updates.md`](../knowledge%20base/release-and-updates.md).

Кэши разделены:
- `../.artifacts/cargo-dev/` — `npm run tauri dev`
- `../.artifacts/cargo-release/` — `npm run tauri build` (не для ручного запуска)
- `../.artifacts/dist/` — production-фронт внутри сборки

Подробности: [`../knowledge base/build-artifacts-separation.md`](../knowledge%20base/build-artifacts-separation.md).
