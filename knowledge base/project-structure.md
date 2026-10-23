# Структура проекта Obsidium

Статус: актуально на 2026-10-22. Переписан по факту: прежняя версия описывала React, Tiptap и
Windows-пути, которых в коде давно нет.

## Расположение

```text
Obsidium/
├── knowledge base/          ← документация проекта (эта папка)
├── .artifacts/              ← ВСЕ сборки (gitignore); dev ≠ release
│   ├── cargo-dev/           ← только debug (tauri dev / cargo test)
│   ├── cargo-release/       ← только release (npm run release)
│   ├── dist/                ← production-фронт Vite
│   └── releases/            ← setup.exe + latest.json по версиям → GitHub Release
├── .github/workflows/       ← CI, nightly, release, macOS-артефакт, sync upstream
├── scripts/                 ← CI-роутинг, проверки формата, установщики, релиз
└── obsidium-app/
    ├── index.html
    ├── package.json
    ├── core/                ← Rust-ядро (obsidium-core): без UI
    │   ├── Cargo.toml
    │   └── src/{documents,files,history,link_title,mcp,search,settings,ui_state,wikixiv}/
    ├── cli/                 ← headless CLI (obsidium-cli) поверх того же ядра
    ├── src/                 ← Preact + TypeScript, CodeMirror 6
    ├── src-tauri/           ← Tauri-хост (obsidium-app): команды, окно, MCP-мост
    ├── tests/
    └── vendor/foliate-js/   ← submodule, читалка книг
```

Правила изоляции сборок: [[build-artifacts-separation]].
Релиз и автообновление: [[release-and-updates]].
Открытие и сохранение стандартных файлов: [[standard-files]].
Структура внутри `src/`: `components/` — то, что рисует; `modules/` — то, что решает (без JSX);
`styles/` — токены и темы.

## Пространство крейтов

`obsidium-app/src-tauri/Cargo.toml` — корень workspace, участники: `.` (`obsidium-app`), `../core`
(`obsidium-core`), `../cli` (`obsidium-cli`). Ядро не зависит от Tauri, поэтому его тесты идут на
любой платформе без WebView-зависимостей, а CLI переиспользует тот же код, что и приложение
([[headless-cli-and-mcp-transactions]]).

## Установленные зависимости

### Фронтенд (npm, `obsidium-app/package.json`)

| Пакет | Назначение |
|-------|-----------|
| **preact** | UI-фреймворк; в коде импорты идут из `react`, пакет подменяет `@preact/preset-vite` |
| **@codemirror/* (`state`, `view`, `commands`, `language`, `lang-markdown`, `language-data`, `search`, `autocomplete`, `collab`, `merge`)** | Редактор, live preview, поиск по заметке, история версий |
| **@lezer/{common,highlight,markdown}** | Разбор и подсветка Markdown |
| **motion** | Анимации интерфейса |
| **pdfjs-dist** | Просмотр PDF |
| **@tauri-apps/api + plugin-{autostart,dialog,opener}** | Мост к Rust-хосту |
| **@phosphor-icons/core, @tabler/icons, lucide** | Иконки ([[icon-system]]) |

Ни `yjs`, ни `y-indexeddb`, ни `@tiptap/*` во фронтенде нет: CRDT-реплика документа живёт в ядре
(`core/src/documents/replica.rs` на `yrs`), а редактор — CodeMirror 6 поверх текста заметки.

### Бэкенд (`obsidium-app/core/Cargo.toml`)

| Крейт | Назначение |
|-------|-----------|
| **rusqlite** (bundled) | Служебная база: поля frontmatter, задачи, wiki-связи, состояние UI |
| **tantivy** (`mmap`, `lz4-compression`, `stemmer`) | Полнотекстовый индекс |
| **rust-stemmers** | Стемминг RU/EN (Snowball) внутри собственного токенайзера |
| **notify** | Наблюдение за файлами vault |
| **atomic-write-file**, **blake3** | Атомарная запись и хэши для проверки конфликтов |
| **walkdir**, **unicode-normalization**, **pulldown-cmark** | Обход vault, нормализация, разбор Markdown |
| **ureq**, **httparse** | Сетевые запросы только для Викиксива ([[wikixiv]]) |
| **yrs** | Совместимость с Yjs-обновлениями на стороне Rust |

Модели эмбеддингов в зависимостях нет: поиск полностью лексический, см.
[[search-indexing-workspaces-part-2]].

### Хост (`obsidium-app/src-tauri/Cargo.toml`)

`tauri` 2, `tauri-plugin-{opener,dialog,single-instance,updater(optional),autostart}`,
`objc2*` на macOS для темы окна, `webview2-com`/`windows` на Windows.

## Что проверяется в CI, а не локально

Сборки, полный набор тестов и бенчмарки живут в GitHub Actions ([[ci-pipelines]]). Локально
допустимы адресные проверки: `cargo check -p obsidium-core`, `npx tsc --noEmit`, тесты одного
модуля. Полные `cargo test --workspace` и `npm test` — ночной workflow.

## Техдолг

Список известных долгов со статусами — [[tech-debt]]. Туда попадает только то, что подтверждено
чтением кода и сознательно отложено.
