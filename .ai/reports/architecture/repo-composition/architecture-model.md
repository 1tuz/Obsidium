# Модель диаграммы состава Obsidium

## Scope

Runtime-состав desktop-приложения и доступные без UI точки входа. Основной вид: компонентная архитектура слева направо, одна схема.

## Компоненты

| ID | Компонент | Evidence |
|---|---|---|
| ui | UI: TypeScript/Preact, компоненты и feature modules | `aquilum-app/src/main.tsx`, `src/App.tsx` |
| tauri | Tauri host: окно, plugins, IPC commands, event bridge | `aquilum-app/src-tauri/src/lib.rs` |
| cli | Headless CLI | `aquilum-app/cli/src/main.rs` |
| core | `aquilum-core`: composition root и доменные сервисы | `aquilum-app/core/src/lib.rs`, `core/src/app_core.rs` |
| docfiles | Documents + files: Yrs sessions, disk IO, watcher, history | `core/src/documents/`, `core/src/files/`, `core/src/history/` |
| search | Search, index workers, backlinks, Dataview, graph | `core/src/search/` |
| state | Settings + UI state | `core/src/settings/`, `core/src/ui_state/` |
| mcp | MCP stdio and loopback HTTP | `core/src/mcp/`, `src-tauri/src/lib.rs`, `cli/src/main.rs` |
| vault | Markdown workspace files and `.aquilum/history` | `core/src/files/document.rs`, `core/src/files/gate.rs`, `core/src/history/store.rs` |
| appdata | Settings, SQLite stores, CRDT store, Tantivy index | `core/src/app_core.rs`, `core/src/settings/manager.rs`, `core/src/search/service.rs` |
| web | Configured HTTP integrations: Wikixiv, link titles, web agent | `core/src/wikixiv/`, `core/src/link_title/`, `core/src/web_agent.rs` |

## Edges

| From → To | Kind | Evidence / semantics |
|---|---|---|
| UI → Tauri host | IPC command | `invoke_handler!` registration in `src-tauri/src/lib.rs`; UI uses `invoke` in modules/gateways |
| Tauri host → UI | Event | host `EventSink` calls `handle.emit`; frontend has event subscriptions |
| Tauri host → Core | Function call | `Core::open`, `Core` managed in Tauri state; commands access Core |
| CLI → Core | Shared library call | CLI imports `aquilum_core`, opens headless core |
| Core → Documents/files | Composition / calls | Core owns `DocumentHub` and `WorkspaceWatcher`; watch batches reconcile paths |
| Core → Search | Composition / calls | Core owns `SearchService`; watcher ingestion triggers index worker updates |
| Core → State | Composition / calls | Core owns `SettingsManager`, `UiStateService` |
| Core → MCP | Composition / local service | Core owns `McpServer`; settings control start/stop |
| Documents/files/history → Vault | Filesystem read/write/watch | File gate operates on workspace paths; history path is `.aquilum/history` |
| Documents/files → App data | SQLite | `DocumentStore` is opened with the app-data path |
| State → App data | JSON and SQLite | settings JSON and UI-state SQLite path |
| Search → App data | Tantivy + SQLite metadata | `search-v2/<workspace-key>/index-vN`, metadata `documents.sqlite3` |
| Core features → Web | HTTP request | Wikixiv API, link-title fetcher, and web agent use ureq |
| MCP clients ↔ MCP | stdio / loopback HTTP | stdio entrypoints and loopback server implementation |

## Confirmed vs inferred

- All listed repository components and primary runtime edges are confirmed from source references.
- External web services are grouped because destinations can be configured or derived from user content.
- “App data” is a logical boundary with multiple files and stores, not one database.
