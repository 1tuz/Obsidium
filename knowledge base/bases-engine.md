# Движок выборок Bases

## Связанные документы

- [[bases-kanban]] — kanban-представление и запись статуса.
- [[bases-calendar]] — календарное представление.
- [[dataview-queries]] — запросы и поля заметок.
- [[frontmatter-field-index]] — индексируемые поля frontmatter.
- [[notes-gate]] — запись через общий шлюз.

Статус: актуально на 2026-10-25.

## Где считается выборка

Выборка `.base` считается в Rust и приходит в webview готовым результатом:

| Слой | Файл | Роль |
| --- | --- | --- |
| Парсер `.base` | `src/modules/bases/baseFormat.ts` | YAML → `BaseDefinition` (`views`, `filters`, `propertyLabels`, `unsupportedKeys`) |
| Движок | `core/src/search/bases/mod.rs` | фильтры, сортировка, `groupBy`, `limit`, колонки, `unsupported` |
| Сервис | `core/src/search/bases/service.rs` | `SearchService::query_base` — берёт строки из `base_rows` и передаёт их движку |
| IPC | `src-tauri/src/search/commands.rs::query_base` | `query_base(workspacePath, query)` |
| Шлюз | `src/modules/bases/gateway.ts::queryBase` | типизированный вызов из UI |
| UI | `src/components/Bases/BaseView.tsx` | рисует `rows`, `groups`, `columns`, `unsupported` |

Запрос: `BaseQuery { definition, viewIndex, sort }`. Ответ: `BaseEvaluation { rows, groups, columns, unsupported }`.
Парсер `.base` остаётся в TypeScript — движок не разбирает YAML повторно.

## Почему не в webview

`get_base_rows` отдаёт весь vault: на 10 000 заметок это десятки мегабайт JSON и полный проход
фильтрации в JavaScript на каждый перерендер. Теперь через IPC идут только строки результата:
типичная таблица на 50–200 заметок вместо всего vault. `get_base_rows` остался только для
потребителей, которым нужен полный список путей (`src/modules/canvas/recentNotes.ts`).

Сортировка, фильтрация и группировка больше не дублируются: в TypeScript остались только
`parseBase` (разбор файла) и `src/modules/bases/properties.ts::baseProperty` (показ значения в
ячейке). Логику выборки меняем в одном месте — `core/src/search/bases/mod.rs`.

Исключение — раскладка доски: `modules/bases/kanban.ts::buildKanbanColumns` строит колонки из уже
отобранных строк, потому что доске нужны и пустые колонки из `groupOrder`. Это раскладка, а не
отбор: какие строки попали в выборку и в каком они порядке, решает Rust.

## Семантика

- Фильтры: `==`, `!=`, `>`, `>=`, `<`, `<=`, `and` / `or` / `not`, вложенные конструкции.
- Значения: массивы сравниваются по вхождению (`==`) и по «ни одному из» (`!=`), затем склеиваются
  в строку; строки сравниваются без учёта регистра; числовой литерал включает числовое сравнение.
- Вычисляемые свойства: `file.name`, `file.path`, `file.ext`, `file.folder`, `file.hasTag(...)`,
  `file.inFolder(...)`, `property.contains(...)`; префикс `note.` отбрасывается.
- Сортировка: числовые значения сравниваются как числа, остальные — как строки с натуральным
  порядком (`note 2` раньше `note 10`); направление `DESC` разворачивает сравнение, при равенстве
  порядок добивается путём.
- Группы: `groupOrder` задаёт первые группы в указанном порядке, остальные сортируются по метке
  (направление из `groupBy.direction`); `rows` возвращаются уже разложенными по группам, а
  `groups` содержат диапазоны `start`/`end`.
- Колонки: `view.order`, иначе `file.name` плюс первые 7 свойств из первых 50 строк результата.
- `limit` применяется после сортировки.

`unsupported: true` означает, что выборка неполная: встретились формулы (`formula.*`), неизвестный
ключ `.base` или неразобранное выражение фильтра. Строки в этом случае остаются видимыми — как и
раньше, — но UI показывает предупреждение, чтобы неполный результат не выглядел точным.

## Паритет

Кейсы прежнего `src/modules/bases/filter.test.ts` (файл стал `properties.test.ts`) перенесены в
`core/src/search/bases/tests.rs`: рекурсивные фильтры с `file.*`, неизвестные выражения,
числовая сортировка, массивы, `and`/`or`/`not`, группы, колонки, `limit`, вычисляемые свойства.
TS-тесты остались на форматирование и разбор: `properties.test.ts` проверяет `baseProperty`
(подписи `file.*` и префикс `note.`), `baseFormat.test.ts` — `parseBase`/`serializeBase`,
`cardCreation.test.ts` — содержимое создаваемой заметки.

Проверка:

```bash
cd obsidium-app/core && cargo test bases
cd obsidium-app && npx vitest run src/modules/bases
```

Любое изменение семантики делается в Rust-движке и в `tests.rs`; если меняется разбор `.base`,
дополняется `baseFormat.test.ts`.
