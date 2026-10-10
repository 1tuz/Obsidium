# Таблицы редактора Aquilum

Таблица Aquilum — редактируемый блок GFM Markdown. На диске и в Yjs хранится
Markdown; в редакторе CodeMirror заменяет его одним интерактивным виджетом.
DOM не является отдельным документом: после изменения `TableModel`
сериализуется обратно в исходный диапазон Markdown.

```text
Markdown / Y.Text / .md
          ⇅
      TableModel
          ⇅
  TableWidget + DOM + nested CodeMirror
```

Первый ряд Markdown — заголовочный ряд GFM, внутри виджета это такая же
редактируемая строка. Объединения разрешены и в нём.

## Карта документов

| Документ | О чём |
|---|---|
| [[editor-table-interaction]] | Клики, диапазон, overlay, слои выделения |
| [[editor-table-double-selection-fix]] | Инвариант «один видимый слой выделения» |
| [[editor-table-merges]] | Модель merge, объединить/разъединить, сценарии |
| [[editor-table-structure]] | Add/delete строк и столбцов, высоты, Tab/Enter |
| [[editor-table-strip-reorder]] | Drag строк/столбцов за A/B/C и 1/2/3 |
| [[editor-table-markdown]] | Формат на диске, `q-empty`, `^^`, metadata |
| [[editor-table-layout]] | HeightMap, hit-testing, жизненный цикл виджета |

## Как находятся таблицы

Таблицы для виджетов находятся построчным разбором, а не по узлам Lezer. Узел `Table` остаётся в markdown-конфиге только для подсветки: после правок на границах блока инкрементальное дерево бывает устаревшим, и диапазоны, взятые из него, роняли HeightMap. Кроме того, Lezer склеивает две соседние таблицы в один узел, поэтому найденный диапазон дополнительно режется на полные GFM-таблицы (шапка, разделитель, хотя бы одна строка тела). Таблица в документе, Yjs и `.md` остаётся обычным pipe-текстом, а `Decoration.replace` только прячет его в представлении, как live preview прячет `**`. Второго источника правды нет. Сворачивать исходные строки в нулевую высоту нельзя, и любой невалидный или частичный диапазон замены тоже ломает HeightMap (`lineInner` → `undefined.length`). Ячейка не может содержать перенос строки или `|`: первый разорвал бы строку таблицы, второй — колонку, поэтому ячейки однострочные.

## Ограничения (намеренные)

- ячейка — одна строка обычного текста;
- `|` при вводе → `∣`, перевод строки → пробел;
- нет формул, процентов, типов ячеек, ширин колонок и rich-text внутри ячейки;
- плюс UI добавляет строку снизу / столбец справа; перестановка — drag за strip
  ([[editor-table-strip-reorder]]).

## Кратко: жесты

Полная таблица жестов —
[[editor-table-interaction]]. Strip-reorder и
border-resize не смешиваются: hit границы сетки (~12px) приоритетнее; drag за
label двигает блок.

## Архитектура исходников

```text
obsidium-app/src/components/Editor/extensions/tables/
├── model.ts                  данные, инварианты, merge, moveRows/Columns
├── markdown.ts               Markdown ⇄ TableModel
├── constructs.ts             поиск таблиц и safe serialize
├── apply.ts                  транзакции CodeMirror и pending focus
├── structure.ts              дедупликация apply, команды структуры
├── preview.ts                block decorations
├── boundary.ts               пустая строка, caret guard, Backspace
├── widget.ts                 жизненный цикл WidgetType
├── widgetDom.ts              td, rowSpan/colSpan, overlay
├── widgetDomStrips.ts        A/B/C и 1/2/3
├── selection.ts              прямоугольный диапазон + expand
├── stripReorder.ts           drag строк/столбцов за strip
├── borderResize.ts           resize треков по границе сетки
├── widgetSession.ts          координация UI-сессии
├── widgetSessionNav.ts       Tab, Shift+Tab, Enter с merge
├── widgetSessionStructure.ts add/delete runners
├── widgetSessionMenu.ts      контекстное меню
├── widgetSessionDoc.ts       debounce записи
├── widgetSessionRegistry.ts  WeakMap bind/sync/dispose
├── cellEditor.ts             активная ячейка
├── tableCellField.ts         persistent nested CodeMirror
├── tableCellFieldExtensions.ts
├── tableCellFieldTheme.ts
├── parentSelection.ts        parent selection layer
├── contextMenu.ts            bridge к общему menu
├── theme.ts                  UI на дизайн-токенах
└── index.ts                  tablesExtension, insertTable
```

Модель и Markdown не знают о DOM; DOM не интерпретирует Markdown.

## Матрица гарантий

| Ситуация | Поведение |
|---|---|
| Второй merge далеко от первого | Первый не меняется. |
| Область частично задела merge | Диапазон расширяется до полной области. |
| `mergeCells` получил частичный регион | Модель отказывает без изменений. |
| ПКМ → unmerge | Меняется только этот merge. |
| Tab/Enter вокруг spans | Только видимые якоря. |
| Нативное browser selection в ячейке | Прозрачно; виден CM-selection или один overlay. |
| Текст сразу под таблицей | Каретка совпадает с нарисованной строкой (см. layout). |
| Drag strip внутрь чужого merge | Drop запрещён. |
| Drag strip по валидной щели | Блок переезжает; labels и Markdown обновляются. |
| Resize границы строки/столбца | Синяя линия; `rowHeights` / `colWidths` → metadata `rows`/`cols`. |
| Новый chrome в виджете | В потоке или absolute + `pointer-events: auto`; рост → measure. |
| Горизонтальный scrollbar таблицы | Drag работает: hit на `.q-md-table-scroll`, без `leaveTable`. |
| Полоса «добавить столбец» | Высота = `.q-md-table-layout`, снаружи scroll (не наезжает на track). |
| Кнопки add-row / add-col | Полоса `--q-space-20`, Plus `--q-space-16`, цвет `--q-icon-faint`, курсор `pointer`. |
