# Layout, HeightMap и жизненный цикл виджета таблицы

Связано с: [[editor-tables]] ·
[[editor-table-strip-reorder]] ·
[[editor-table-interaction]]

## Парсинг, сохранение и жизненный цикл

1. `constructs.ts` line-scan находит только полные GFM-таблицы: header,
   separator и ≥1 body-ряд.
2. `markdown.ts` преобразует Markdown → нормализованный `TableModel`.
3. `TableWidget` рисует HTML `td` с `rowSpan`/`colSpan`.
4. Правки ячейки, диапазона и strip-reorder меняют model в одной
   `WidgetSession`.
5. Сохранение (debounce 250 ms или немедленный `apply` у структурных команд)
   вызывает `serializeTable` → транзакцию CodeMirror в
   `from..contentTo`.
6. При размонтировании активная ячейка фиксируется. Удаление таблицы отменяет
   pending-save.

После таблицы поддерживается пустая строка (`boundary.ts`). Caret guard не
даёт каретке оказаться в скрытых pipe-строках; Backspace сразу под таблицей
сначала выделяет таблицу как блок.

`eq()` виджета таблицы не учитывает `blockTo`: сдвиг хвостовой пустой строки во время печати не должен перемонтировать виджет посреди правки. Кнопки добавления строки и столбца всегда кликабельны и проявляются только через `opacity`: связка `:hover` + `pointer-events` в WebView срабатывала ненадёжно. Перестановка полос не опирается на `event.buttons`: после `preventDefault` на `mousedown` некоторые WebView сообщают `buttons = 0`, хотя перетаскивание продолжается. Свёрнутая каретка не допускается внутрь скрытого исходника таблицы, а непустое выделение остаётся нетронутым, чтобы Backspace по-обсидиановски выделял таблицу целиком. Под каждой таблицей обязана быть пустая строка — иначе каретке некуда встать после неё.

## HeightMap и hit-testing под таблицей

Block-виджет стоит в `cm-content` рядом с обычными `cm-line`. Координаты клика
(`posAtCoords`) считает HeightMap CodeMirror, а не «видимый» бокс браузера.
Если карта ниже реального DOM, строки под таблицей рисуются ниже своих
hit-зон: нужно целиться выше текста, выделение начинается с конца слова или
со следующей строки.

### Контейнеры

```text
.q-md-table-widget          paddingBlock, pointer-events: none
  .q-md-table-shell         grid: [scroll | add-col]
    .q-md-table-scroll      overflow-x: auto
      .q-md-table-layout    grid: [corner | col-strip] / [body]
        .q-md-table-body    grid: [row-strip | table-host]
      .q-md-table-add-row   в потоке под layout → scrollbar ниже кнопки
    .q-md-table-add-col     высота = layout (JS)
```

Col-strip и таблица лежат в разных grid-контейнерах, поэтому их левые края
совпадают только пока `corner` и `row-strip` одной ширины — за этим следит
`syncStripSizes`.

Chrome: add-row внутри scroll (над нативным scrollbar), add-col снаружи.
Высота add-col синхронизируется с `.q-md-table-layout` в `syncAddColHeight`.
Полосы `--q-space-20`, Plus `--q-space-16` / `--q-editor-table-handle`
(`--q-icon-faint`), курсор `pointer` — см.
[[editor-table-structure]].

Инварианты (ломать нельзя):

1. **Вертикальные отступы виджета — только `padding` на корне
   `.q-md-table-widget`, никогда `margin`.** HeightMap меряет border-box без
   margin; `marginBlock` сдвигает следующие `cm-line` относительно карты.
2. **Любой chrome, меняющий высоту (strips, add-row, будущие кнопки),
   триггерит `view.requestMeasure()`.** `ResizeObserver` в `WidgetSession`
   уже делает sync strips → measure.
3. **Корень `.q-md-table-widget` / `.q-md-table-shell` —
   `pointer-events: none`.** Интерактив — `auto` на `.q-md-table-scroll`
   (нативный scrollbar), layout, add-row/col, ячейках, strip.
4. **Клик по scrollbar не вызывает `leaveTable` / `focusAfterTable`.** Иначе
   `scrollIntoView` кидает камеру к строке после таблицы, а каретка родителя
   рисуется высотой всего виджета. `ignoreEvent` true на `.q-md-table-scroll`;
   в `onMouseDown` для hit по самому scroll (не layout) — ранний `return`
   без `preventDefault` (иначе ломается drag тамба).
5. **`estimatedHeight` — грубая оценка с запасом.** Точную высоту даёт
   measure; заниженная оценка опаснее завышенной.
6. **Все overlay-элементы живут внутри `.q-md-table-layout`**, а не на корне
   виджета: `.q-md-table-selection-overlay`, синяя линия resize
   (`.q-md-table-resize-line`) и drop-линия reorder
   (`.q-md-table-strip-drop`). Корень не скроллится, layout скроллится вместе
   со столбцами — линия, позиционированная относительно корня, при
   горизонтальном скролле «залипает» под курсором, пока граница столбца уезжает
   в сторону. Хост берётся через `tableOverlayHost(root)`, координаты считаются
   от его rect.
7. **Размеры треков для интерфейса берутся только из DOM (`geometry.ts`).**
   Strip-кнопки, hit-test границ, drop-линии reorder и baseline resize читают
   измеренные размеры, а не `model.colWidths` / `model.rowHeights`. Модель
   задаёт запрос, браузер даёт результат; расхождение этих двух чисел и было
   причиной «схлопнутого влево» strip и мёртвой зоны в начале drag —
   [[editor-table-structure]].

Симптом регрессии: клик по середине слова под таблицей ставит каретку в конец
слова или на строку ниже — проверить margin на корне и забытый
`requestMeasure` после роста chrome. Strip-reorder обязан соблюдать те же
правила: [[editor-table-strip-reorder]].
