# Виджет книги `[!book]` в редакторе Aquilum

## Назначение

Book callout — block-виджет поверх обычного Markdown. В файле и Yjs хранится
цитатный блок; в live preview (когда каретка **не** редактирует блок) CodeMirror
заменяет его карточкой по макету Figma (обложка, название, автор, прогресс,
кнопка «Читать»).

```text
Markdown / Y.Text / .md
          ⇅
   BookCalloutModel (+ async hydrate)
          ⇅
  BookCalloutWidget + DOM
```

Источник истины — текст в документе. Виджет не пишет обратно в markdown
(кроме будущих явных действий вроде «Читать»).

## Формат в markdown

Заголовок — первая строка блока цитаты:

```md
> [!book] [[Название страницы книги]]
> Автор: …
> Обложка: Files/cover.jpg
```

| Поле в теле | Ключ | Назначение |
|---|---|---|
| Заголовок | `> [!book] …` | inline-текст или `[[wiki]]` |
| Автор | `Автор:` | локальное значение; для wiki перекрывается FM страницы |
| Обложка | `Обложка:` | путь/URL; для wiki — `Book_cover`/`cover_url` со страницы |
| Файл | `book_file:` / `file_path:` | локально; для wiki — `book_file` со страницы |

**Прогресс** (`N/M`) не хранится в теле callout — только FM `pages` на **странице
книги** (wiki-цель). Виджет подписывается на runtime-bus и патчит DOM без
пересборки редактора. Подробно: [[book-reader-sync]].

Непрерывный блок — строки с префиксом `>` (и пустые `>`-строки внутри).

## Разделители между книгами

Соседние `[!book]` собираются в одну карточку-таблицу `BookCalloutGroupWidget`; разделитель между
книгами — это `border-bottom` строки, а у последней строки группы его нет.

Владелец сообщил дефект так: «между некоторыми строками нет разделителя». Именно «некоторыми» —
список книг идёт подряд, группа одна, а часть строуков не видна. Причина была в двух свойствах в
`theme.ts`, наложившихся друг на друга.

**`content-visibility: auto` с неверным `contain-intrinsic-size`.** Строка стояла на
`contain-intrinsic-size: 96px`, но это размер **content box**, а у строки ещё `padding: 0.75rem`
сверху и снизу и рамка. Реальная высота строки — 97px, а подменная за экраном — 121px. То есть каждая
строка меняла высоту в момент пересечения вьюпорта, и весь список ниже неё переезжал на дробное
смещение. Дальше арифметика: `padding` задан в `rem` и едет вместе с масштабом приложения, экран
владельца работает с дробным DPR, — и рамка толщиной 1px оказывалась не на границе физических
пикселей, а между ними. Blink размазывает её по двум рядам с половинной интенсивностью. Какие именно
строки попадут в невезучее смещение, зависит от прокрутки, поэтому строуки то есть, то нет.

**Цвет на пороге видимости.** Разделитель брал `--q-book-callout-border`, а это в тёмной теме
`--q-border-subtle` — пять процентов белого. Целая рамка на этом цвете едва видна, половинки от
сглаживания не видны вовсе.

Что сделано: `content-visibility` и `contain-intrinsic-size` из правила убраны — ленивую работу и так
делает `IntersectionObserver` в `groupWidget`, а пропуск отрисовки трёх элементов строки не окупал
переразметку. Разделителю заведён отдельный токен (теперь общий для всех карточек — `--q-block-divider`, см. [[design-tokens]]): рамка карточки
и разделитель внутри неё — разные вещи и не обязаны совпадать по цвету. Значение подбиралось глазами
владельца и село на восьми процентах в обеих темах: `--q-border-default` (в тёмной это двенадцать
процентов белого) он забраковал сразу — «линия слишком яркая». Пять процентов не видно, двенадцать
режет глаз, восемь — рабочая середина.

Это третий случай в проекте, когда `content-visibility: auto` оказался вреднее пользы, — см.
[[cover-scroll-jank]], откуда его убрали с паттерна обложки. В коде проекта его больше нет.

## Пустая строка между книгами

Отдельный дефект той же таблицы. Раньше группировка требовала `span.from === previous.to + 1`, то
есть книги обязаны были идти строка в строку. Стоило оставить между ними пустую строку или пустую
`>`-строку (а `trimTrailingEmptyQuoteLines` отрезает такую строку от span'а), как получались **два**
виджета вместо одного: у первого нет нижней рамки, у второго верхней, фон одинаковый — снова единый
список без строука.

Правило теперь такое: **книги, разделённые только пустыми строками, — одна группа.** Промежуток
проверяется целиком, `gapIsBlank(doc.sliceString(previous.to, span.from))`, и содержать он может лишь
пробелы, переводы строк и `>`. Любой настоящий текст между книгами (заголовок, абзац) списки
по-прежнему разделяет.

Диапазон группы включает эти пустые строки, и это безопасно: `collectPreviewReplaceDecorations`
снимает виджет, когда каретка пересекает диапазон **группы**, а не отдельной книги, — то есть попав
кареткой на пустую строку внутри списка, пользователь видит сырой markdown, как и внутри самой книги.

Покрыто `bookCallout/constructs.test.ts`.

## Файлы

```text
obsidium-app/src/components/Editor/extensions/bookCallout/
├── constructs.ts   span блока, пересечение с кареткой, reveal маркеров
├── model.ts        parse `> [!book]` + поля тела
├── linkedCache.ts  resolve wiki → read FM целевой страницы
├── preview.ts      StateField + Decoration.replace
├── groupWidget.ts  BookCalloutGroupWidget (WidgetType) — строки идут группой
├── prefetch.ts     данные всех строк документа одним проходом, до отрисовки
├── widgetDom.ts    render / patch DOM
├── theme.ts        EditorView.baseTheme (Figma-токены)
└── index.ts        bookCalloutExtension()
```

Тесты: `bookCallout/model.test.ts`.

Подключение: `extensions/index.ts` → `bookCalloutExtension(workspacePath, resolveWikiLinks)`.

## Режим preview vs редактирование

`preview.ts` строит `Decoration.replace` на весь span, **кроме** случаев, когда
выделение пересекается с блоком:

```ts
selectionIntersectsBookCallout(state, span)
// sel.from <= span.to && sel.to >= span.from
```

| Состояние каретки | Что видит пользователь |
|---|---|
| Вне блока | Виджет (карточка) |
| Внутри блока или на его границе | Сырой markdown (`> [!book] …`) |

### Каретка на `]]|` (конец wiki в заголовке)

Пример однострочного блока:

```text
> [!book] [[Новая книга]]
^from                              ^to
```

В CodeMirror `span.to` — **exclusive** позиция сразу после последнего символа
строки (после второй `]`). Каретка «после закрывающих скобок» имеет
`head === span.to`.

Раньше использовалось строгое пересечение `sel.from < span.to && sel.to > span.from`.
На границе `span.from` и `span.to` условие ложно → виджет оставался, хотя
пользователь редактирует текст.

**Инвариант (текущий):** inclusive-границы. Любая каретка или выделение, для
которых `sel.from <= span.to && sel.to >= span.from`, считается редактированием
блока → виджет **не** монтируется, показывается markdown.

Тот же диапазон `[span.from, span.to]` используется в
`shouldRevealBookCalloutMarker`: пока каретка в блоке, live preview не скрывает
`>`, `[`, `]` и wiki-chrome на строках callout (см. `livePreviewPlugin.ts`).

## Wiki-ссылка и hydrate

Если в заголовке `[[Страница]]`:

1. `linked: true` — в карточке показывается wiki-заголовок и кнопка «Читать».
2. Без wiki (inline-название) — кнопки нет, прогресс не показывается (нет страницы-книги).
3. Данные собирает `prefetch.ts` — один проход на документ: все вики-цели одним
   `resolveWikiLinks`, все пути одним `get_note_fields` из индекса полей. Файл
   целевой страницы не читается вовсе, см. [[frontmatter-field-index]].
4. Путь из индекса уже **абсолютный** — не склеивать повторно с workspace
   (`resolveWorkspaceFilePath` в `linkedCache.ts`).
5. Кэш по absolute path; повторные виджеты на той же странице не бьют диск.

| Поле виджета | Источник при wiki |
|---|---|
| author | FM `author` |
| pages | FM `pages` → `parsePages` |
| coverUrl | FM `Book_cover` / `cover_url` |
| canRead | FM `book_file` не пустой |

Кнопка «Читать»: `disabled`, если на странице книги нет `book_file`; прогресс
и автор подтягиваются независимо.

Клик по «Читать» → facet `onReadBook` → `BookReader`. Прогресс и CFI пишутся на
**страницу книги**, даже если читаем из callout на другой заметке
(`progressPagePath`). Схема контуров: [[book-reader-sync]].

## UI и токены

Стили: `theme.ts` + глобальные `buttons.css` (`q-button--xs q-button--primary`).

| Зона | Шрифт |
|---|---|
| Название, автор | prose редактора: `--q-editor-font-*`, `--q-editor-text` |
| Кнопка «Читать» | UI (`buttons.css`, Inter/system) |
| Прогресс | UI (`--q-font-family-ui`, 14px) |

Gap между названием и автором: `--q-gap-sm` (4px). Wiki-заголовок —
`--q-text-accent`.

## Ширина карточки и обрезка текста

### DOM (плоская flex-строка)

```text
.q-md-book-callout
├── .q-md-book-callout-cover
├── .q-md-book-callout-text   ← flex:1, min-width:0
│   ├── .q-md-book-callout-title
│   └── .q-md-book-callout-author
└── .q-md-book-callout-right
```

Лишняя обёртка `.q-md-book-callout-content` **не нужна** — cover / text / right
сидят прямо в корне. Название и автор: `text-overflow: ellipsis`, `title` =
полный текст (tooltip).

### Почему нельзя только CSS `width: 100%`

`Decoration.replace({ block: true })` — block-widget CodeMirror. Длинный заголовок
раздувает **min-width** `.cm-content`: родитель растёт вместе с текстом, и
`width: 100%` / flex / `100cqw` **не ограничивают** карточку — она вылезает за
колонку редактора на несколько пикселей или сильнее.

**Не работает как единственное решение:**

- `max-width: 100%` на виджете без явной ширины родителя;
- `min-width: 0` + ellipsis только на title (родитель уже шире viewport);
- `container-type` / `100cqw` без учёта padding `.cm-content`.

### Правильный механизм — `blockWidth.ts`, один на редактор

Ширина блочного виджета — свойство редактора, а не виджета: это ширина скролпорта
минус горизонтальные отступы `.cm-content`. Считает её один `ViewPlugin` и отдаёт
через переменную `--q-editor-block-width`; виджеты берут её из CSS.

```ts
width = floor(scrollDOM.clientWidth − paddingLeft − paddingRight)
if (width === applied) return;   // без этого цикл не сходится
view.dom.style.setProperty('--q-editor-block-width', `${width}px`)
```

**Почему один, а не по виджету.** Раньше каждая группа вешала свой `ResizeObserver`
и писала `root.style.width`. Запись ширины во время measure-цикла CodeMirror меняет
раскладку, цикл перезапускается, наблюдатель срабатывает снова — и CodeMirror
ругался в консоль «Measure loop restarted more than 5 times». Проверка «ширина
действительно изменилась» разрывает обратную связь, а один наблюдатель вместо N
убирает саму возможность их гонки.

**Инвариант:** ширина считается в **px** от viewport редактора, не от раздуваемого
`.cm-content`, и записывается ровно одним владельцем.

### Подстраховка

`aquilumEditorTheme` → `& > .cm-scroller { overflow-x: clip }` — обрезает редкий
horizontal bleed; **не заменяет** `blockWidth.ts`.

### Чеклист при правках виджета

1. Не возвращать вложенный `content`-wrapper без причины.
2. Не полагаться только на `%` / `cqw` для block-widget CM.
3. Ellipsis — на `.q-md-book-callout-title` / `-author`; flex-цепочка с
   `min-width: 0` на `.q-md-book-callout-text`.
4. После изменений — длинное название книги не выходит за `.q-editor-content`.

## Производительность

| Операция | Стоимость | Когда |
|---|---|---|
| `findBookCallouts(doc)` | O(число строк) | doc/selection change в preview; один раз за rebuild live preview |
| `shouldRevealBookCalloutMarker(spans, …)` | O(число callout в документе) на маркер | внутри уже построенного `bookSpans` |
| `prefetchLinkedCallouts` | два круга IPC на весь документ | до отрисовки; повтор только по новой ревизии индекса |
| `BookCalloutGroupWidget.toDOM` | sync DOM | только когда виджет на экране (каретка вне блока) |

Отдельного индекса callout нет: в типичном документе блоков 0–3, полный
линейный проход дешевле содержания инкрементальной структуры.

Обёрток вида `find…InState` нет: сборщики вызывают `findBookCallouts(state.doc)`,
`findReaderQuotes(state.doc)`, `findTablesInDoc(state.doc)` и `findImageEmbeds(state.doc)` напрямую.

Заголовки распознаются одними предикатами: `isBookCalloutHeader` (`blockquoteScan.ts`) и
`isReaderQuoteHeader` (`modules/docs/bookQuotes.ts`) — и в `findBookCallouts`, и в
`parseBookCalloutBlock`. Отображение записи книжной страницы в данные карточки одно —
`viewDataFromEntry` в `linkedCache.ts`; его же использует живое обновление прогресса в
`groupWidget.ts`, поэтому пустое поле записи не затирает уже показанное значение.

## Владение диапазонами

| Диапазон | Владелец |
|---|---|
| replace блока на виджет | `bookCallout/decorations.ts` → `livePreviewWidgets` |
| ширина block-widget | `blockWidth.ts` (один на редактор) |
| hide/reveal `>`, `[!book]`, wiki внутри блока | `livePreviewPlugin.ts` + `shouldRevealEditablePreviewMarker` |
| стили карточки | `bookCallout/theme.ts` |
| clip horizontal bleed scroller | `extensions/theme.ts` (`overflow-x: clip`) |

Не дублировать hide маркеров callout в других модулях.

## Инварианты

1. Markdown в документе — источник истины; виджет только читает span-текст.
2. Каретка или выделение на границе блока (`span.from`, `span.to`) → сырой текст, не UI.
3. Кнопка «Читать» только при wiki-заголовке `[[…]]`.
4. Wiki-hydrate не ломает absolute path из `resolve_wiki_links`.
5. Live preview внутри редактируемого callout показывает все syntax-маркеры блока.
6. Block-widget `[!book]` не шире колонки редактора: `--q-editor-block-width` + ellipsis на title/author.
8. Ширину блочного виджета пишет ровно один владелец: несколько наблюдателей, пишущих
   размеры во время measure-цикла, разваливают его.
7. Не использовать только CSS-проценты для ширины CM block-widget с длинным текстом.

## Связанные документы

- [[book-reader]] — читалка, synthetic pages, цитаты, файлы.
- [[book-reader-sync]] — синхронизация прогресса (bus + persist).
- [[editor-markdown-live-preview]] — reveal/hide.
- [[editor-outline]] — другие block-конструкции списков.
- [[KNOWLEDGE_BASE]] — Book Page UI, обложки, layout.
- Figma: Book widget `478:5784`, Button XS `148:2431`.
