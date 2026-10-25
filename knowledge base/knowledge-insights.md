# Аналитика базы: отчёт о связях, изоляции, устаревании и тегах

Панель `insights` в левой боковой панели: четыре секции со счётчиками, каждая запись открывает
заметку. Отчёт строится при открытии панели и по кнопке «Построить отчёт заново». Ничего не
пишется, фоновых задач нет.

## Данные: второго индекса нет

Все вопросы отчёта («куда ведёт ссылка», «есть ли у заметки связи», «когда её правили», «какие
теги встречаются один раз») уже закрыты метаданными поискового индекса `documents.sqlite3`:

| Что нужно | Откуда берётся |
| --- | --- |
| существует ли заметка | `wiki_documents(path, relative_key, title_key)` |
| ссылки заметки | `wiki_links(source_path, target_key, target_kind, byte_offset)` |
| дата правки | `documents.modified_ns` |
| теги заметки | `note_fields(path, key_lower, text, items)` |

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

### Теги, встречающиеся один раз

Секция `unusedTags` (в интерфейсе — «Теги в одной заметке»). «Неиспользуемый» тег здесь — тег,
который встречается не более чем в одной заметке. Ноль заметок — ненаблюдаемое значение:
реестра тегов в приложении нет, теги существуют только как значения полей заметок, поэтому
«тег без заметок» неотличим от несуществующего тега и в ответе не встречается. Единственное
проверяемое определение — «ровно одна заметка»; тег, встречающийся в двух и более заметках, в
отчёт не попадает.

Теги агрегируются из таблицы `note_fields` — тех же строк, что читает `paths_with_tag`: ключи
`tags` и `tag` без учёта регистра, значения из `items` для списочной формы (frontmatter
`tags: [a, b]`, блочный список и inline `tags:: [a, b]`) и из `text` для скалярной (`tags:: a`).
Это тот же разбор, который делает поисковый индекс (`fields::indexed_fields` → `note_fields`),
поэтому не нужны ни новая таблица, ни новый индекс, ни чтение файлов с диска, ни обход
Tantivy-поля `tags`. Регистр приводится к нижнему, ведущий `#` отбрасывается, пустые значения
пропускаются; вложенные теги (`a/b`) остаются как записаны и не сворачиваются в родительский
`a`. Один и тот же тег, повторённый в заметке дважды, считается один раз.

Поля записи: `tag`, `noteCount`, `paths` (отсортированы). Секция отсортирована по возрастанию
`noteCount`, затем по имени тега; по определению `noteCount <= 1`, поэтому порядок фактически
алфавитный, а сортировка по счётчику остаётся на случай расширения определения (например, если
появится реестр и теги с нулём заметок). Список ограничен `MAX_UNUSED_TAGS = 100` записями:
`total` — сколько тегов подошло под определение до обрезки, `truncated` — были ли записи
отброшены. Панель при `truncated` пишет «Показаны только первые 100 тегов».

## Путь вызова

```
KnowledgeReportPanel (src/components/Analysis/KnowledgeReportPanel.tsx)
  → useKnowledgeReport (src/modules/analysis/useKnowledgeReport.ts)
    → invoke('get_knowledge_report', { workspacePath, staleAfterDays })
      → src-tauri/src/search/analysis/commands.rs::get_knowledge_report
        → SearchService::knowledge_report (core/src/search/analysis/service.rs)
          → analysis::report::build (core/src/search/analysis/report.rs)
            → with_metadata: wiki_documents + wiki_links + documents + note_fields
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
| `unusedTags` | `UnusedTagSection` | `tags[]` (`tag`, `noteCount`, `paths`), `total`, `truncated` |
| `staleAfterDays` | `number` | фактически применённое окно после клампа |
| `indexedDocuments` | `number` | сколько заметок в индексе |
| `indexing` | `bool` | индекс ещё обновляется |

## Клиент

`src/modules/analysis/report.ts` — чистые функции без IPC: `reportSections` (порядок секций,
счётчики, сортировка строк; у `unusedTags` счётчик — это `total` до обрезки, а не число
показанных строк), `sortRows` (битые ссылки, изолированные и теги — по названию, затем по пути;
устаревшие — по убыванию возраста, затем по названию), `filterRows`/`filterSection` (фильтр по
названию, детали и пути, регистронезависимо; счётчик секции при фильтрации не меняется — он про
базу, а не про выдачу), `unusedTagRow` (строка тега: `#тег` и путь единственной заметки),
`reportTotal`, `clampStaleDays`, `emptyReport`. Сортировка повторена на клиенте сознательно:
панель не зависит от порядка ответа и одинаково ведёт себя, если команду начнут вызывать из
другого места.

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
- Теги считаются по значениям полей `tags`/`tag` в `note_fields`, а не по реестру: реестра нет.
  «Неиспользуемый» означает «в одной заметке»; тег без заметок вычислить не из чего, поэтому
  `noteCount = 0` не встречается, а список тегов ограничен 100 записями с флагом `truncated`.

## Проверки

```bash
cd obsidium-app && npx vitest run src/components/Analysis src/modules/analysis
cd obsidium-app && npx tsc --noEmit
cd obsidium-app/core && cargo test --offline analysis::report 2>&1 | tail -10
```

## Файлы

- `core/src/search/analysis/report.rs` — `build`, `unused_tag_section`, `stale_after_days`,
  `now_ns`, девять юнит-тестов.
- `core/src/search/analysis/service.rs` — `SearchService::knowledge_report`.
- `src-tauri/src/search/analysis/commands.rs` — команда `get_knowledge_report`.
- `src/modules/analysis/report.ts` + `report.test.ts` — секции, теги, фильтр, счётчики, кламп окна.
- `src/modules/analysis/useKnowledgeReport.ts` — загрузка и явное обновление.
- `src/components/Analysis/KnowledgeReportPanel.tsx` (+ `.css`, `.test.tsx`).
- `src/components/Analysis/InsightsPanel.tsx` (+ `.css`, `.test.tsx`).
