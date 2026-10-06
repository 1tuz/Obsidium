# Единая каретка Aquilum

## Архитектура

Редактор, название документа, таблицы и все компоненты `Input` используют каретку CodeMirror. Её вид централизован:

- `styles/tokens/semantic.css`: `--q-caret-color`, `--q-caret-width`, `--q-caret-radius`, `--q-caret-scale-y`;
- `components/Common/codeMirror.ts`: применение токенов к `.cm-cursor`;
- `components/Common/CodeMirrorField.tsx`: общий текстовый редактор;
- `components/Common/Input.tsx`: оболочка Input поверх `CodeMirrorField`.

Нативный HTML-input не подходит для визуально единой каретки: `caret-color` меняет только цвет, но браузер не даёт стабильно управлять шириной, радиусом и высотой. Рисовать overlay-каретку запрещено: она расходится с реальным selection при IME, прокрутке и вставке.

## Встраивание в Input

```tsx
const inputRef = useRef<CodeMirrorFieldRef>(null);

<Input
  ref={inputRef}
  value={query}
  onChange={setQuery}
  ariaLabel="Найти на странице"
  placeholder="Найти"
  startAdornment={<Search aria-hidden="true" />}
  counter={`${current}/${total}`}
  fullWidth
/>
```

Программный фокус: `inputRef.current?.focus()`. Для снятия фокуса: `inputRef.current?.blur()`.

## Встраивание без оболочки Input

```tsx
<CodeMirrorField
  value={title}
  onChange={setTitle}
  ariaLabel="Название документа"
  placeholder="Без названия"
/>
```

Многострочный вариант:

```tsx
<CodeMirrorField
  mode="multiline"
  lineWrapping
  value={description}
  onChange={setDescription}
  ariaLabel="Описание"
/>
```

## Клавиши

```tsx
<Input
  value={value}
  onChange={setValue}
  ariaLabel="Фильтр"
  onKeyDown={(event) => {
    if (event.key !== 'Escape') return false;
    event.preventDefault();
    close();
    return true;
  }}
/>
```

Обработчик возвращает `true`, когда событие полностью обработано. Однострочные поля автоматически нормализуют многострочную вставку и не создают строку по Enter.

## Геометрия

```css
.q-filter-field {
  --q-cm-content-padding: 0;
  --q-cm-font-size: var(--q-font-size-14);
}
```

Нельзя локально переопределять `.cm-cursor`, её цвет, ширину или transform. Для изменения каретки всего приложения меняются только общие токены.

## Числовые поля

`NumberControl` также использует `Input`. Парсинг числа, `min`, `max`, `step` и ArrowUp/ArrowDown принадлежат `NumberControl`, а текстовый ввод и каретка — общему компоненту.

С `stepButtons` поле получает тип `stepper` у `Input`: кнопки «−» и «+» внутри рамки, число по
центру. Шаг кнопок, стрелок и ограничение `min`/`max` — одна функция `shift` в `NumberControl`.

## `onChange` — только правки пользователя

`CodeMirrorField` программно вписывает внешнее значение в документ (`syncDocument`), а библиотека
`@uiw/react-codemirror` сообщает об этой правке тем же `onChange`, что и о вводе с клавиатуры. Поэтому
поле не передаёт наверх изменение, равное значению, пришедшему снаружи: это эхо собственной
синхронизации, а не ввод.

Без этого правила ломалось поле масштаба. Щелчок по «+» менял значение, поле вписывало его в документ,
эхо приходило в `NumberControl` как ручной ввод и оседало черновиком. Черновик сбрасывается только при
потере фокуса, а фокуса в поле не было, — и дальше поле показывало застывшее число, хотя масштаб
менялся `Ctrl +`/`Ctrl −`.

## Проверка

1. Сравнить каретку в редакторе, названии, таблице, поиске и настройках в обеих темах.
2. Проверить вставку многострочного текста, IME, selection и горизонтальную прокрутку.
3. Проверить focus ring, программный focus и disabled.
4. Для числового поля проверить пустой draft, дробные значения, min/max и стрелки.
5. Убедиться, что новое поле не содержит локальной копии `.cm-cursor` и цветов.
