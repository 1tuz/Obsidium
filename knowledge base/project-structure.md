# Структура проекта Aquilum

## Статус: ✅ Фаза 1 — Базовый сетап завершён

## Расположение

```
D:\My programs\Aquilum\
├── knowledge base\        ← документация проекта
├── .artifacts\            ← ВСЕ сборки (gitignore); dev ≠ release
│   ├── cargo-dev\         ← только debug (tauri dev / cargo test)
│   ├── cargo-release\     ← только release (npm run release)
│   ├── dist\              ← production-фронт Vite
│   └── releases\          ← setup.exe + latest.json по версиям → GitHub Release
│
└── aquilum-app\           ← исходный код приложения
    ├── index.html
    ├── package.json
    ├── vite.config.ts     ← outDir → ../.artifacts/dist
    ├── scripts\build-release.ps1
    ├── src\
    └── src-tauri\
        ├── .cargo\config.toml  ← target-dir → ../../.artifacts/cargo-dev
        ├── Cargo.toml
        └── tauri.conf.json
```

Правила изоляции сборок: [[build-artifacts-separation]].
Релиз и автообновление: [[release-and-updates]].

## Установленные зависимости

### Фронтенд (npm)

| Пакет | Версия | Назначение |
|-------|--------|-----------|
| **react** | ^19.1.0 | UI фреймворк |
| **react-dom** | ^19.1.0 | React рендеринг |
| **yjs** | ^13.6.31 | CRDT — ядро синхронизации |
| **y-indexeddb** | ^9.0.12 | Офлайн-хранение Yjs документов |
| **@tiptap/react** | ^3.27.3 | Редактор — React-обёртка |
| **@tiptap/starter-kit** | ^3.27.3 | Базовый набор расширений |
| **@tiptap/extension-collaboration** | ^3.27.3 | Tiptap ↔ Yjs биндинг |
| **@tiptap/pm** | ^3.27.3 | ProseMirror ядро |
| + 20 расширений Tiptap | ^3.27.3 | Bold, italic, списки, ссылки и т.д. |

### Бэкенд (Rust / Cargo)

| Крейт | Версия | Назначение |
|-------|--------|-----------|
| **tauri** | 2 | Десктоп-оболочка |
| **tauri-plugin-opener** | 2 | Открытие ссылок/файлов |
| **serde** | 1 | Сериализация данных |
| **serde_json** | 1 | JSON парсинг |

### Dev-зависимости

| Пакет | Версия | Назначение |
|-------|--------|-----------|
| **@tauri-apps/cli** | ^2 | Tauri CLI |
| **typescript** | ~5.8.3 | TypeScript |
| **vite** | ^7.0.4 | Сборщик |
| **@vitejs/plugin-react** | ^4.6.0 | React плагин для Vite |

## Про установщик для пользователей

> **Tauri автоматически создаёт standalone `.exe` / `.msi` установщик.**
> Пользователю НЕ нужен Node.js, Rust или что-либо ещё.
> Всё компилируется в нативный бинарник (~5-10 MB vs ~150 MB у Electron).
>
> Команда для сборки установщика: `npm run tauri build`

## Следующие шаги

1. Создать дизайн-систему (CSS-токены, масштабирование)
2. Настроить структуру папок (`components/`, `modules/`, `hooks/`)
3. Интегрировать Yjs как State Manager
4. Написать парсер Markdown ↔ Yjs

## Техдолг

Список известных долгов со статусами — [[tech-debt]]. Туда попадает только то, что подтверждено
чтением кода и сознательно отложено.
