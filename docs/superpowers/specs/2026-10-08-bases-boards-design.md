# Bases Boards Design

## Goal

Make compatible `.base` Kanban views discoverable and actionable from the application UI without replacing the existing Bases renderer or adding a Kanban-specific data store.

## Architecture

The left rail selects either the existing file tree or a Boards panel inside the existing sidebar. The Boards index recursively reads the current vault only after the panel is opened, parses `.base` files through the existing Bases parser, and exposes only Kanban views in a path-shaped tree. Its in-memory cache is invalidated by existing `workspace-changed` events; when the panel was closed during a change, opening it triggers a rescan.

Board selection opens the `.base` through the existing tab/navigation flow and passes the selected view index into `BaseView`. `BaseView` loads the last view for ordinary opens and saves selections through the existing `ui-state.sqlite3` service, keyed by workspace and `.base` relative path. This extends the existing UI-state database and does not create another store.

Creating a board writes a standard `.base` YAML definition through existing file-gateway abstractions. The wizard supports folder, tag, property, whole-vault, and custom filters, with a writable grouping property defaulting to `status` and configurable initial groups. Existing native Kanban drag-and-drop remains unchanged.

Markdown file actions list Kanban views. Automatic membership changes are limited to an unambiguous single property-equality or tag predicate. Other predicates must already match before a note is changed. Folder, whole-vault, compound, negated, unsupported, or conflicting membership conditions produce an explanation without writing. Frontmatter changes use the existing narrow field editor and hash-checked atomic file writer; removal deletes only the exact membership property value or tag attributable to that board.

## Boundaries

- No CLI, MCP, Canvas, Extension API, dependency, worker, or separate database changes.
- The scan and parse work is lazy; while Boards is inactive there is no vault scan or Base parsing.
- `.base` content remains the user-facing source of truth. Unknown definitions are preserved when existing files are read.
- File writes preserve concurrent edits by using snapshot hashes.

## Corner cases

- Multiple Kanban views in one `.base` are distinct selectable entries and use the view index, not only the display name.
- A changed or deleted `.base` invalidates the affected cached entry; a rename or directory change refreshes the affected tree branch.
- Complex filters and already-conflicting membership or group values never cause arbitrary frontmatter removal or replacement.
- Existing empty columns and current drag-and-drop semantics remain owned by `BaseView` and `groupOrder`.

## Verification

Frontend tests cover discovery across files and folders, multiple views, direct view selection, persistence, membership safety, and index invalidation after create/delete/edit. Run frontend typecheck, all frontend tests, color checks, and production frontend build. Rust changes to the existing UI-state database receive migration and persistence tests plus the Rust workspace tests and format check. A versioned GitHub Actions release run is the packaging proof; publication is complete only after the release is public and its required assets are present.
