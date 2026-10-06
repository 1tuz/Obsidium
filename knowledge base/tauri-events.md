# Подписки на события Tauri

Фронтенд слушает события бэкенда (`notes-relocated`, `note-history-changed`, `workspace-changed`,
`documents-changed`, `mcp-navigate`, события обновления) и оконные события (`onCloseRequested`)
через один хук: `useTauriSubscription` в `hooks/useTauriEvent.ts`, и обёртку над ним для событий
`useTauriEvent(event, handler, enabled)`.

## Связанные документы

- [[notes-gate]] — событие `notes-relocated` и `note-history-changed`.
- [[note-history]] — список истории обновляется по `note-history-changed`.
- [[file-tree-live-updates]] — `workspace-changed`.
- [[mcp-and-doc-sync]] — `documents-changed`.

## Зачем один хук

Подписка в Tauri асинхронная: `listen` возвращает промис функции отписки. Компонент может
размонтироваться раньше, чем промис выполнится, и тогда отписку надо вызвать в момент, когда она
придёт, иначе обработчик останется жить. Этот жизненный цикл был переписан вручную в шести местах
(`App`, `useWorkspaceEvents`, `useExternalDocSync`, `useNoteRelocation`, `useMcpNavigation`,
`UpdateSplash`) — копии, которые легко разойтись. Теперь он в одном месте.

Как устроено:

- обработчик хранится через `useStableCallback`, поэтому видит свежие props, а подписка не
  пересоздаётся на каждый рендер;
- переподписка — только при смене имени или флага `enabled`: например, `useExternalDocSync`
  слушает `documents-changed`, только пока у документа есть синхронизация с диском;
- синхронная ошибка при подписке (например, `getCurrentWindow()` вне окна Tauri, в тестах)
  превращается в обычный отказ с записью в журнал, а не роняет эффект.

## Исключения

- `useLinkIndex` подписывается сам: подготовку индекса он запускает только после того, как
  подписка на `links-changed` встала, чтобы не пропустить ревизию между подготовкой и подпиской.
  Общий хук такого порядка не даёт.
- `prefetchScheduler` — плагин CodeMirror, а не React-хук, и живёт по жизненному циклу вида.
