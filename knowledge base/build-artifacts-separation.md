# Разделение Dev и Release артефактов

## Статус: обязательно соблюдать

Dev и Release **изолированы**. Локальная разработка всегда в DEV. Финальные пакеты всех платформ
собираются GitHub Actions; `npm run release:local` оставлен как локальный Windows инструмент.

## Запомни две команды

| Задача | Команда | Результат |
|--------|---------|-----------|
| Разработка / тест в окне | `npm run tauri dev` | debug-приложение, HMR |
| Релизные пакеты | push / тег `v*` в GitHub | Actions artifacts / черновик Release |

`npm run release` запускает только локальную Windows-сборку; общий источник пакетов — GitHub Actions.

Рабочая папка: `aquilum-app/`.

Подробнее про заливку в GitHub: [[release-and-updates]]

## Команды: что можно / чего нельзя

### Можно

| Команда | Зачем |
|---------|--------|
| `npm run tauri dev` | полное приложение, DEV |
| `npm run dev` | только UI в браузере |
| `npm test` | тесты фронта |
| `cargo test` (из `src-tauri`) | тесты Rust → `cargo-dev` |

### Не использовать

| Команда | Почему |
|---------|--------|
| `npx tauri …` / голый `tauri` | обходит wrapper → риск смешать кэши |
| `npm run tauri build` (без `--`) | npm криво передаёт аргументы |
| `npm run tauri:build`, `npm run tauri -- build` | дубли, не для пользователя |
| GitHub Actions | проверяет push и собирает Windows, macOS arm64 и Ubuntu 24; тег `v*` создаёт черновик релиза |
| `cargo clean` из `src-tauri` | удаляет сам junction `target`, следующая сборка создаст настоящую папку в обход `.artifacts`; чистить кэш — удалить `.artifacts/cargo-dev` или `cargo-release` |

---

## Три категории артефактов

### 1. `cargo-dev/` — мастерская разработчика

Сюда пишет **только** ежедневная работа: `npm run tauri dev`, `cargo test`.

- Профиль Cargo: **debug**
- Фронт в памяти Vite
- Можно чистить без влияния на release

### 2. `cargo-release/` — кэш финальной сборки

Сюда пишет **только** `npm run release:local`.

- Профиль Cargo: **release**
- Кэш для быстрой пересборки
- **Не смешивать** с `cargo-dev`

### 3. `releases/<version>/` — витрина готового продукта

Результаты GitHub Actions → артефакты workflow или черновик релиза в `1tuz/Obsidium`.

```
Исходники (aquilum-app/)
        │
        ├─ npm run tauri dev ──► cargo-dev/     (debug)
        │
        └─ push / tag v* ───────────► GitHub Actions
                                      → пакеты Windows, macOS ARM64, Ubuntu 24
```

---

## Карта путей

Корень: `D:\My programs\Aquilum\.artifacts\` (gitignore).

| Путь | Роль | Кто пишет |
|------|------|-----------|
| `cargo-dev/` | кэш разработки (debug) | `npm run tauri dev` |
| `cargo-release/` | кэш финальной сборки (release) | `npm run release:local` |
| `dist/` | production-фронт | `npm run build` |
| `releases/<ver>/` | финальные файлы | `scripts/build-release.mjs` |

### После переноса или переименования папки проекта

Junction `src-tauri/target` и кэши cargo хранят абсолютные пути. После переименования
`Quantum` → `Aquilum` ссылка указывала в несуществующую папку, а build-скрипты Tauri в кэше
читали права плагинов по старому пути (`failed to read plugin permissions ... Quantum\.artifacts`).

- `cargo-junction.mjs` распознаёт битую ссылку через `lstat`, а не `existsSync`: `existsSync` идёт по
  ссылке, считает её отсутствующей, и создание новой падает с `EEXIST`.
- Кэши после переноса не лечатся — удалить `.artifacts/cargo-dev` и `.artifacts/cargo-release`
  целиком, следующая сборка пересоберёт всё с нуля.

## Флаги сборки в `Cargo.toml`

- **`[features] updater`.** Плагин автообновления подключается только в release-сборке
  (`--features updater`): в dev обновляться нечему и не с чего. Код обновлений компилируется в обеих
  сборках, а без флага подставляется заглушка, которая честно отвечает «недоступно»
  ([[release-and-updates]]).
- **`[profile.release]`.** `lto = "thin"` — заметно быстрее полного LTO при почти тех же размере и
  скорости бинарника. `codegen-units = 8` — параллельная кодогенерация, ускоряет сборку. `strip`
  убирает отладочные символы из установщика.

Комментарии в `Cargo.toml` были испорчены многократной перекодировкой и превратились в нечитаемый
текст; объяснения теперь живут здесь, а в файле только настройки.

## Связанные файлы

- [[release-and-updates]] — локальный релиз + updater
- [[cross-platform-build]] — на будущее (macOS/Linux)
- `aquilum-app/scripts/tauri.mjs` — единая точка входа для Tauri CLI
- `aquilum-app/scripts/lib/cargo-junction.mjs` — логика разделения dev/release
- `aquilum-app/scripts/build-release.mjs` — локальная сборка Windows
