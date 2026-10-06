# Aquilum Knowledge Base: Book Page & Editor Architecture

Статус: актуально на 2026-08-09.

Внутреннее устройство страницы-книги, frontmatter, обложек и связи с CodeMirror.

## 1. Ключевые файлы

- **UI:** `BookPage/BookPage.tsx`, `BookThumbnail.tsx`, `CoverImage.tsx`, `Editor/index.tsx`, `Editor/MetadataToggle.tsx`
- **Хуки:** `useEditorDoc.ts` (Y.Doc + диск), `useEditorBookPage.ts` (layout/обложки), `useEditorMetadata.ts` (сворачивание FM), `useEditorViewSetup.ts` (view state / камера)
- **Данные:** `modules/docs/frontmatter.ts`, `vaultAssets.ts`, `persistBookReaderMeta.ts`, `bookStarterTemplate` в `modules/templates/starter.ts`
- **CM:** `extensions/frontmatterBlock.ts`, `frontmatterUi.ts` — скрытие YAML; кнопка «Метаданные» **вне** редактора

## 2. Frontmatter: ключи и шаблон книги

Канонические ключи (legacy в скобках читаются через `resolveBookFields`):

| Ключ | Назначение |
| --- | --- |
| `cover: true` | баннер страницы |
| `type: book` | миниатюра книги |
| `Book_cover` (`cover_url`) | путь к миниатюре |
| `Page_cover` (`page_cover_url`) | путь к баннеру |
| `page_cover_position` | вертикальный фокус баннера |
| `Путь к файлу` (`book_file`) | ebook в vault |
| `reader_position`, `read_percent` | синхронизация читалки |
| `author`, `status`, `pages`, `tags`, `rating` | метаданные книги |
<!--q-table:{"merges":[],"cols":[241,240]}-->

Пути в FM — **относительно корня vault** (`Files/cover.jpg`), не абсолютные. URL для UI: `resolveVaultAssetUrl(workspacePath, …)` → `convertFileSrc`.

Frontmatter открытой заметки разбирается в памяти на каждое нажатие клавиши (`parseFrontmatter`), а поля **чужих** заметок берутся из поискового индекса, а не чтением их файлов — см. [[frontmatter-field-index]]. Смешивать эти две дороги нельзя: индекс всегда отстаёт от буфера редактора.

По этим же полям строятся выборки в блоке ```` ```dataview ```` — реестры прочитанного, книги без автора и прочее, что раньше собиралось руками: [[dataview-queries]].

Книга заводится из шаблона `Templates/Book.md`, который создаёт `bookStarterTemplate` (`modules/templates/starter.ts`): полный набор полей, `Page_cover: pattern:tunnel` и блок ссылок — см. [[note-templates]]. Отдельного пункта «Создать книгу» на пустой вкладке больше нет, вместе с ним удалён и `createUniqueBook` — две дороги к одному документу расходились в поведении, а шаблон правится пользователем.

Строгий блок: только `^---\n…\n---`. Сломанные fences → нет кнопки «Метаданные», layout книги **липкий** (последний валидный parse), чтобы обложки не мигали при правке YAML.

Заготовка для обычной заметки (`noteFrontmatterTemplate()`: `tags` / `author` / `source`) вставляется пунктом «Вставить метаданные» в контекстном меню тела — см. [[note-templates]]. Блок раскрывается сам: `frontmatterCollapseField` реагирует на появление frontmatter в документе, где его не было.

Enter в инпуте названия, когда заметка начинается таблицей, открывает пустую строку **над** таблицей вместо ухода за неё — см. [[editor-table-interaction]].

## 3. Сворачивание «Метаданные»

```text
React MetadataToggle (над CodeMirror)
  <-> localStorage aquilum_metadata_expanded
  <-> CM StateEffect setFrontmatterExpanded
       -> frontmatterBlock: collapsed = Decoration.replace(YAML)
                          expanded = стили key/value (accent после :)
```

- Надпись **не** виджет CodeMirror — каретка в неё не попадает.
- Сворачивается только по клику; правки `---` сами блок не закрывают.
- При создании редактора: сначала `syncOnCreate` (раскрыть FM), потом restore scroll — иначе камера съезжает.

Live preview не трогает диапазон FM (`stateFrontmatterRange`).

## 4. Сохранение документа

`.md` на диске — источник правды. Каждое изменение редактора пишется сразу (`useEditorDoc` / `DocumentFileWriter`). При открытии/фокусе — `applyDiskSnapshot`. IndexedDB — буфер Yjs, не побеждает диск.

## 5. Layout BookPage

- Баннер: `cover: true` + `Page_cover` или дефолт. В покое баннер — два узла; всё остальное монтируется по требованию, см. [[cover-scroll-jank]].
- Декорации редактора при прокрутке и контракт для новых расширений — [[editor-viewport-decorations]].
- Миниатюра: `type: book` + `Book_cover` или дефолт.
- Sticky layout в `useEditorBookPage`: пока FM временно битый, UI держит последний валидный `isBook` / `hasCover`.
- `CoverImage` — обычный `<img>`, без opacity-гейта.

### Миниатюра книги редактируется с клавиатуры

Миниатюра живёт отдельным компонентом `BookThumbnail.tsx`: у неё своё состояние наведения и фокуса,
и держать его в `BookPage` значило бы перерисовывать всю страницу-книгу на каждое движение мыши над
обложкой.

Обложка получила `tabIndex`, то есть ведёт себя как картинка в редакторе или как инпут:

| Жест | Что делает |
| --- | --- |
| клик | фокус-кольцо `--q-shadow-focus-ring` — тот же токен, что у картинок в редакторе и у инпутов |
| `Backspace` / `Delete` | `Book_cover` удаляется из frontmatter |
| `Ctrl + V` | картинка из буфера копируется в `Files` и становится обложкой |
| `Escape` | фокус снимается |
| наведение | прежняя кнопка «Заменить обложку книги» с диалогом выбора файла |

Кольцо рисуется через `box-shadow` поверх собственной тени миниатюры
(`var(--q-shadow-focus-ring), var(--q-book-thumb-shadow)`), а не через `outline`: у обёртки
`overflow: hidden` и скруглённые углы, и `outline` шёл бы прямоугольником мимо радиуса.

Две вещи, которые стоит помнить.

**Слушатель вставки висит на документе, а не на обёртке, и только пока обложка в фокусе.** Событие
`paste` доставляется фокусированному узлу, но для не-редактируемого элемента браузеры расходятся в
том, кому именно; документ — надёжная точка. Конфликта с редактором нет: пока фокус на обложке,
CodeMirror его не имеет, и его собственный обработчик вставки (`extensions/image/paste.ts`) молчит.
Вставка чего-то, кроме картинки, не перехватывается вовсе.

**Импорт в vault — общий механизм.** `importCoverBytes` в `modules/docs/covers.ts` лежит рядом с
`importCoverFile` и `pickAndImportCover` и уходит в тот же `importIntoFiles`, что и вставка картинки
в текст, обложка страницы и файл книги. Блокировка `coverUploadLock` и флаг `coverUploading` тоже
общие: `runCoverImport` в `useEditorBookPage` — единственное место, где они выставляются, поэтому
диалог выбора файла и вставка из буфера не могут пойти одновременно.

`Ctrl + V` на миниатюре слушается на `document`, а не на самом узле, и только пока обложка в фокусе. Событие `paste` браузер отдаёт фокусированному элементу, но обложка — не инпут, а `div` с `tabIndex`, и для не-редактируемого узла движки расходятся в том, кому доставить вставку: обработчик на элементе срабатывал бы не везде. Подписка на документ, ограниченная временем фокуса, ловит вставку надёжно и не отнимает её у редактора, как только фокус ушёл.

## 6. View state (курсор / камера)

Единый слой — см. [[tab-switching]]. Scrollport: у книги `.q-book-page`, иначе `.q-editor-container` (`resolveEditorScrollElement`).

## 7. Читалка и виджеты

- [[book-reader]]
- [[editor-book-callout]]
- [[book-reader-sync]] — `persistBookReaderMeta` (`pages`, `reader_position`, `read_percent`)
