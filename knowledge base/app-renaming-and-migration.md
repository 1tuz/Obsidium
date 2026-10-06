# Переименование приложения в Aquilum и миграция данных

Документ фиксирует переход с названия quantum-app (Quantum) на **Aquilum**: идентификаторы, каталоги
данных и что из старого переносится автоматически.

Исходный текст этого документа пострадал от той же массовой замены `quantum` → `aquilum`, что и код:
«было» и «стало» совпадали, а описанные миграции истории и переменных MCP в коде отсутствовали.
Ниже — состояние, сверенное с кодом 2026-10-06.

## Связанные документы

- [[workspace-switching]] — хранение путей баз знаний и состояния UI в `app_data_dir`.
- [[release-and-updates]] — схема сборки установщика, подписи и автообновлений.
- [[mcp-guest-workspace]] — MCP-сервер и работа с базами знаний через гостевой слот.
- [[note-history]] — версионирование заметок внутри хранилища `.aquilum/history`.

## 1. Идентификаторы и конфигурация сборщика

| Сущность | Было | Стало | Где задаётся |
|---|---|---|---|
| Название приложения (окно, ярлык) | `quantum-app` | `Aquilum` | `tauri.conf.json` (`productName`, `title`) |
| Идентификатор приложения Tauri | `com.dmitriy.quantum-app` | `com.dmitriy.aquilum-app` | `tauri.conf.json` (`identifier`) |
| Имя Rust-пакета и библиотеки | `quantum-app` / `quantum_app_lib` | `aquilum-app` / `aquilum_app_lib` | `Cargo.toml` |
| Имя npm-пакета | `quantum-app` | `aquilum-app` | `package.json` |
| Репозиторий релизов | `Freaction/Quantum-release` | `Freaction/Aquilum` | `tauri.conf.json` (`endpoints`), `build-release.mjs` |
| Каталог истории внутри базы знаний | `.quantum/history` | `.aquilum/history` | `src-tauri/src/history/store.rs` |
| Имя MCP-сервера | `quantum` | `aquilum` | `src-tauri/src/mcp/protocol.rs` |
| Токенизатор поискового индекса | `quantum_text` | `aquilum_text` | `src-tauri/src/search/analyzer/pipeline.rs` |

Установленный quantum-app — отдельная программа (своя запись удаления, свой автозапуск `quantum-app`,
свой адрес обновлений). Aquilum его не обновляет и не удаляет; Aquilum ставится рядом.

### Имя ярлыка на рабочем столе

В Tauri v2 при генерации установщика NSIS (Windows) имя ярлыка на рабочем столе и в меню «Пуск»
определяется `productName` в `tauri.conf.json`. `"productName": "Aquilum"` даёт ярлык `Aquilum`.

## 2. Данные профиля: `migrate_legacy_data`

Смена `identifier` меняет `app_data_dir`: `%APPDATA%\com.dmitriy.quantum-app` →
`%APPDATA%\com.dmitriy.aquilum-app`. `src-tauri/src/migration.rs` при старте, до инициализации
сервисов, копирует содержимое старого каталога в новый (`ui-state.sqlite3*`, `settings.json` и
прочее), если в новом ещё нет `settings.json` и `ui-state.sqlite3`. Поисковый кэш `search-v2/` не
копируется: его индексы всё равно строятся заново (раздел 3), а копирование шло синхронно до показа
окна ([[app-startup]]). Уже существующие данные не
перезаписываются. Каталог WebView (`%LOCALAPPDATA%\…\EBWebView`, IndexedDB-реплики документов) не
переносится: реплики восстанавливаются из `.md` на диске.

## 3. Поисковый индекс: версия анализатора 10

Имя токенизатора записано в схеме индекса Tantivy на диске. При переименовании код стал
регистрировать `aquilum_text`, а `ANALYZER_VERSION` остался 9, поэтому каталог `index-v9`,
построенный ещё quantum-app (или перенесённый `migrate_legacy_data`), открывался, но любая операция
падала: `Schema error: 'Error getting tokenizer for field: path'`. Поиск, ссылки и граф в такой базе
не работали. Починка — `ANALYZER_VERSION = 10`: индекс строится заново в `index-v10`, старый каталог
удаляет `remove_stale_indexes`. Правило: имя токенизатора меняется только вместе с
`ANALYZER_VERSION`.

## 4. История заметок: `.quantum/history` → `.aquilum/history`

История лежит внутри базы знаний. При переименовании путь в коде поменялся, а переноса не было:
версии, сделанные quantum-app, остались в `.quantum/history` (и в корзине — в
`.trash/.quantum/history`) и пропали из вкладки «История». Перенос — `adopt_quantum_history` в
`history/store.rs`, его вызывает `cleanup_history` при каждом открытии базы, для самой базы и для
корзины: файлы версий, которых ещё нет в `.aquilum/history`, переезжают туда `rename`, совпавшие по
имени остаются на месте (имена содержат время и устройство, поэтому совпадение — это та же версия),
пустые папки `.quantum` удаляются. Повторный и параллельный запуск безопасны: перенесённого файла уже
нет в источнике.

## 5. MCP

- stdio-мост (`src-tauri/src/mcp/stdio.rs`) читает `AQUILUM_MCP_PORT` и `AQUILUM_MCP_TOKEN`, иначе
  порт и токен из `settings.json` в `com.dmitriy.aquilum-app`. Старых имён (`QUANTUM_MCP_*`,
  `com.dmitriy.quantum-app`) он не знает: настройки quantum-app переносит `migrate_legacy_data`, а
  конфигурацию агента пользователь обновляет командой из настроек MCP.
- В шаблонах интеграции (`McpSection.tsx`) команды для Claude Code, Codex CLI и Gemini CLI используют
  имя сервера `aquilum`.

## 6. Модульность и размер файлов

Модуль `src-tauri/src/mcp/tools/workspace.rs` (> 320 строк) разделен в соответствии с проектным
правилом < 200 строк на два высококогезионных модуля:
- `workspace_locator.rs` (~150 строк) — резолвинг путей баз знаний, вычисление уникальных суффиксов
  `address`, сопоставление хвостов путей, ожидание индексации гостя и юнит-тесты.
- `workspace.rs` (~120 строк) — схемы MCP-инструментов (`get_workspace`, `list_workspaces`,
  `switch_workspace`, `open_note`) и диспетчеризация вызовов.
