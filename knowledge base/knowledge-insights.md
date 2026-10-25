# Аналитика базы: отчёт о связях, изоляции и устаревании

Панель `insights` в левой боковой панели: три секции со счётчиками, каждая запись открывает
заметку. Отчёт строится при открытии панели и по кнопке «Построить отчёт заново». Ничего не
пишется, фоновых задач нет.

## Данные: второго индекса нет

Все четыре вопроса («куда ведёт ссылка», «есть ли у заметки связи», «когда её правили») уже
закрыты метаданными поискового индекса `documents.sqlite3`:

| Что нужно | Откуда берётся |
| --- | --- |
| существует ли заметка | `wiki_documents(path, relative_key, title_key)` |
| ссылки заметки | `wiki_links(source_path, target_key, target_kind, byte_offset)` |
| дата правки | `documents.modified_ns` |

Разрешение ссылки — та же функция, что у графа и обратных ссылок:
`wiki::for_each_typed_link`-семейство, точнее `wiki::target::pick_candidate` поверх ключей из
`wiki_links`. Поэтому «битая ссылка» в отчёте — ровно то же, что «битая ссылка» в MCP-инструменте
`review_knowledge` и в графе: если ссылка разрешилась там, она разрешится и здесь.

Файлы на диске не перечитываются целиком: текст заметки читается только для тех источников, у
которых есть неразрешённая ссылка, — чтобы показать строку и исходный текст цели `[[…]]`.

## Что считает каждая секция

### Битые ссылки

Строка `wiki_links`, для которой `pick_candidate` не нашёл ни одной заметки. Поля записи:
`sourcePath` (заметка-источник), `sourceTitle` (имя файла без расширения), `target` (текст
ссылки, как он написан), `line` (номер строки по байтовому смещению из `wiki_links.byte_offset`).
Ссылка заметки на саму себя не делает заметку связанной, но и битой не считается.

### Изолированные заметки

Заметки, у которых нет ни одной **разрешённой** связи ни в одну, ни в другую сторону. Считается
по уже разрешённым рёбрам: источники и цели, попавшие в отчёт как битые, связью не являются.
Заметка, ссылающаяся только на несуществующие цели, остаётся изолированной — это ожидаемо и
видно сразу в двух секциях.

### Давно не изменялись

`now - documents.modified_ns > N дней`, где `N` — поле «Устаревание, дней» в шапке панели,
по умолчанию 90. Значение ограничено диапазоном `1…3650`; пустое или нечисловое поле
возвращается к 90. Заметки без известной даты (`modified_ns <= 0`) в отчёт не попадают: врать
про «не изменялась 19 000 дней» хуже, чем промолчать. Секция отсортирована по убыванию возраста.

### Неиспользуемые теги — секции нет

Сознательно не сделано. Чтобы найти тег «без заметок», нужен список всех тегов, а его в индексе
нет: теги лежат только значениями поля `tags` в `note_fields` (и в Tantivy-поле `tags`), то есть
список тегов получается лишь обходом всех заметок. Такой обход даёт не «теги без заметок», а
«теги, которых нет ни в одной заметке», — пустое множество по построению. Осмысленная версия
секции — «теги, встречающиеся один раз» или «теги, не использованные ни в одной выборке», — это
другое требование и другая семантика. Пока её не сформулировали, секция не добавлена, чтобы не
показывать пользователю заведомо пустой список. Если появится реестр тегов (отдельная таблица),
секция добавляется одной функцией в `report.rs` и одной секцией в панели.

## Путь вызова

```
KnowledgeReportPanel (src/components/Analysis/KnowledgeReportPanel.tsx)
  → useKnowledgeReport (src/modules/analysis/useKnowledgeReport.ts)
    → invoke('get_knowledge_report', { workspacePath, staleAfterDays })
      → src-tauri/src/search/analysis/commands.rs::get_knowledge_report
        → SearchService::knowledge_report (core/src/search/analysis/service.rs)
          → analysis::report::build (core/src/search/analysis/report.rs)
            → with_metadata: wiki_documents + wiki_links + documents
```

`with_metadata` — тот же путь, что у `get_backlinks` и `get_outgoing_links`: он открывает уже
существующий индекс рабочей области и не создаёт нового. Если индекса ещё нет, `with_metadata`
его подготовит (как любая другая читающая команда), а `indexing: true` в ответе сообщает панели,
что счётчики могут быть неполными.

Команда MCP `review_knowledge` из UI не вызывается: это инструмент для агентов, у него своя
пагинация и шесть проверок, три из которых панели не нужны. Общий у них только слой данных.

## IPC-контракт

```rust
#[tauri::command]
pub async fn get_knowledge_report(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    stale_after_days: Option<u64>,
) -> Result<KnowledgeReport, SearchError>
```

`KnowledgeReport` (`serde(rename_all = "camelCase")`):

| Поле | Тип | Смысл |
| --- | --- | --- |
| `brokenLinks` | `BrokenLink[]` | источник, цель, строка |
| `isolatedNotes` | `ReportNote[]` | `path`, `title` |
| `staleNotes` | `StaleNote[]` | `path`, `title`, `modifiedNs`, `days` |
| `staleAfterDays` | `number` | фактически применённое окно после клампа |
| `indexedDocuments` | `number` | сколько заметок в индексе |
| `indexing` | `bool` | индекс ещё обновляется |

## Клиент

`src/modules/analysis/report.ts` — чистые функции без IPC: `reportSections` (порядок секций,
счётчики, сортировка строк), `sortRows` (битые ссылки и изолированные — по названию, затем по
пути; устаревшие — по убыванию возраста, затем по названию), `filterRows`/`filterSection`
(фильтр по названию, детали и пути, регистронезависимо; счётчик секции при фильтрации не
меняется — он про базу, а не про выдачу), `reportTotal`, `clampStaleDays`, `emptyReport`.
Сортировка повторена на клиенте сознательно: панель не зависит от порядка ответа и одинаково
ведёт себя, если команду начнут вызывать из другого места.

`useKnowledgeReport(workspacePath, staleAfterDays, enabled)` грузит отчёт при открытии панели и
при каждом изменении окна устаревания; `enabled` — панель видима. `reload()` — явное обновление.

## Панель и слот для тепловой карты

`InsightsPanel` (`src/components/Analysis/InsightsPanel.tsx`) — хост панели `insights`. В нём есть
единственный слот `activity` (проп `activity?: ReactNode`, рендер — строка 24 того же файла):
сюда монтируется тепловая карта активности из `src/components/Stats/ActivityHeatmap.tsx`.
Добавление — один проп в `Sidebar.tsx`:

```tsx
<InsightsPanel
  active={isOpen && panel === 'insights'}
  workspacePath={workspacePath}
  onOpenNote={onFileSelect}
  activity={<ActivityHeatmap workspacePath={workspacePath} />}
/>
```

Регистрация панели: `App.tsx` (`sidebarPanel: 'files' | 'boards' | 'insights'`, `toggleInsights`),
`SidebarRail.tsx` (кнопка с `rail.insights`), `Sidebar.tsx` (ветка `panel === 'insights'`).

## Ограничения

- Только чтение: панель ничего не исправляет, не переименовывает и не удаляет.
- Полнота равна полноте индекса. Пока идёт индексация, показывается предупреждение; после
  обновления индекса отчёт нужно перестроить кнопкой.
- Разрешение ссылок — по ключам индекса (`title_key`/`relative_key`), без учёта регистра;
  неоднозначные имена разрешаются тем же правилом ближайшего соседа, что и в графе.
- Неиспользуемые теги не показываются — причина выше.

## Проверки

```bash
cd obsidium-app && npx vitest run src/components/Analysis src/modules/analysis
cd obsidium-app && npx tsc --noEmit
cd obsidium-app/core && cargo test --offline analysis::report 2>&1 | tail -10
```

## Файлы

- `core/src/search/analysis/report.rs` — `build`, `stale_after_days`, `now_ns`, пять юнит-тестов.
- `core/src/search/analysis/service.rs` — `SearchService::knowledge_report`.
- `src-tauri/src/search/analysis/commands.rs` — команда `get_knowledge_report`.
- `src/modules/analysis/report.ts` + `report.test.ts` — секции, фильтр, счётчики, кламп окна.
- `src/modules/analysis/useKnowledgeReport.ts` — загрузка и явное обновление.
- `src/components/Analysis/KnowledgeReportPanel.tsx` (+ `.css`, `.test.tsx`).
- `src/components/Analysis/InsightsPanel.tsx` (+ `.css`, `.test.tsx`).
