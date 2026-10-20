# Копирование в буфер обмена

Статус: действует. Единая точка записи в буфер — `src/modules/clipboard.ts`.

## Почему не `navigator.clipboard.writeText`

В Tauri страница живёт не на обычном origin. На Windows это `http://tauri.localhost`, на macOS и
Linux — `tauri://localhost`. Браузерный Clipboard API выдаётся только защищённому контексту, и
`tauri.localhost` в это правило не попадает: `navigator.clipboard` либо отсутствует, либо
`writeText` отклоняется. Дальше поведение зависит от платформы: WKWebView может отклонить запись
без пользовательского жеста, а WebView2 под Windows отдаёт `NotAllowedError` из-за политики
разрешений.

Отсюда правило: прямой вызов `navigator.clipboard.writeText` в компонентах запрещён. Все места,
которые пишут текст в буфер, идут через `copyText`.

## Контракт `copyText`

```ts
export async function copyText(text: string): Promise<boolean>
```

1. Пробует `navigator.clipboard.writeText`. Успех — `true`.
2. Если API нет или запись отклонена — резервный путь: скрытая `textarea` с `readonly`,
   `position: fixed`, `top: 0`, `left: -9999px`, добавленная в `document.body`, `select()` и
   `document.execCommand('copy')`.
3. Возвращает результат резервного пути. Выделение пользователя сохраняется и восстанавливается,
   `textarea` удаляется всегда, в том числе при исключении.

`execCommand` формально устарел, но остаётся единственным способом записи без защищённого
контекста и без разрешений, и он работает во всех трёх WebView, которые поддерживает приложение.
Убирать резервный путь нельзя: именно он делает копирование рабочим в собранном приложении, даже
если в браузере разработки всё выглядело исправно.

Функция не логирует и не показывает ошибок. Решение, что делать с `false`, принимает вызывающий:
`useSelectionMenu` и `ErrorReport` пишут в консоль, `WorkspaceDialog` дополнительно показывает
`workspaces.copyFailed`, `McpSection` не переключает лейбл на «скопировано».

## Где используется

| Место | Что копирует |
| --- | --- |
| `Common/useSelectionMenu.ts` | выделенный фрагмент заметки |
| `Common/ErrorReport.tsx` | текст отчёта об ошибке |
| `Workspace/WorkspaceDialog.tsx` | идентификатор хранилища |
| `Settings/sections/McpSection.tsx` | готовый сниппет подключения |
| `Editor/extensions/codeBlock/controls.ts` | содержимое блока кода |

Чтение буфера остаётся прямым: `useEditorBodyMenu.ts` вызывает `navigator.clipboard.readText` для
вставки. Чтение требует разрешения и в WebView доступно только по пользовательскому жесту; там, где
оно недоступно, штатная вставка ОС работает через событие `paste`, и подменять её не нужно.

## Проверка

`src/modules/clipboard.test.ts` (happy-dom) покрывает успех API, отказ API с переходом на резервный
путь, ложный результат `execCommand`, отсутствие `navigator.clipboard` и удаление `textarea`.

Настоящий буфер проверяется только в браузере: `browser.clipboardRead()` после вызова `copyText`
через оба пути. Юнит-тест этого не доказывает — он видит заглушку `document.execCommand`.

## Что сломается при откате

Возврат к прямому `navigator.clipboard.writeText` снова сделает кнопки копирования нерабочими в
собранном приложении при зелёных тестах и работающем браузере разработки.
