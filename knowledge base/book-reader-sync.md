# Синхронизация прогресса чтения

Как прогресс доходит от читалки до frontmatter страницы книги, виджетов `[!book]`
и открытой вкладки. Общий обзор читалки: [[book-reader]].
Виджет callout: [[editor-book-callout]].

## Два контура (не смешивать)

```text
BookReader.onRelocate
        │
        ├─► [A] Runtime bus (sync, без I/O)
        │       publishBookPageProgress → bookPageRuntime
        │       → subscribeBookPageRuntime → patchBookCalloutDom
        │
        └─► [B] Persist (async, coalesced)
                persistBookReaderMeta → pages + reader_position + read_percent
                → patch Y.Doc или writeFileAtomic
```

| Контур | API | Latency | Источник истины для UI |
|---|---|---|---|
| A — bus | `publishBookPageProgress` | sync | in-memory до следующего hydrate |
| B — persist | `persistBookReaderMeta` | async | FM на `.md` страницы книги |

**Правило:** UI (виджет, прогресс в ридере) обновляется контуром A на каждое
перелистывание. Контур B догоняет диск; при быстром листании пишется **только
последнее** значение, не каждый промежуточный кадр.

Отдельно: CFI в `readerState.ts` → SQLite (`save_ui_reader_state`), debounce
400 ms. Это **не** markdown и **не** bus; используется только для reopen. Неудачная запись не
теряется: книга остаётся в `dirty`, ошибка пишется в журнал, и запись повторяется через 5 с.
Идентификатор базы (`resolve_ui_workspace`) запоминается на путь базы, а не запрашивается на
каждое открытие книги. Миграции старого ключа `aquilum-reader-state-v1` из localStorage больше нет:
у пользователей он не встречался.

## Цепочка при перелистывании

```text
FoliateReaderEngine.onRelocate
  → BookReader.writePages (без debounce; dedupe по formatted N/M)
  → useEditorReader.handleReaderPagesChange
  → persistBookReaderMeta(progressPagePath, { pages, readerPosition, readPercent })
       1. publishBookPageProgress (сразу)
       2. drain: writeProgress пока latest не стабилен
```

`progressPagePath` — absolute path **страницы книги** (`.md`), задаётся при открытии
ридера со страницы книги или из hydrate callout (`bookPagePath`).

## Coalesced persist

`persistBookReaderMeta` копит ещё не записанные поля в `pendingMeta` по ключу
`comparablePath(pagePath)` и ставит запись в общую очередь путей `PathQueue`
(`modules/pathQueue.ts`):

- каждый flip сливается с ожидающими полями той же страницы;
- записи одной страницы идут строго по очереди; задание забирает всё накопленное к своему
  запуску, поэтому серия flip'ов, пришедших во время записи, ложится одной следующей записью, а
  остальные задания очереди находят пустой буфер и ничего не пишут;
- при закрытии ридера — `flushBookReaderMeta` (дождаться хвоста очереди страницы).

Все поля ставятся в текст одним проходом `setFrontmatterField` по списку полей, и этим же
текстом обновляются оба пути. Открытый Y.Doc с writer: `applyDocumentText(..., DIRECT_WRITE_ORIGIN)`
минимальным диффом + `writer.writeCurrent` — текст для диска читается из Y.Doc в момент записи, иначе
символы, набранные пока шла предыдущая запись, терялись бы на диске (подробно — [[dataview-queries]],
переключение задач). Закрытая страница или документ без writer: `readFileSnapshot` + `writeFileAtomic`.
Раньше открытый документ правился отдельной транзакцией на каждое поле, а закрытый файл —
вторым, параллельным циклом по тем же полям; два списка полей расходились бы при первом же новом
поле.

Страница книги в React: `useEditorBookPage` подписан на `onDocChange(filePath)` и
обновляет `docContent` после патча Y.Doc.

## Runtime bus (`bookPageRuntime.ts`)

In-memory `Map<comparablePath, BookPageRuntimeEntry>`:

```text
author, cover, bookFile   — из FM (hydrate)
pages                     — live N/M
pagesGeneration           — >0 после publish; hydrate не откатывает pages
```

### Подписка виджета

`BookCalloutWidget`:

1. После resolve wiki — `subscribeBookPageRuntime(bookPagePath)` **до** завершения
   hydrate (не пропустить flip во время I/O).
2. После hydrate — `patchBookCalloutDom` с `getPages` (live поверх FM).

При subscribe сразу вызывается listener с кэшированным `pages`, если есть.

### Hydrate и гонки

**Проблема:** после чтения в runtime лежит entry только с `pages` (без `book_file`).
Старый код считал cache «полным» и не читал FM → кнопка «Читать» disabled.

**Инвариант:** disk/FM читается, если в runtime **нет** `bookFile`:

```ts
runtimeHasMetadata(entry) === Boolean(entry?.bookFile)
```

`hydrateFromFm`:

- если `pagesGeneration > 0` — FM `pages` **не** перезаписывает live pages;
- metadata (`author`, `Book_cover`/`cover_url`, `Путь к файлу`/`book_file`) — из FM, merge с cache.

После hydrate виджет снова берёт `getPages(bookPagePath)`.

### LRU

До 64 entries; записи с активными подписчиками не выталкиваются. Память зависит от
числа **недавно показанных книг**, не от размера vault (1M заметок без открытых
виджетов — O(1) RAM на книгу в runtime).

## Нормализация путей

Ключ — `comparablePath` из `modules/paths.ts`: `\` → `/`, без хвостового слэша, без учёта
регистра. Это единственная функция ключа пути в приложении: открытые `Y.Doc`, runtime-шина,
очереди записи и точки синхронизации в IndexedDB считают ключ одинаково.

Wiki resolve и вкладки могут отличаться форматом пути; `getOpenDoc`, bus и persist
используют один key. Без этого persist патчит другой Y.Doc, чем вкладка книги.

## Reconcile CFI ↔ FM при open

`resolveReaderOpenTarget(bookFile, pages, initialCfi?)`:

| Условие | Куда открыть |
|---|---|
| `initialCfi` задан | CFI (quote jump) |
| SQLite CFI и `cache.current === pages.current` | CFI |
| SQLite CFI, но current расходится | fraction из FM; CFI в SQLite сбросить |
| иначе | fraction из FM или начало |

FM `pages` — грубая закладка; CFI — уточнение внутри «страницы».

## Матрица «кто куда пишет»

| Событие | Bus | FM `pages` | SQLite CFI |
|---|---|---|---|
| Обычное чтение | ✓ каждый flip | ✓ coalesced | ✓ debounced |
| Quote peek (клик по ссылке) | — | — | — |
| Импорт книги | — | ✓ initial 0/total | — |
| Ручная правка FM | — | ✓ editor | — |

## Чего не делать

1. **Не** хранить `pages` в теле `[!book]` callout.
2. **Не** писать CFI в markdown (кроме opaque href в цитате).
3. **Не** считать runtime полным без `bookFile`.
4. **Не** дублировать publish вне `persistBookReaderMeta` / `publishBookPageProgress`.
5. **Не** полагать, что размер vault влияет на bus — работает только open document.

## Тесты

- `bookPageRuntime.test.ts` — bus, path keys, hydrate vs live pages.
- `readerState.test.ts` — reconcile CFI/FM.
- `bookCallout/model.test.ts` — parse callout.
- `docPath.test.ts` — нормализация путей.

## Связанные документы

- [[book-reader]] — читалка, цитаты, synthetic pages, файлы.
- [[editor-book-callout]] — UI виджета, wiki hydrate.
- [[KNOWLEDGE_BASE]] — Book Page layout и обложки.
