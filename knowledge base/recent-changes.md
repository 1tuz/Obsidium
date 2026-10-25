# Лента последних изменений

Панель под тепловой картой в блоке `insights`: двадцать последних изменённых заметок рабочей
области, новые сверху, каждая строка — заголовок, папка относительно корня и момент правки.
Клик по строке открывает заметку. Источник тот же, что у карты активности — таблица `documents`,
никаких новых таблиц, индексов и миграций.

## Связанные документы

- [[activity-heatmap]] — та же выборка `documents`, но агрегированная по дням; карта и лента
  стоят рядом в одной панели.
- [[search-indexing-workspaces-part-1]] — `documents.sqlite3` и то, кто и когда обновляет
  `modified_ns`.
- [[document-lifecycle]] — когда правка попадает в метаданные: сохранение, наблюдатель за
  файлами, переиндексация.
- [[design-tokens]] — почему отступы и цвет разделителя — токены, а не литералы.

## Что считается изменением

Одно событие — одна заметка. Метка времени — `modified_ns` строки `documents`; это время
последней правки, а не время последнего чтения индекса. Заметка с `modified_ns <= 0` в ленту не
попадает: нулевая метка означает «время неизвестно», и такая строка заняла бы место в лимите,
ничего не сообщив.

Дубли путей невозможны по построению: `path` — первичный ключ таблицы, поэтому одна заметка —
одна строка, даже если её правили десять раз за минуту. Лента показывает состояние, а не историю;
история правок живёт в [[note-history]] и в git, а не здесь.

## Лимит

```rust
pub const DEFAULT_RECENT_CHANGES_LIMIT: usize = 20;
pub const MAX_RECENT_CHANGES_LIMIT: usize = 50;
```

`recent_changes(timestamps, limit)` зажимает запрошенный лимит в `1..=50`: ноль и отрицательные
значения не должны превращать панель в пустоту из-за опечатки в вызове, а больше пятидесяти
строк в узкой панели `insights` всё равно не читаются. Фронтенд по умолчанию просит
`RECENT_CHANGES_LIMIT = 20` и может передать свой лимит пропом `limit`.

Сортировка — по `modified_ns` убыванию, при равных метках — по пути, чтобы порядок был
устойчивым и тесты не зависели от порядка обхода SQLite.

## IPC

```rust
#[tauri::command]
pub async fn get_recent_changes(
    core: State<'_, Arc<Core>>,
    workspace_path: String,
    limit: Option<usize>,
) -> Result<Vec<ActivityNote>, SearchError>
```

`SearchService::recent_changes` читает те же `path`, `created_ns`, `modified_ns` через
`with_metadata` (`SELECT path, created_ns, modified_ns FROM documents ORDER BY path`), а затем
сортирует и обрезает в памяти. Отдельный `ORDER BY modified_ns DESC LIMIT ?` не нужен: таблица
читается целиком и для карты активности, а индекс по `modified_ns` стоил бы записи при каждой
переиндексации — та же логика, что в [[activity-heatmap]].

Ответ — `Vec<ActivityNote>`:

```rust
pub struct ActivityNote {
    pub path: String,
    pub timestamp_ns: i64,
}
```

`timestamp_ns` — та метка, по которой заметка попала в выборку: `modified_ns` для ленты,
`created_ns` или `modified_ns` для заметок дня. Панель не пересчитывает её и не угадывает меру.

## Заметки дня

Та же структура и та же команда-родственник `get_note_day_notes` обслуживают список заметок дня
из [[activity-heatmap]]. Ядро получает `day` в виде `2026-09-25`, `measure` (`created` /
`modified`) и `tz_offset_minutes`, считает границы суток через `note_date::civil_date` +
`note_date::from_civil` — тот же разбор дат, что у Dataview, — и фильтрует выборку в памяти.
Список дня сортируется по возрастанию метки: это хроника дня, а не лента.

`day_bounds` отвергает нечитаемую дату (`2026-02-30`, мусор) ошибкой `SearchError::Query`, а не
молчаливым пустым списком: пустой день и опечатка в дате должны выглядеть по-разному.

## Фронтенд

- `src/modules/stats/gateway.ts` — `loadRecentChanges(workspacePath, limit)` и
  `loadDayNotes(workspacePath, day, measure)`; часовой пояс считается на месте
  (`-new Date().getTimezoneOffset()`), как в `documentGateway`.
- `src/modules/stats/activity.ts` — `dayIsoDate` (номер дня → `YYYY-MM-DD`), `formatClock`
  и `formatNoteMoment`: подписи строятся из существующих `Intl`-форматтеров модуля, а не из
  ручной склейки строк.
- `src/components/Stats/RecentChangesPanel.tsx` — загрузка при смене `workspacePath` и `limit`,
  отмена устаревшего ответа флагом `active`, состояния `loading` / `ready` / `failed` и
  перечитывание по событию `links-changed` (`useTauriEvent`, тот же канал, что у
  `useLinkIndex`): индекс сообщает новую ревизию — лента обновляется, событие чужой рабочей
  области игнорируется `samePath`.
- `src/components/Stats/ActivityNoteRow.tsx` — общая строка для ленты и для списка дня:
  заголовок (`fileStem`), папка (`relativePath` + `parentDirectory`, для пути вне рабочей
  области — просто родительская папка), деталь (момент или время) и `onOpenNote`.
- `src/components/Stats/ActivityHeatmap.tsx` — рендерит ленту под сеткой, поэтому в `insights`
  обе панели монтируются одним узлом `activity`.

Тексты — только из `stats.activity.*` (`recentTitle`, `recentLoading`, `recentFailed`,
`recentEmpty`, `dayNotes*`, `openNote`, `back`), плюрализация — через `plural`.

## Почему не отдельная таблица

Лента отвечает на вопрос «что я трогал последним», а это ровно `modified_ns` из `documents`.
Своя таблица истории правок дала бы хронологию всех правок, но потребовала бы миграции,
согласования с наблюдателем за файлами и чистки при удалении заметок — цена не оправдана
задачей. Если понадобится именно история, её место — сервис истории, а не метаданные поиска.

## Проверки

```bash
cd obsidium-app && rtk npx vitest run src/components/Stats src/modules/stats
cd obsidium-app && rtk npx tsc --noEmit
cd obsidium-app/src-tauri && rtk cargo test --locked -p obsidium-core activity
```

Тесты ядра: заметки дня в обеих мерах, пустой день, отказ на нечитаемой дате, границы суток,
лента без дублей и с зажатым лимитом. Тесты фронтенда: загрузка с дефолтным и явным лимитом,
порядок строк, открытие заметки, пустая и сломанная лента, список дня с возвратом к календарю.
