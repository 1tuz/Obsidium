# JSON Canvas

Obsidium opens `.canvas` files in the Canvas board view. The file remains JSON Canvas: standard `nodes` and `edges` are read and written in place, and unknown root, node, edge, and extension fields survive edits. Obsidium-specific board preferences live under `obsidium.canvas` so the board can store its paper palette, grid, and camera without changing the JSON Canvas fields.

Canvas edits use the workspace file gateway's snapshot hash as a write precondition. A concurrent external write stops autosave and keeps the local document in memory; the user can download that local JSON before choosing to reload the external version. Window close waits for every open board's pending write and is cancelled when a board cannot save. Invalid JSON is never auto-rewritten. File cards keep workspace-relative paths, render Markdown through the shared renderer, and refresh when the workspace index revision changes.

Opening a board establishes a serialized in-memory baseline and does not write the file. This keeps the original JSON bytes and formatting when the user only opens and closes a board; the next actual edit writes the parsed document through the serializer.

Paper palettes reuse the reading-style roles from `styles/themes/reading.css`; the global app theme remains responsible for light and dark mode. Canvas rendering mounts only objects intersecting the camera viewport, and retains off-screen nodes in the JSON model.

The app creates empty boards through the command palette or the Canvas rail button and uses 16-character hexadecimal IDs for new nodes and edges. The Canvas toolbar searches indexed Markdown notes and adds the selected note as a workspace-relative file node. The connection tool links two cards by selecting the source and then the target; JSON Canvas stores the arrow and label. Rectangle and ellipse tools remain standard JSON Canvas text nodes; their shape is stored in the node's `obsidium.shape` extension, so other JSON Canvas readers still see a valid text node. Unknown fields are preserved. PNG export rasterizes generated SVG, so browser support for SVG `foreignObject` limits fidelity for rich Markdown and local images.

Canvas drawing supports text, rectangle, ellipse, and directed connections. Freehand strokes and arbitrary vector paths are not stored because JSON Canvas has no portable representation for them; adding those would need an explicit extension compatibility decision.
