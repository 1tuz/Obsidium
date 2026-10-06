# Перестановка строк и столбцов таблицы (strip reorder)

Связано с: [[editor-tables]] ·
[[editor-table-merges]] ·
[[editor-table-structure]] ·
[[editor-table-layout]]

## Назначение

Пользователь перетаскивает строки и столбцы за label strip (`A B C …` /
`1 2 3 …`). После drop номера пересчитываются, Markdown сериализуется обратно
в документ. Это не отдельный документ и не второй источник правды: как и
остальные правки таблицы, reorder меняет `TableModel` и пишет его через
`serializeTable` → транзакцию CodeMirror.

## UX

| Жест | Поведение |
|---|---|
| Клик по label без движения | Только выделение строки/столбца (`expandSelection`). |
| Shift + клик по label | Расширяет уже существующий прямоугольник. |
| Drag ЛКМ за label | Перестановка expanded-блока; линия вставки `.q-md-table-strip-drop`. |
| Граница строки/столбца | Resize трека — [[editor-table-structure]]; hit границы приоритетнее reorder. |
| Drop на валидную щель | Блок переезжает, labels перерисовываются. |
| Drop внутрь чужого merge | Линия серая (`data-valid="false"`), курсор `not-allowed`, no-op. |

## Правило блока (то же, что у выделения)

Старт drag со strip использует тот же `expandSelection`, что и клик по номеру:

- вертикальный merge на строках 1–2 → drag за `1` или `2` тащит **обе** строки;
- цепочка горизонтальных merge (например A–E связаны span’ами) → drag за `C`
  тащит **весь компонент** A–E;
- «остров» вроде столбца F без горизонтальных связей едет один.

Частичный разрез merge через strip **невозможен**: expand уже сомкнул
непрерывный прямоугольник.

## Валидные щели вставки

`insertGap` — индекс щели `0…n` («вставить перед этой строкой/столбцом»,
`n` = после последней).

Щель **невалидна**, если:

1. после маппинга `destFromInsertGap` получается no-op (`dest === start`), или
2. щель лежит **строго внутри** merge, который **не целиком** входит в
   перетаскиваемый блок (`merge.start < gap ≤ merge.end`).

Щели на **границе** merge и снаружи — валидны. UI при наведении на невалидную
зону старается прилипнуть к ближайшей валидной (`snapInsertGap`); если
валидных нет — drop остаётся no-op.

Вызывающий обязан передавать блок строк или столбцов, который не разрезает объединения: блок заранее расширяется тем же `expandSelection`. Зазор, разрезающий объединение, не входящее целиком в перетаскиваемый блок, запрещён как место вставки. Диагностика перестановки пишется в консоль с меткой `q-table-strip`.

## Модель

| API | Файл | Роль |
|---|---|---|
| `moveRows` / `moveColumns` | `model.ts` | Перестановка contiguous-блока + remap merge/aligns/heights |
| `destFromInsertGap` | `model.ts` | Щель → итоговый стартовый индекс блока |
| `isValidInsertGap` | `stripReorder.ts` | Запрет дропа внутрь чужого merge |
| `expandedRowBlock` / `expandedColBlock` | `stripReorder.ts` | Блок = результат strip-expand |
| `commitStripDrag` | `stripReorder.ts` | Сборка результата для сессии |

Перестановка — permute индексов (не «вырезать одну ячейку из merge»). Merge,
целиком лежащие в блоке, едут с ним; внешние получают новые координаты через
`oldToNew`.

## Связь UI → документ (фронт ↔ бэк модели)

```text
mousedown strip
  → selectRow/Column + beginStripDrag
mousemove (document)
  → updateStripDrag → линия дропа
mouseup
  → commitStripDrag(model)
  → setModel + paintTableModel          // сразу DOM
  → apply() → scheduleApplyTableModel   // microtask
       → serializeTable(model)
       → view.dispatch(changes from..contentTo)
       → decorations rebuild / widget updateDOM|remount
```

Важно: `WidgetSession.apply` пишет **текущий** `tableModel` в диапазон
`widget.from..contentTo` (live-таблица из `findTablesInState`). Это тот же
канал, что у edit ячейки и add/delete row — отдельного «бэкенд-API» нет,
источник правды на диске/Yjs — Markdown.

### Ловушка, которая ломала apply (зафиксировано)

В `mouseup` нельзя вызывать `clearStripDrag` так, чтобы он обнулял
`state.dragging` **до** проверки `if (drag.dragging)`. Иначе линия дропа
живёт (move видит границы), а `commitStripDrag` никогда не вызывается —
ячейки «не переносятся», хотя UI кажется рабочим.

Сейчас `clearStripDrag(root)` принимает только корень и трогает лишь DOM линии дропа,
поэтому `if (drag.dragging) commit…` после него безопасен. Если `clearStripDrag` снова
начнёт менять состояние жеста, флаг надо снимать до вызова.

### Диагностика

Постоянного лога нет: `stripReorderLog.ts` удалён вместе с вызовами (он сериализовал таблицу
дважды на каждый коммит только ради логов). Для отладки — точка останова в `onMouseUp` сессии и
в `scheduleApplyTableModel`. Позиция вставки по оси считается одной функцией
`insertGapFromPointer(root, event, axis)`.

## Связь с layout

Reorder не должен возвращать `margin` на корень `.q-md-table-widget` и обязан
оставлять `requestMeasure` при росте chrome. Иначе hit-зоны текста под
таблицей снова разъедутся с отрисовкой — см.
[[editor-table-layout]].

Strip-кнопки живут в `.q-md-table-layout` с `pointer-events: auto`; корень
виджета — `pointer-events: none`, горизонтальный scroll — `.q-md-table-scroll`.
Новые ручки reorder не должны расширять hit-box за нижнюю границу таблицы без
measure.

## Регрессии, которые стоит прогнать вручную

1. Таблица без merge: переставить одну строку и один столбец — labels и
   Markdown совпадают.
2. Вертикальный merge на двух строках: drag за любой номер тащит обе;
   metadata `merges` сохраняет размер span на новых индексах.
3. Горизонтальный merge AB: нельзя бросить столбец C в щель между A и B
   (серая линия).
4. Большой компонент A–E + остров F: drag за C двигает A–E относительно F.
5. После drop — Undo возвращает прежний Markdown; каретка/выделение вне
   таблицы под виджетом не требует «прицеливания выше».
