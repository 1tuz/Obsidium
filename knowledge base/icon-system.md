# Icon sets

UI icons use semantic IDs from `obsidium-app/src/components/Common/iconCatalog.ts`. The ID list is
the compile time contract: every Tabler and Phosphor catalog is typed against it, and a missing
family entry breaks TypeScript. New code passes an ID to the shared `Icon` component. Existing
Lucide callers remain supported while the icon audit migrates them; a test scans those imports and
fails if an icon has no semantic mapping.

Lucide node data and the Tabler Outline and Phosphor Regular SVG subsets load as separate local
chunks. The selected family is applied through `ui.iconSet` in `settings.json`; missing values from
older settings resolve to Lucide. The selector updates all React icons and CodeMirror DOM icons
without restarting. Family data is cached after its first use, so returning to a previously selected
set does not load it again.

Each family keeps its source viewport: Lucide and Tabler use 24 by 24, while Phosphor Regular uses
256 by 256. The shared rendered size scales all three consistently without clipping Phosphor paths.
All sets use `currentColor`; Tabler inherits the app's stroke weight and Phosphor uses filled paths.
This keeps hover, active, disabled, light, dark, and palette colors in the existing CSS tokens. Local
subset imports keep unused library assets out of the frontend bundle; do not replace them with
namespace imports or remote image URLs.

If a legacy Lucide icon is not in the mapping, alternate sets use the `file` icon as a same family
fallback. Add its ID and one asset per family before using it in a new surface. The regression test
checks both catalog completeness and the legacy import map.
