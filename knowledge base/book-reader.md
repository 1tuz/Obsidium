# EPUB-читалка и страница книги

Обзор читалки, страницы книги (`type: book`) и связи с виджетом `[!book]`.
Синхронизация прогресса — отдельно: [[book-reader-sync]].

## Назначение

Aquilum читает EPUB/MOBI/AZW3/FB2 из vault (`Files/…`), хранит **грубый прогресс**
в markdown frontmatter страницы книги и **точную закладку** (CFI) локально в SQLite.
Виджет `[!book]` на других заметках показывает карточку книги и открывает ту же
читалку, не дублируя прогресс в теле callout.

## Файлы

```text
obsidium-app/src/components/Reader/
├── BookReader.tsx      overlay UI, selection → цитата
├── BookReader.css      оверлей, панель, навигация, поповер настроек
├── ReaderSettingsPopover.tsx  поповер «Настройки чтения» в шапке
└── ReaderEngine.ts     обёртка foliate-js (vendor submodule)

obsidium-app/src/components/Editor/hooks/
├── useEditorReader.ts  сессия читалки, progressPagePath
└── useEditorBookPage.ts страница книги, FM, загрузка файла

obsidium-app/src/modules/docs/
├── books.ts            import EPUB → Files/, pick dialog
├── bookProgress.ts     synthetic pages N/M (bytes / 1024)
├── bookQuotes.ts       aquilum-reader: ссылки и blockquote-цитаты
├── readerState.ts      CFI в SQLite (debounce 400 ms)
├── bookPageRuntime.ts  in-memory bus для UI
├── persistBookReaderMeta.ts  bus + FM pages / reader_position / read_percent
├── vaultAssets.ts      Files/… → convertFileSrc / absolute path
├── frontmatter.ts      ключи FM, bookPageTemplate, resolveBookFields
├── docPath.ts          нормализация путей вкладка ↔ wiki
└── ydocContent.ts      patch FM в Y.Doc без remount редактора

obsidium-app/vendor/foliate-js   git submodule
src-tauri/src/ui_state/reader.rs  SQLite reader_state
```

Виджет callout: [[editor-book-callout]].

Обёртка Book Page (баннер, миниатюра, кнопки): [[KNOWLEDGE_BASE]].

## Frontmatter страницы книги

| Ключ | Назначение |
|---|---|
| `type: book` | layout «страница-книга» |
| `cover: true` | баннер страницы |
| `author` | автор |
| `pages` | прогресс `current/total` (synthetic pages) |
| `Book_cover` (`cover_url`) | миниатюра; путь относительно vault |
| `Page_cover` (`page_cover_url`) | баннер |
| `Путь к файлу` (`book_file`) | ebook в `Files/` |
| `reader_position` | CFI для кросс-ридер sync |
| `read_percent` | 0–100 |

Шаблон новой книги: `bookPageTemplate()` в `frontmatter.ts`.

Бинарник книги **не** в Yjs — только на диске vault.

## Synthetic pages

`total = ceil(byteLength / 1024)` — стабильно между устройствами и шрифтами.
При импорте книги `pages` сбрасывается/нормализуется под новый total.
`current` — из fraction foliate при `relocate`.

## Открытие читалки

Три входа, одна `BookReader`:

| Вход | `progressPagePath` | `bookFile` |
|---|---|---|
| Кнопка «Читать» на странице книги | текущий `.md` | FM `book_file` |
| Виджет `[!book]` → «Читать» | wiki-цель (absolute path) | FM целевой страницы |
| Клик по цитате `aquilum-reader:` | нет (quote peek) | из href или текущая книга |

`resolveReaderOpenTarget` при обычном чтении:

1. `initialCfi` (цитата) — приоритет;
2. SQLite CFI — только если `cache.current === pages.current`;
3. иначе fraction из FM; устаревший CFI сбрасывается.

Файл книги загружается через asset-протокол (`convertFileSrc` → `fetch` → `File`), а не IPC-командой чтения: IPC вернул бы байты base64-строкой, раздутой на треть и целиком скопированной через мост, а `File` даёт zip.js внутри foliate произвольный доступ к архиву. Размер файла для синтетических страниц берётся параллельно из метаданных (`readFileStat`), а не из загруженных байтов.

## Оформление читалки

Настройки читалки применяются к уже открытой книге: `BookReader` на каждое изменение `readerSettings` вызывает `engine.applyStyle`, и движок переставляет стиль и режим листания, не открывая файл заново, — переоткрытие сбросило бы позицию и заново распаковало EPUB. `applyStyle` — единственная точка оформления страницы: типографика и режим листания меняются одним путём. CSS страницы (`readerStyleCss`) передаётся в `renderer.setStyles` foliate и поэтому переживает смену раздела: foliate сам накладывает его на каждый новый раздел. Шрифт задаётся отдельным правилом на все элементы, кроме кода, потому что книга несёт собственный CSS с `font-family` на абзацах, и он перебивает наследование от `body`. Файлы шрифтов попадают в страницу книги тем же CSS (`@font-face` из каталога): документ книги — отдельный iframe, и `@font-face` основного окна на него не действует; без этого до книги доходили только системные шрифты. Жирные элементы получают 700 отдельным правилом. Ширина колонки задаётся в символах, а foliate ждёт пиксели, поэтому `readerColumnWidthPx` измеряет ширину символа `0` выбранного шрифта через canvas `measureText` после `document.fonts.load` и кэширует её по строке шрифта; без замера одна и та же «ширина в символах» разъезжалась бы между узкими и широкими шрифтами. Подробно — [[fonts]].

## Цитаты

Выделение в читалке → `formatBookQuote` → вставка в текущую заметку callout-блоком с
нумерованной ссылкой в конце:

```md
> [!quote] текст цитаты [1](aquilum-reader:book=Files%2F….epub&cfi=…)
```

Номер в ссылке — тот же, что читалка рисует на странице книги. Клик по ссылке: открытие на CFI +
highlight, **без** записи прогресса (`highlightCfi` → не пишем CFI и FM).

### Как маркер выглядит на странице книги

Метку рисует `drawQuoteMark` в `ReaderEngine.ts` через `Overlayer` из foliate: это SVG-оверлей,
лежащий поверх текста и не участвующий в его вёрстке. Отсюда два следствия, которые нельзя обойти
косметикой:

- **Маркер не может отодвинуть соседнее слово.** Чтобы двигать текст, метку пришлось бы вставлять
  узлом в DOM книги, а любая вставка меняет текст, по которому считаются CFI, — то есть ломает
  адреса всех уже сохранённых цитат. Запас даётся только отступом от правого края последнего
  прямоугольника выделения (0.15 кегля) и кеглем метки (`QUOTE_MARK_SCALE`, 0.6 от текста книги).
- **Подсветка физически лежит перед текстом.** Чтобы она читалась как заливка за буквами,
  используется режим наложения: `lighten` в тёмной теме (светлые глифы не темнеют, фон
  подкрашивается акцентом) и `multiply` в светлой. Тема берётся из `data-theme` на корне документа,
  как в графе.

Сама метка — цифра без скобок: скобки занимали почти всю ширину и налезали на соседнее слово.

Подсветка цитат в книге и метки `[N]` строятся из текущего текста заметки (`bookQuotes.ts`): заметка — единственный источник правды о цитатах. Удалил цитату из заметки — исчезла и подсветка; отдельного хранилища цитат нет, чтобы ему не с чем было расходиться.

## CFI vs FM pages

| Данные | Где | Зачем |
|---|---|---|
| `pages: N/M` | FM страницы книги | git, виджеты, человек |
| CFI + current | SQLite `reader_state` | точная позиция при reopen |
| runtime `pages` | RAM `bookPageRuntime` | live UI без I/O |

Не дублировать `pages` в теле callout и не хранить CFI в markdown.

## Submodule foliate-js

```text
.gitmodules → obsidium-app/vendor/foliate-js
```

Сборка: Vite alias `foliate-js` в `vite.config.ts`. Prefetch при attach книги /
открытии ридера (`prefetchFoliate`).

Поповер настроек (`ReaderSettingsPopover`) — классы `.q-reader-settings` и `.q-reader-settings-scrim`
в `BookReader.css`. Стили поповера однажды пропали при чистке мёртвого CSS: компонент переименовал
классы (`q-book-reader-settings*` → `q-reader-settings*`), чистка увидела старые селекторы без
пользователей и удалила их, а новые так и остались без правил — поповер рисовался в потоке шапки без
фона. Восстановлены по истории git под текущие имена. Прозрачный scrim на `--q-z-popover` ловит клик
мимо панели и закрывает её; `Escape` сначала закрывает поповер, потом читалку.

Изменения настроек из поповера сохраняются через общий `useSettingsPersist`, как и в диалоге настроек:
своя копия `updateConfig(...).catch(...)` в читалке была вторым путём записи с собственным
логированием. Колбэки родителя и последние значения пропсов `BookReader` читает через
`useStableCallback`, а не через девять ручных `ref.current = prop`: эффект открытия книги зависит
только от книги, а обработчики всегда видят актуальные пропсы.

`ReaderEngine` не глушит ошибки молча: неудачная отрисовка или снятие маркера цитаты (например,
CFI из другой редакции книги) и сбой `view.close()` пишутся в консоль. Пустым остался только
`catch` вокруг `selection.extend` при удержании каретки — это ожидаемая гонка: узел, к которому
тянется выделение, может исчезнуть при перерисовке раздела между событиями.

## Инварианты

1. Единственный write-path для FM `pages` / `reader_position` / `read_percent` — `persistBookReaderMeta`.
2. Чтение из callout на чужой заметке пишет прогресс на **страницу книги**, не в callout.
3. Пути к открытым документам — через `comparablePath` из `modules/paths.ts` (slash + case на Windows).
4. Hydrate виджета не должен затирать live `pages` и не считается полным без `book_file`
   (см. [[book-reader-sync]]).
5. Quote peek не мутирует прогресс.

## Связанные документы

- [[book-reader-sync]] — двухконтурная синхронизация (bus + persist).
- [[editor-book-callout]] — виджет `[!book]`, preview, hydrate.
- [[KNOWLEDGE_BASE]] — Book Page UI, обложки, layout.
- [[editor-markdown-live-preview]] — reveal/hide маркеров.
