# Bases Boards Implementation Plan

> **For agentic workers:** Inline execution in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose existing Kanban `.base` views in the UI and support safe board creation and note membership actions.

**Architecture:** Add a lazy vault index and Boards panel around the current `BaseView`. Persist the selected `.base` view in the existing `ui-state.sqlite3` service and generate ordinary `.base` YAML through current file abstractions.

**Tech Stack:** React, TypeScript, Vitest, Tauri commands, Rust, SQLite, existing Bases parser and file gateway.

**Spec:** `docs/superpowers/specs/2026-10-08-bases-boards-design.md`

## Global Constraints

- No CLI, MCP, Canvas, Extension API, workers, separate Kanban database, heavy DnD dependency, or unrelated stage work.
- Scan and parse `.base` files only on demand; use theme tokens and existing file, command, and UI-state abstractions.
- Preserve unknown `.base` data and unrelated frontmatter; use hash-checked writes.
- Keep native Kanban drag-and-drop and update the relevant `knowledge base/` document.

---

### Task 1: Board discovery and safe Base generation

**Files:**
- Modify: `aquilum-app/src/modules/bases/types.ts`, `index.ts`
- Create: `aquilum-app/src/modules/bases/boards.ts`, `boards.test.ts`
- Modify: `aquilum-app/src/modules/documents/fileGateway.ts` only if the testable scan requires an existing gateway export.

**Interfaces:**
- `scanBoards(root, readDirectory, readSnapshot)` returns path-sorted entries `{ path, name, views: { index, name }[] }` for `.base` files containing Kanban views.
- `createKanbanBase(input)` returns standard YAML plus exact filter and group configuration.
- `boardMembership(definition, viewIndex)` returns a safe property/tag membership descriptor or a reason automatic membership cannot be inferred.

- [ ] Write failing tests for multi-file discovery and multiple Kanban views.
- [ ] Run those tests and confirm they fail because the API is missing.
- [ ] Implement recursion, Kanban-only filtering, deterministic nested paths, and standard Base generation.
- [ ] Add red/green tests for simple property/tag membership, custom filter rejection, and unknown fields.
- [ ] Run the module tests and confirm all pass.

### Task 2: Persist last Base view in the existing UI-state database

**Files:**
- Modify: `aquilum-app/core/src/ui_state/migrations/{mod.rs,schema.rs}`; create next migration file.
- Modify: `aquilum-app/core/src/ui_state/{models.rs,service.rs}`; add focused persistence tests.
- Modify: `aquilum-app/src-tauri/src/ui_state/commands.rs` and registered command list.
- Modify: `aquilum-app/src/modules/ui-state/{gateway.ts,types.ts}`.

**Interfaces:**
- Load/save Base view state by `{ workspaceId, baseFile }`, with the persisted value being a nonnegative view index.

- [ ] Write migration and round-trip tests for independent Bases in one workspace and cascade deletion with workspace state.
- [ ] Run the targeted Rust tests and confirm they fail because the migration and service are missing.
- [ ] Implement one schema migration and command pair using the existing SQLite database.
- [ ] Implement frontend gateway types and verify TypeScript compilation.
- [ ] Run the targeted Rust tests and confirm they pass.

### Task 3: Direct view opening, Boards panel, commands, and note actions

**Files:**
- Modify: `aquilum-app/src/App.tsx`, `aquilum-app/src/components/Layout/SidebarRail.tsx`, `SidebarRail.css`, `Sidebar.tsx`.
- Create: `aquilum-app/src/components/Layout/BoardsPanel.tsx`, its stylesheet if needed, and tests.
- Modify: `aquilum-app/src/components/Bases/BaseView.tsx` and tests.
- Modify: existing file action menu and its action tests.
- Modify: existing i18n locale files for labels and explanations.

**Interfaces:**
- `BaseView` accepts an optional requested view index and reports active view changes.
- Register `boards.open`, `boards.new`, and `boards.addCurrentNote` in `CommandRegistry`.
- Boards panel receives workspace path, active Markdown path, and callbacks for opening a path at a view or creating a board.

- [ ] Add failing component tests for exact view selection, remembering ordinary opens, lazy loading, and tree refresh after create/delete/edit events.
- [ ] Add failing action tests proving membership writes only the target property/tag and rejects ambiguous filters without changing metadata.
- [ ] Implement rail selection and Boards tree in the current sidebar, using tokens and existing icon/button patterns.
- [ ] Implement the new-board wizard and create `.base` with the existing atomic file command.
- [ ] Implement exact board opening and UI-state save/load in `BaseView` without changing drag-and-drop.
- [ ] Add context-menu Add/Remove actions and command handlers; surface a reason when membership is not safely editable.
- [ ] Run targeted frontend tests and confirm they pass.

### Task 4: Documentation and release verification

**Files:**
- Modify: `knowledge base/bases-kanban.md`.
- Modify: `aquilum-app/package.json` and `aquilum-app/src-tauri/tauri.conf.json` only for the next release version.

- [ ] Document lazy discovery, last-view persistence, membership boundaries, and existing drag/drop behavior.
- [ ] Run `npx tsc --noEmit`, `npm test`, `npm run check:colors`, and `npm run build` from `aquilum-app/`.
- [ ] Run Rust formatting and `cargo test --workspace` from `aquilum-app/src-tauri/` if Rust was changed.
- [ ] Review the complete diff and ensure the two untracked input patch files remain unstaged.
- [ ] Determine the next unused version/tag from repository metadata, bump both version sources, and validate release inputs.
- [ ] Commit and push the implementation to the public fork, trigger the all-platform release workflow with the matching `v*` tag, then confirm the workflow succeeds and the release is public with expected assets.
