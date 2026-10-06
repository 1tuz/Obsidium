# Markdown и live preview в редакторе Aquilum

## Назначение

Редактор Aquilum хранит обычный Markdown и поверх него строит визуальное представление, близкое к WYSIWYG.

Главный принцип:

```text
Markdown-текст является источником истины.
Форматирование и live preview являются только представлением.
```

Если пользователь видит жирный текст, заголовок, ссылку или круглый буллит, в `EditorState`, Yjs и `.md` всё равно находятся исходные символы `**`, `#`, `[]()`, `-` и так далее.

## Основные файлы

```text
src/components/Editor/
├── index.tsx
├── styles/layout.css
├── hooks/
│   └── useEditorDoc.ts
└── extensions/
    ├── index.ts
    ├── theme.ts
    ├── formatting.ts
    ├── ensureEditorTree.ts
    ├── livePreviewPlugin.ts
    ├── livePreviewReveal.ts
    ├── livePreviewVisibility.ts
    ├── blockquotePreview.ts
├── links/
│   ├── index.ts
│   ├── syntax.ts
│   ├── interaction.ts
│   ├── autoTitle.ts
│   ├── flow.ts
│   └── motion.ts
    └── outline/
        ├── index.ts
        ├── constructs.ts
        ├── commands.ts
        ├── preview.ts
        └── renumber.ts
    └── bookCallout/
        ├── constructs.ts
        ├── model.ts
        ├── linkedCache.ts
        ├── preview.ts
        ├── widget.ts
        ├── widgetDom.ts
        └── theme.ts
```

| Файл | Ответственность |
|---|---|
| `Editor/index.tsx` | CodeMirror + React, скролл-контейнер `.q-editor-container` |
| `extensions/index.ts` | сборка расширений |
| `theme.ts` | типографика Markdown, классы preview (`q-md-*`), scroll-past-end на `.cm-scroller` |
| `ensureEditorTree.ts` | sync-parse viewport+caret; общий helper для preview и link-flow |
| `livePreviewPlugin.ts` | hide коротких маркеров; `Decoration.replace` для chrome ссылок/wiki |
| `livePreviewReveal.ts` | `revealTarget(node)` → диапазон конструкции-владельца маркера |
| `livePreviewVisibility.ts` | `shouldRevealSyntax` — единое правило reveal |
| `blockquotePreview.ts` | синяя полоса `.q-md-blockquote` для `>` и `[!quote]` |
| `outline/commands.ts` | Enter: выход из пустой строки цитаты |
| `links/flow.ts` | `q-md-link-flow`: soft-wrap label; при активной ссылке — ещё и `](url)` |
| `links/motion.ts` | ArrowDown/Up внутри ссылки: document-line, не soft-wrap visual lines |
| `links/interaction.ts` | Ctrl/Cmd-click по ссылкам |
| `links/autoTitle.ts` | paste/drop URL → `[title](url)`; fetch через Tauri `fetch_page_title` |
| `outline/*` | списки `- ` / `N. ` / `N)` |
| `bookCallout/*` | виджет `> [!book]` ([[editor-book-callout]]) |
| `useEditorDoc.ts` | загрузка и сохранение `.md` |

## Слои отображения

Три независимых слоя.

### 1. Синтаксический разбор

`@codemirror/lang-markdown` + Lezer. Узлы хранят `from`/`to` в `EditorState.doc`.

Дерево строится **чанками**. После Tab/indent `syntaxTree(state)` часто покрывает только начало документа (~3–4 KB). Маркеры ниже обрезанного дерева без sync-parse остаются «сырыми».

### 2. Синтаксическое форматирование

`syntaxHighlighting(markdownStyles)` — внешний вид содержимого (heading, strong, link, code…).

### 3. Live preview

`livePreviewPlugin` вешает декорации:

| Что | Как |
|---|---|
| Короткие маркеры (`*`, `#`, `` ` ``, …) | `q-md-hidden-syntax` (`font-size: 0; opacity: 0`) — каретка может встать и touch-reveal |
| Chrome ссылок/wiki (`[`, `](url)`, `[[…]]`) | `Decoration.replace` — убираются из layout (replace сам atomic) |
| `HorizontalRule` | `transparent` + линия `.q-md-hr-line-cm` |

## Порядок расширений

1. tab size / outline / formatting keymap / `indentUnit`;
2. Markdown language (`outlineMarkdownConfig` + `wikiLinkMarkdownConfig`);
3. `syntaxHighlighting`;
4. `livePreviewPlugin`;
5. `editorLinkExtension` (`markdownLinkFlow` + `markdownLinkMotion` + click);
6. hashtags / frontmatter / wiki hover / smart dashes;
7. темы CodeMirror + Markdown;
8. `lineWrapping` / placeholder / `yCollab`.

Декорации разных ViewPlugin объединяются. Один синтаксический диапазон — один владелец hide/replace.

## Единое правило активности синтаксиса

| Файл | Роль |
|---|---|
| `livePreviewReveal.ts` | `revealTarget(node)` → `{ from, to, hideTo }` — диапазон конструкции-владельца |
| `livePreviewVisibility.ts` | `shouldRevealSyntax(doc, head, from, to)` — одно правило для всех маркеров, включая хэштеги (`hashtags.ts`) и list callouts |

Правило одно, без политик и исключений:

```text
маркер сырой  ⇔  каретка на строке владельца  И  head ∈ [from, to] владельца
```

1. Только **primary caret** (`selection.main.head`). Span выделения и `anchor` не раскрывают маркеры.
2. Владелец должен пересекать строку каретки; маркеры на других строках всегда в preview.
3. Края включительные: каретка сразу после последнего символа владельца ещё в зоне.

Владелец берётся из реестра `markerOwners` — ближайший предок маркера с таким именем:

| Маркер | Владелец | Что даёт |
|---|---|---|
| `HeaderMark` | `ATXHeading1…6`, `SetextHeading1…2` | каретка **в любом месте строки заголовка** → сразу виден `#` |
| `QuoteMark` | `Blockquote` | каретка в цитате → видны все `>` этого блока |
| `LinkMark`, `URL`, `WikiLinkMark`, `WikiLinkAliasMark` | `Link`, `Image`, `WikiLink` | каретка в ссылке → весь сырой синтаксис |
| `EmphasisMark`, `StrongMark`, `StrikethroughMark` | `Emphasis`, `StrongEmphasis`, `Strikethrough` | каретка в слове → обе пары маркеров |
| остальные (`CodeMark`, `HorizontalRule`) | нет — сам узел | касание маркера |

Владелец inline-эмфазы — сама конструкция (`**bold**`), а не строка: иначе `***bold***` и
соседние конструкции раскрывались бы вместе.

### Примеры

```text
***               caret на краю той же строки → сырой ***, линия снимается
***bold***        caret в слове → звёздочки скрыты
# Заголовок       caret в любой позиции строки → # виден, всё в одну строку
[[link]]          caret внутри или сразу после → [[ ]] видны; caret на другой строке → скрыты
[[link]] + ***    caret на HR → wiki выше не раскрывается
каретка на списке → ни wiki, ни *** на других строках не сырые
```

## Неполное дерево Lezer и `ensureEditorTree`

Проблема: после правки (Tab, indent) idle-parse не успевает; `syntaxTree(state)` короткий; hide-декорации не строятся для низа документа → сырые `[[…]]` и `***` «залипают».

Решение (не форк CodeMirror — подписка на его парсер):

1. **`ensureEditorTree(view)`** — `ensureSyntaxTree` до конца viewport + `head`, бюджет ~1 кадр (16 ms); итерировать **возвращённое** дерево, не повторный `syntaxTree(state)`.
2. **Rebuild при смене identity дерева** (`syntaxTree(state) !== syntaxTree(startState)`), даже без `docChanged`/`selectionSet` — когда idle-parse коммитит следующий чанк.

Обход декораций — только `visibleRanges` (через `visibleTreeRanges`). То же API используют `links/flow.ts` и collapse-диапазоны ссылок.

Тест-регрессия: `livePreviewTreeCoverage.test.ts` (длинный документ + хвост `[[…]]` / `***`).

## Какие маркеры скрывает live preview

| Узел Lezer | Пример | Способ |
|---|---|---|
| `EmphasisMark` / `StrongMark` / `StrikethroughMark` | `*`, `**`, `~~` | `font-size: 0` |
| `HeaderMark` | `## ` (+ следующий пробел, если есть) | `font-size: 0`; reveal по всей строке заголовка |
| `LinkMark`, `URL` | `[…](…)` | `Decoration.replace` |
| `CodeMark` | `` ` `` | `font-size: 0`; заборы ` ``` ` внутри `FencedCode` не скрываются (`isFenceMark`) — см. [[editor-code-blocks]] |
| `QuoteMark` | `>` | hide; reveal по `Blockquote` с кареткой; полоса `.q-md-blockquote` (не `[!book]`) |
| `WikiLinkMark`, `WikiLinkAliasMark` | `[[`, `|`, `]]` | `Decoration.replace` |
| `WikiLinkTarget` при наличии alias | `цель` в `[[цель\|alias]]` | `Decoration.replace` (только preview; caret внутри — полный wikilink) |
| `HorizontalRule` | `***`, `---`, `___` | `transparent` + линия |

Пустые `[[]]` не скрываются. `ListMark` не трогаем — владелец outline.

Внутри редактируемого `> [!book]` блока маркеры (`>`, `[!book]`, wiki) не
скрываются — `shouldRevealBookCalloutMarker` в `bookCallout/constructs.ts`
(один проход `findBookCallouts` за rebuild). Подробности:
[[editor-book-callout]].

Смежные куски `](url)` сливаются в один replace-range (`mergeCollapseRanges`).

## Заголовки (`#`…`######`)

Заголовок обязан рендериться **в одну `cm-line`**, без визуального переноса `#` и текста.

### Почему раньше был перенос (и почему `**bold**` работал)

Lezer размечает заголовок правилом `"ATXHeading1/..."`: класс заголовка получает **и текст, и сам маркер**. `highlightTree` отдаёт два плоских соседних span-а:

```text
"#"          → tok-heading tok-meta
" Заголовок" → tok-heading
```

Отсюда две причины дефекта, обе в `theme.ts`:

1. `markdownStyles` вешал на теги заголовков `display: inline-block`. Inline-block — атомарный бокс: при shrink-to-fit его ширина равна ширине колонки, если текст длиннее колонки, поэтому он не может делить строку ни с чем и целиком уезжает на следующую визуальную строку.
2. `.q-md-hidden-syntax { font-size: 0 }` не действовал на `#`: вложенный span заголовка **заново объявлял** `font-size`, и скрытый маркер продолжал занимать ширину. Видно его не было (`opacity: 0`), но он сдвигал текст и не оставлял места атомарному боксу.

`**bold**` не ломался, потому что стиль `strong` объявляет только `font-weight`: унаследованный `font-size: 0` работает, а атомарного бокса нет.

### Как сделано

| Что | Решение |
|---|---|
| Перенос | у тегов заголовков нет `display`; заголовок — обычный inline, перенос по словам средствами `cm-lineWrapping` |
| Скрытие маркера | `.q-md-hidden-syntax, .q-md-hidden-syntax *` — `font-size: 0`, `letter-spacing: 0`, `padding: 0`, `opacity: 0`; вложенные highlight-span-ы больше не возвращают ширину |
| Появление `#` | владелец `HeaderMark` — узел заголовка, поэтому каретка в любом месте строки сразу раскрывает маркер |
| Размеры | токены `--q-editor-heading-1…6-size` в `styles/tokens/components.css`, выведены из `--q-editor-font-size` |

Правило скрытия маркеров сформулировано так, чтобы не зависеть от стилей содержимого: любой стиль внутри скрытого диапазона обнуляется. Иначе каждый новый элемент с собственным `font-size` (заголовок, код, будущие размеры) снова протекал бы шириной.

Размеры заголовков задаются только токенами и зависят от `--q-editor-font-size`; `settings` меняет базовый размер, производные считает CSS. До этого `--q-editor-heading-4/5/6-size` не существовали вовсе — `font-size` становился invalid at computed-value time, и h4–h6 молча наследовали размер абзаца.

## Цитаты (`>`)

Обычные blockquote, `[!quote]` и `[!book]` — разные представления одного markdown-префикса `>`.
Механизмы hide/reveal и синей полосы — в общем слое live preview, не в отдельных виджетах.

### Hide / reveal `>`

| Файл | Роль |
|---|---|
| `livePreviewReveal.ts` | `QuoteMark` → владелец `Blockquote`, диапазон = весь блок с этим `>` |
| `livePreviewVisibility.ts` | `shouldRevealSyntax` — каретка в блоке раскрывает **все** `>` этого blockquote |
| `livePreviewPlugin.ts` | `font-size: 0` только на символ `>` (пробел после не скрывается) |

Пока каретка в blockquote — видны все `>` **этого** блока. Соседние цитаты (через пустую строку) остаются скрытыми.

```text
> a          caret здесь → > видны на обеих строках блока
> b|

> c          эта цитата — > скрыты
```

Тот же `revealTarget` / `shouldRevealSyntax`, что для `#`, `***`, wiki — без отдельной логики в `readerQuote/*`.

### Синяя полоса

| Класс | Где |
|---|---|
| `.q-md-blockquote` | строки с `>` в preview (`blockquotePreview.ts`) |
| `.q-md-blockquote` | корень виджета `[!quote]` (`readerQuote/widgetDom.ts`) |

Полоса **не** вешается на:

- `> [!book]` — свой card-chrome (`bookCallout/theme.ts`);
- смонтированный виджет `[!quote]` (каретка вне блока);
- lazy-строки без `>` внутри blockquote Lezer.

Токены: `--q-bg-accent`, `--q-caret-width` (как у reader quote раньше — теперь один источник в `blockquotePreview.ts`).

### Enter на пустой строке цитаты

`exitEmptyBlockquote` в `outline/commands.ts` — в цепочке Enter **до** `insertNewlineContinueMarkup`:

```text
Enter → continueOutlineItem → exitEmptyBlockquote → insertNewlineContinueMarkup
```

На строке только `>` / `> ` (без текста) внутри blockquote:

```text
> текст
> |        Enter
> текст

|         ← пустая строка + каретка в новом абзаце
```

Пустая quote-строка заменяется на `\n`, а не просто удаляется — иначе каретка оказывалась сразу под цитатой без отступа абзаца.

Тесты: `blockquotePreview.test.ts`, `livePreviewReveal.test.ts`.

## Когда декорации пересчитываются

- `docChanged`, `selectionSet`, `viewportChanged`;
- смена identity `syntaxTree` (idle-parse);
- async-резолв wiki (`refreshWikiLinks`).

При ошибке `RangeSetBuilder` предыдущий набор декораций сохраняется (нельзя оставлять `Decoration.none` — весь документ «сырой»).

## Аутлайн

Владелец: `outline/preview.ts`. То же `shouldRevealSyntax` — но на диапазон самого маркера,
без владельца: `- ` / `N. ` раскрываются касанием, а не всей строкой.

Подробности: `knowledge base/editor-outline.md`.

## Ссылки `[]()`

Поведение как в Obsidian Live Preview: неактивная ссылка — только label; активная (каретка в зоне) — сырой `[label](url)` в одной `cm-line`, soft-wrap внутри ширины редактора.

### Клик

Ctrl/Cmd-click → `links/interaction.ts` → URL из дерева → внешняя ссылка или wiki.

### Автозаголовок при вставке URL (`links/autoTitle.ts`)

Вставка или drop одного bare URL → `[Fetching Title#…](url)`, затем Tauri `fetch_page_title` (ureq + `<title>`) заменяет placeholder. Настройка `editor.autoLinkTitle` (по умолчанию вкл.). Выделение + paste URL → `[выделение](url)` без fetch. Не wiki-граф: только markdown `[]()`. Context-menu «Вставить» идёт через тот же `insertClipboardAsLink`.

### Collapse / reveal

- Каретка **вне** ссылки → `Decoration.replace` на `[` и на contiguous `](url)` (и wiki-marks).
- Каретка **в зоне** `[from, to]` (включительно сразу после `)`) → chrome виден, replace снят.
- Wikilink **с alias** (`[[цель|alias]]`), каретка **вне** → виден только alias; `[[`, цель и `|` collapsed (`collectCollapseRanges`, второй проход по `WikiLink`).
- Wikilink **с alias**, каретка **внутри** → полный `[[цель|alias]]` (ни target, ни marks не collapsed).

Подробнее и таблица инварианта: `knowledge base/links-and-backlinks.md` (раздел «Синтаксис»).

### Soft-wrap (`links/flow.ts`)

```css
.q-md-link-flow {
  word-break: break-all;
  overflow-wrap: anywhere;
}
```

- Всегда на видимый label (`hello` в `[hello](url)`).
- Пока каретка в ссылке — ещё на `](url)`, чтобы длинный URL не вылезал за край контейнера.

Не использовать `white-space: nowrap` на всю ссылку: адрес уезжает вправо за пределы редактора.

### Стрелки вверх/вниз (`links/motion.ts`)

Soft-wrap длинного URL создаёт несколько visual lines внутри одной document-line. Обычный ArrowDown шагает по ним → каретка «пропадает», reveal мигает.

`markdownLinkMotion`: если каретка в `Link` / `Image` / `WikiLink` и вертикальный шаг остался на той же document-line (soft-wrap), прыжок на следующую/предыдущую document-line с сохранением колонки; если строки нет — событие съедается, каретка и preview остаются.

### Скролл (scroll-past-end)

Когда у нижней ссылки раскрывается сырой URL, высота строки растёт. Запас снизу — как в Obsidian:

```css
/* theme.ts + tokens */
--q-editor-scroll-past-end: 675px;
.cm-scroller { padding-bottom: var(--q-editor-scroll-past-end); }
```

Токен: `styles/tokens/components.css`. Скролл документа — у `.q-editor-container` (`overflow-y: auto`, `overflow-anchor: none`).

## Неполный Markdown-синтаксис

Preview опирается на дерево, не угадывает намерение (`**текст*` без закрытия → нет strong preview; `-` без пробела → не аутлайн).

## Клавиатурное форматирование

`formatting.ts`: `Mod-b` / `Mod-i` / `Mod-Shift-s`. Backspace — стандартный посимвольный CodeMirror, без `deleteMarkupBackward`.

## Темы и токены

| Токен | Назначение |
|---|---|
| `--q-editor-text` / font / line-height | prose |
| `--q-editor-heading-*` | заголовки |
| `--q-editor-code-*` | код |
| `--q-text-link` | цвет ссылок |
| `--q-editor-scroll-past-end` | запас скролла под текстом (675px) |
| `--q-editor-max-width` | ширина колонки (`65ch`) |
| `--q-editor-padding-x/y` | поля контейнера |

## Правило владения диапазоном

| Диапазон | Владелец |
|---|---|
| hide/replace маркеров | `livePreviewPlugin.ts` |
| wrap flow для `Link`/`Image` | `links/flow.ts` |
| ArrowDown/Up внутри ссылки | `links/motion.ts` |
| paste/drop bare URL → titled link | `links/autoTitle.ts` + `modules/linkTitle.ts` |
| `- ` / `N. ` / `N)` | `outline/preview.ts` |
| `>` hide/reveal + полоса | `livePreviewReveal.ts` + `blockquotePreview.ts` |
| `> [!book]` book widget | `bookCallout/preview.ts` |
| `> [!quote]` reader widget | `readerQuote/*` (виджет; полоса — общий `.q-md-blockquote`) |
| стили содержимого | `markdownStyles` |
| caret / selection / base | `aquilumCodeMirrorTheme` |

## Как добавить новый Markdown-элемент

1. Найти узел Lezer.
2. Стиль содержимого → `markdownStyles`; hide маркера → `livePreviewPlugin` + `revealTarget` / `shouldRevealSyntax`.
3. Длинный скрываемый chrome (как URL) → `Decoration.replace` + `COLLAPSE_MARKERS`, не `font-size: 0`.
4. Не перехватывать Backspace ради визуала.
5. Учесть неполное дерево: обход через `ensureEditorTree`.
6. Тесты: неактивный / активный / незавершённый; для низа документа — coverage с `ensureSyntaxTree`.

## Инварианты

1. `EditorState.doc` — исходный Markdown; preview его не меняет.
2. Reveal только по `head` и только на строке каретки; края зоны включительные; одно правило `shouldRevealSyntax` без политик, диапазон — конструкция-владелец из `markerOwners`.
3. Hide/replace строится по дереву из `ensureEditorTree` + rebuild при commit idle-parse.
4. Один hide/replace-диапазон — один владелец (`ListMark` ≠ live preview).
5. Неактивный chrome ссылок — `Decoration.replace`; активный URL soft-wrap через `q-md-link-flow`, без `nowrap` на всю ссылку.
6. Wikilink с alias: в preview только alias; target не остаётся видимым (`livePreviewCollapse.test.ts`).
7. ArrowDown/Up внутри ссылки не ходят по soft-wrap visual lines (`links/motion.ts`).
8. Под текстом — `scroll-past-end`, чтобы смена высоты preview не двигала камеру у низа.
9. Перемещение каретки не сохраняет файл.
10. Автозаголовок URL — только paste/drop/context-menu слой (`links/autoTitle.ts`); title через Tauri, не wiki-граф.
11. `QuoteMark`: reveal по всему `Blockquote` с кареткой; полоса `.q-md-blockquote` не на `[!book]`.
12. Enter на пустой `> ` выходит из цитаты с одной пустой строкой до нового абзаца (`exitEmptyBlockquote`).

## Блок кода

`FencedCode` и `CodeBlock` рисуются как единый визуальный блок. Модуль `extensions/codeBlock/`
разложен по ответственностям: `blocks.ts` находит блоки в дереве и отдаёт номера их строк,
`index.ts` строит декорации, `scrollbar.ts` держит полосу прокрутки и синхронизацию, `theme.ts` —
стили. Раньше блока не было вовсе: `@lezer/markdown` помечает и инлайн-код, и текст блока одним
тегом `monospace`, поэтому единственный стиль давал фон с отбивкой каждой строке по отдельности,
и блок выглядел набором серых полосок.

Чтобы одно правило не обслуживало два разных случая, тег `monospace` в `markdownStyles` отдаёт
класс `q-md-code` вместо набора свойств. Инлайн-код оформляется этим классом, а внутри
`.q-md-code-block` фон и отбивка с него снимаются — фон рисует строка блока.

### Блок вне каретки — виджет, под кареткой — обычные строки

Блок кода живёт в двух состояниях, как таблицы (`tables/preview.ts`):

- выделение вне блока — `Decoration.replace({ block: true })` заменяет весь блок виджетом
  `CodeBlockWidget`: единственный DOM-контейнер с `overflow-x: auto`, внутри `<pre>` со строками;
- выделение внутри блока — замены нет, видны настоящие строки редактора с классом
  `q-md-code-block--edited` (фон, шрифт кода), и правится он как обычный текст. Крайние строки
  дополнительно получают `--top` и `--bottom`, которые несут скругления и вертикальные отступы:
  без них раскрытый блок выглядел прямоугольной плашкой и отличался от свёрнутого.

Горизонтальной прокрутки в раскрытом состоянии нет и быть не может — там настоящие строки
редактора, а любая прокручиваемая строка снова попала бы под `scrollRectIntoView` (см. ниже).
Поэтому раскрытый блок переносит длинные строки, а прокрутка живёт только в свёрнутом виде.

Поле пересчитывается на `tr.docChanged || tr.selection`, а `EditorView.atomicRanges` не пускает
каретку внутрь свёрнутого блока при навигации стрелками. Клик по виджету ставит каретку в
кликнутое место: обработчик берёт `caretRangeFromPoint`, находит текстовый узел строки и
складывает смещение с `data-from`, где лежит позиция начала строки в документе.

Блочные декорации CodeMirror запрещает выдавать из `ViewPlugin` — попытка кончается
`RangeError: Block decorations may not be specified via plugins`, поэтому это `StateField`.

### Почему не прокрутка отдельных строк

Первая версия давала каждой строке блока собственный `overflow-x: auto` и синхронизировала
`scrollLeft` между строками. Это не работает принципиально: `scrollRectIntoView`
(`@codemirror/view`) при каждом движении каретки идёт вверх по DOM и подкручивает **любого**
прокручиваемого предка — пропускает только те, у которых `scrollWidth <= clientWidth`. Строка
блока как раз такой предок, поэтому каретка сама таскала блок, а синхронизация разносила сдвиг
на все строки. Пока строки прокручиваются сами, каретка ими управляет; единственный выход —
контейнер на блок, то есть виджет.

### Геометрия виджета

Три правила, каждое проверено измерением в браузере:

- `.q-md-code-block { width: 0; min-width: 100%; box-sizing: border-box }` — `.cm-content` у
  CodeMirror flex-элемент с `flex-shrink: 0`, поэтому широкое содержимое растягивает его по себе:
  при редакторе 600px контент становился 1400px и блок уезжал за правую границу. Нулевая ширина
  убирает вклад содержимого во внутренний размер родителя, `min-width` возвращает блоку ширину
  редактора.
- `.q-md-code-block__code { width: max-content; min-width: 100% }` — без этого `<pre>` принимает
  ширину контейнера, переполнение остаётся внутри `pre`, и контейнер не считает себя
  прокручиваемым: полоса не появляется вовсе.
- `overflow-x: auto` на контейнере даёт одну нативную полосу под блоком; она стилизована
  глобально в `styles/base.css` через `--q-scrollbar-*`, то есть выглядит как везде в приложении.
  Прокрутка двигает блок целиком — это один элемент, синхронизировать нечего.

### Ограждение остаётся видимым

Ограждение блока (``` и имя языка) не скрывается, в отличие от остальных маркеров: функция
`isBlockFence` в `livePreviewSyntax.ts` исключает `CodeMark` с родителем `FencedCode`. Причина в
том, что раньше скрывался только сам `CodeMark`, а `CodeInfo` — нет, и первая строка блока
показывала висящее в воздухе имя языка вроде `js` без ограждения, а последняя превращалась в
пустую полосу. Имя языка полезно видеть, поэтому ограждение показывается целиком и красится как
служебный символ. Обратные кавычки инлайн-кода по-прежнему скрываются.

### Краевые случаи

Границы блока считаются по строкам, а не по позициям узла: `node.to` у незакрытого блока
указывает за перевод строки, поэтому последняя строка ищется по `node.to - 1`. Иначе блок
захватывал бы следующую пустую строку. Покрыто в `codeBlock/blocks.test.ts` вместе с незакрытым
ограждением и блоком из одной строки.

Токены блока — общие для карточек `--q-block-*` в `styles/tokens/components.css` ([[design-tokens]]): те же, что у таблицы dataview,
виджета книги и сниппета кода в настройках MCP; скругление — `--q-rounded-2xl` (12px), как у модальных окон.

### Подсветка языка внутри блока

`markdown()` получает `codeLanguages: languages` из `@codemirror/language-data`, поэтому код внутри
ограждения с указанным языком разбирается вложенным парсером. Реестр языков попадает в основной
бандл (около 31 КБ), а сами грамматики — отдельными чанками, которые подгружаются только при
открытии заметки с таким блоком; на диске это около мегабайта на все языки.

Важная деталь при отладке: вложенное дерево крепится через `NodeProp.mounted`, и ни `tree.toString()`,
ни обычный обход курсором его не показывают — по дереву будет виден только `CodeText`. Проверять
надо через `tree.resolveInner(pos)`: внутри `js`-блока он возвращает узлы JavaScript. На этом и
построен тест `markdownConfig.test.ts`, который ловит потерю `codeLanguages`.

Сама конфигурация парсера собрана один раз в `editorMarkdownSupport` (`markdownConfig.ts`), а не
внутри хука расширений: так тест проверяет ровно ту конфигурацию, которую использует редактор, и
парсер не пересобирается при каждом монтировании.

Цвета подсветки — токены `--q-editor-code-keyword`, `-string`, `-number`, `-comment`, `-function`,
`-type`, `-property` со своими значениями для тёмной темы. Список пар «тег → класс» лежит в
`codeBlock/highlight.ts` один раз и питает оба пути отрисовки: `HighlightStyle` для настоящих строк
редактора и `tagHighlighter` для `highlightTree`, которым виджет красит свой `<pre>`. Классы
одинаковы, поэтому свёрнутый и раскрытый блок выглядят одинаково.

Операторы и знаки препинания намеренно не перекрашиваются: их тег `punctuation` уже занят
markdown-разметкой (`q-md-syntax-char`), и вторая политика на тот же тег дала бы конфликт. `labelName`
тоже исключён из группы функций — иначе имя языка в ограждении красилось как вызов функции.

## Скобки без цели — не ссылка

`[текст]` без `(url)` и без `[id]` — не ссылка. `@lezer/markdown` этого не проверяет: он
создаёт узел `Link` для любой парной скобки, полагаясь на то, что в CommonMark такую запись
разрешает определение вида `[id]: url` где-то в документе. Наличие определения парсер не
смотрит, поэтому узел появлялся всегда.

Через `markdownStyles` этот узел получал класс `q-md-link`, то есть цвет ссылки, подчёркивание
и `cursor: pointer`. Заметнее всего это было во frontmatter — строка `tags: [работа, идеи]`
выглядела ссылкой, — но так же красился любой `[черновик]` в тексте заметки. Пустой `tags: []`
проблемы не показывал: пустая метка ссылкой не считается.

Лечится в грамматике: `plainBracketMarkdownConfig` (`links/syntax.ts`) — inline-парсер,
зарегистрированный `before: 'Link'`. На закрывающей `]` он смотрит следующий символ и, если это
не `(`, не `[` и не `]`, возвращает позицию за скобкой, не создавая узла. Стандартный парсер
`Link` до этой позиции уже не доходит, скобка остаётся обычным текстом, а открывающая `[`
остаётся неиспользованным разделителем. Исключения из проверки сохраняют все формы, которые
цель называют: `[текст](url)`, `![alt](img)`, `[ref][id]`, `[[Вики-ссылка]]` и `- [ ] задача`
(GFM разбирает чекбокс на открывающей скобке, до нашего парсера). Покрыто тестами в
`links/syntax.test.ts`.

### Почему это не лечится через CSS

Первая попытка — сбросить `text-decoration` селектором `.q-cm-frontmatter *` в `theme.ts` — не
работает, и полезно понимать, почему. Реальный DOM CodeMirror для строки frontmatter выглядел
так:

```html
<span class="q-md-link"><span class="q-cm-frontmatter">
  <span class="q-cm-frontmatter-value">работа, идеи</span></span></span>
```

Марка подсветки — внешняя, марка frontmatter вложена в неё, поэтому селектор
`.q-cm-frontmatter *` до `.q-md-link` вообще не достаёт. И даже если бы достал: `text-decoration`
предка в CSS пропагируется на потомков и отменить его у потомка нельзя — `text-decoration: none`
внутри подчёркнутого элемента линию не убирает. Вывод общего характера: если разметка пришла из
дерева Lezer, править её надо в грамматике или в декорациях, а не каскадом.

### Что markdown всё ещё размечает внутри frontmatter

`frontmatterRange()` и `frontmatterBlock.ts` задают границы блока и его декорации, live preview
этот диапазон исключает через `stateFrontmatterRange()`, но markdown-парсер про
frontmatter по-прежнему ничего не знает: `author: **Толстой**` даёт `StrongEmphasis`,
значение в обратных кавычках — `InlineCode`, `mood: *грустный*` — `Emphasis`. Правило
`.cm-content .q-cm-frontmatter, .cm-content .q-cm-frontmatter *` гасит шрифт, размер и вес, но
не `font-style` курсива и не фон с отбивкой у инлайн-кода, так что такие значения всё ещё
выглядят оформленными. Полное лечение — отдельный блок-парсер frontmatter, но у него есть своя
цена: `@lezer/markdown` не умеет отматывать уже прочитанные строки, поэтому пока закрывающий
`---` не набран, весь документ ниже уезжал бы во frontmatter прямо во время печати. Готового
`yamlFrontmatter` из `@codemirror/lang-yaml` тоже недостаточно: он меняет корневой язык
редактора и тянет в бандл парсер YAML.

## Связанные документы

- `knowledge base/editor-outline.md` — списки, hanging indent, нумерация.
- `knowledge base/editor-book-callout.md` — виджет `[!book]`, каретка на границе блока.
- `knowledge base/design-tokens.md` — CSS-токены.
- `knowledge base/document-lifecycle.md` — Yjs и сохранение Markdown.
- `knowledge base/tab-switching.md` — контейнер редактора и загрузка документа.

## Архитектурная карта и точки расширения

Live preview разделён на уровни с односторонними зависимостями:

```text
Markdown/Yjs
  → markdownConfig.ts (Lezer-конструкции)
  → syntax tree / специализированные scanners
  → reveal owners / editable spans
  → syntax decorations и block widgets
  → themes и DOM widgets
```

### Единые точки регистрации

| Задача | Точка регистрации |
|---|---|
| Добавить Lezer Markdown extension | `markdownConfig.ts` → `editorMarkdownExtensions` |
| Задать представление синтаксического маркера | `livePreviewSyntax.ts` → `syntaxMarkerPresentations` |
| Изменить диапазон раскрытия активного маркера | `livePreviewReveal.ts` |
| Изменить общее правило активности курсора | `livePreviewVisibility.ts` |
| Добавить block widget | `livePreviewWidgets.ts` и его feature-папка |
| Добавить редактируемый block span | `livePreviewEditableSpans.ts` |
| Добавить поведение ссылок | `links/` |

`livePreviewSyntax.ts` является реестром только для общих синтаксических маркеров. `ListMark`, таблицы, frontmatter и block widgets туда не добавляются: у них есть собственные владельцы диапазонов и транзакций.

### Добавление Markdown-форматирования

Для нового inline-формата:

1. Зарегистрировать Lezer extension в `markdownConfig.ts`, если стандартное дерево CodeMirror не содержит нужных узлов.
2. Добавить marker nodes в `livePreviewSyntax.ts`: `hidden` для коротких маркеров, `collapsed` для длинного chrome, который не должен занимать место, `horizontal-rule` только для line-preview HR.
3. Указать владельца маркера в реестре `markerOwners` (`livePreviewReveal.ts`), если раскрывать нужно по конструкции, а не по касанию самого маркера. Другого кода активности писать не нужно.
4. Добавить стили содержимого в `theme.ts` через теги Lezer и дизайн-токены.
5. Проверить три состояния: preview все конструкции, курсор внутри, незавершённый ввод. Для длинного документа добавить coverage через `ensureEditorTree`.

Нельзя одновременно скрывать один диапазон в общем live-preview и специализированном extension. Один диапазон — один владелец.

### Добавление нового типа цитаты или callout

Новый визуальный тип `> [!type]` располагается в отдельной feature-папке рядом с `bookCallout/` и `readerQuote/`:

```text
newCallout/
  constructs.ts   — распознавание и диапазоны Markdown
  model.ts        — данные без CodeMirror DOM
  decorations.ts  — адаптация span → Decoration
  widget.ts       — WidgetType и события
  widgetDom.ts    — DOM-представление
  theme.ts        — стили на токенах
```

После этого widget регистрируется в `livePreviewWidgets.ts`, а его spans — в `livePreviewEditableSpans.ts`. Общие правила границ blockquote следует добавлять в `blockquoteScan.ts`; специфические заголовки, legacy-синтаксис и модель остаются внутри feature.

Не следует создавать универсальный callout-parser с ветвлением по всем типам. `[!book]` и `[!quote]` уже различаются моделью, legacy-форматом и поведением widget. Общими должны быть только проверка строк blockquote, обрезка хвостовых пустых строк, selection/reveal и создание replace-decoration.

### Инварианты редактирования ссылок

- `links/syntax.ts` владеет грамматикой wiki-ссылки.
- `livePreviewSyntax.ts` определяет, что link/wiki chrome атомарно схлопывается.
- `livePreviewReveal.ts` раскрывает весь owner `Link`, `Image` или `WikiLink`, а не отдельный marker.
- Пока курсор внутри wiki-ссылки, async resolve может обновить cache, но не инициирует layout-refresh. Следующая обычная транзакция применит цвет resolved/unresolved без моргания.
- `links/flow.ts`, `links/motion.ts` и `links/interaction.ts` отвечают соответственно за перенос, вертикальное движение и открытие; они не создают конкурирующие hide/replace ranges.

### Оценка масштабируемости

Архитектура хорошо масштабируется для новых inline-форматов: регистрация синтаксиса и способ отображения теперь вынесены из React-сборки и основного preview plugin. Для нового формата обычно достаточно двух реестров (`syntaxMarkerPresentations` и `markerOwners`), темы и тестов — правило активности каретки общее и переписывать его не нужно.

Для новых block widgets масштабируемость умеренная: feature изолируется хорошо, но две явные регистрации обязательны, потому что widget-decoration и режим редактирования используются разными слоями. Это намеренная видимость зависимости, а не автоматическая plugin-система. Если типов станет много, следующий оправданный шаг — типизированный реестр block-preview providers, который одновременно предоставляет `findSpans` и `collectDecorations`; до этого отдельная абстракция будет преждевременной.

Блочные виджеты картинок — единственный случай, где регистрация одна, а не две: строка с
картинкой не попадает в `collectEditablePreviewSpans`, потому что входить в неё стрелками
нечего, а показ исходника нужен только по явному действию. Разбор — [[editor-images]].

## Цитаты, теги и блочные виджеты

Текст цитаты стоит на одном и том же x с кареткой и без неё: виджет цитаты имеет левый отступ ровно на ширину `> ` в моноширинном шрифте редактора, а сырой `>` при раскрытии свисает назад в этот отступ. Поэтому вход каретки в цитату не сдвигает текст. Синяя полоса `.q-md-blockquote` общая у обычных `>` и виджета `[!quote]` и пропускается у `[!book]` и у смонтированных виджетов цитат. Серый маркер `[!name]` любого callout-а показывается сырым текстом только пока каретка внутри блока, поэтому callout-ы без каретки не требуют вообще никакого сканирования. По той же причине `QuoteMark` скрывается через `transparent`, а не через `font-size: 0`: маркер сохраняет свою ширину, и окружающий текст не прыгает, когда маркер прячется.

Исходник редактируемого блока показывается только пока редактор в фокусе: когда фокус уходит, например в поле названия заметки, блок снова рисуется виджетом, а не разметкой, хотя выделение CodeMirror формально осталось внутри. Стрелки при подходе к блоку входят в него с первой или последней строки, а не перепрыгивают через него. Блочные replace-виджеты живут в отдельном наборе декораций от синтаксических марок: смешение блочных замен и инлайн-марок в одном RangeSet ломает их порядок и раскладку. Хром неактивных ссылок убирается через `Decoration.replace`, а не через `font-size: 0`: невидимые фантомы нулевого размера оставались в раскладке, и ArrowDown застревал на них.

Тег внутри пункта списка сбрасывает `text-indent` у себя: висячий отступ строки списка наследуется внутрь инлайн-элемента и сдвигает текст тега относительно его же фона. Это тот же приём, что у маркера списка в `outline/theme.ts`.
