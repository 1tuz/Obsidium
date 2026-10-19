# Синхронизация с upstream Aquilum

Upstream — [Freaction/Aquilum](https://github.com/Freaction/Aquilum). Форк Obsidium
([1tuz/Obsidium](https://github.com/1tuz/Obsidium)) держит собственное приложение на Tauri, а upstream
с версии 0.3.0 отдаёт нативный интерфейс без WebView. Поэтому буквальный merge ветвей невозможен:
у проектов разные каталоги приложения (`obsidium-app` против `aquilum-app`), разный UI и разные
зависимости.

## Связанные документы

- [[release-and-updates]] — релизы, теги и автообновление.
- [[cross-platform-build]] — сборки и workflow.
- [[canvas-json-format]] — единственная крупная возможность, которой у upstream нет.

## Что синхронизируется

Только общее ядро: `aquilum-app/core` → `obsidium-app/core`. Ядро — это документы, файлы, поиск,
история, настройки и MCP без UI, поэтому его изменения переносимы, а изменения `aquilum-app/native`
и `aquilum-app/tauri-version` — нет.

Workflow `.github/workflows/sync-upstream.yml`:

1. Берёт точку отсчёта из `.github/upstream-sync.json` (поле `upstream`). Раньше она искалась в
   сообщении последнего коммита по `Upstream-Sync:`; файл надёжнее, потому что не зависит от текста
   коммита и переживает squash.
2. Строит `git diff --binary <checkpoint> <upstream/main> -- aquilum-app/core`, исключая
   `Cargo.toml`: у форка своя версия, имя пакета и `fastembed`.
3. Применяет патч через `git apply -p2 --directory=obsidium-app --3way`. `-p2` срезает
   `aquilum-app/`, `--directory` добавляет `obsidium-app/`, поэтому пути попадают в ядро форка.
4. Если патч не применился, workflow **не падает**: он собирает список конфликтующих файлов, пишет
   или дополняет задачу «Upstream core sync needs a manual port» и завершается успешно. Красная
   сборка на каждом запуске не помогала: конфликт требует решения человека, а не повторного прогона.
5. При успехе обновляет `.github/upstream-sync.json`, коммитит, открывает PR и через
   `workflow_dispatch` запускает полную проверку CI.

Почему не merge: истории форка и upstream расходятся после `112afcd` (исходники 0.2.5). Merge втянул
бы в форк удаление Tauri-приложения — 1965 файлов удалений и потерю всего UI Obsidium.

## Что уже известно про разрыв 0.2.6 → 0.3.12

Ядро форка — снимок upstream 0.2.6. За 63 коммита upstream переписал его крупными блоками:

| Область | Что появилось | Переносимость |
|---|---|---|
| `core/src/text/*`, `recent.rs` | `Content`/`Pieces`, UTF-16 смещения, отмена, matcher с той же свёрткой регистра, что у индекса | автономно, новых зависимостей две: `memchr`, `simdutf8` |
| `core/src/markdown/*` | грамматика редактирования: заборы кода, списки, цитаты, выноски, экранирование | автономно, без зависимостей |
| `search/pages`, `search/headings`, `search/hits` | постраничное чтение заметок любого размера, оглавление, выдача | требует миграции `note_pages` |
| `search/wiki/*` | якоря `#H` и `^id`, вложения, самоссылки, CRLF-безопасное переименование | частично: таблица ссылок привязана к `note_pages` |
| `history/delta`, `rebuild`, `revert`, `changes` | версии как региональные дельты, откат одной версии без потери поздних правок | требует `Content`/`Pieces` |
| `files/gate/*`, `files/entries`, `files/content` | запись с хэшированием на лету, spliced-запись, поиск свободного имени | самый инвазивный слой |
| `settings`, `ui_state/identity` | интервал автосохранения, дедупликация баз по NFC | почти автономно |
| `mcp/tools/*` | `read_note`, `create_note`, `update_note` по секциям, `rename_note`, `move_note`, `find_notes` | требует новых API ядра |

Порядок переноса, если браться: сначала `text` и `markdown` (листовые модули, ничего не ломают),
затем `history/delta` + `revert` (закрывает пункты 1–4 в [[Что осталось сделать]]), затем
`search/pages` и wiki-якоря, и только в конце `files`/`Content`, потому что он тянет за собой
`src-tauri` команды и MCP.

## Ограничения

- Конфликт в `files/gate.rs` ожидаем: форк добавил туда `canvas_refs`, upstream разбил файл на
  каталог `gate/`. Такой конфликт решается вручную, автоматика его только обнаруживает.
- `fastembed` (семантический поиск) есть только у форка; при переносе `search` его нельзя терять.
- Версия ядра в `Cargo.toml` форка меняется вместе с релизом приложения и не берётся из upstream.
