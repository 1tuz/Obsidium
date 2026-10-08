# Palette Sources and Licenses

The theme registry includes 23 RehamVim palettes from `PzN2s/RehamVim/colors/reham_*.lua`, three palettes from `rccyx/osyx/packages/flavors/palettes` (Blush, Malachite, Sakura), and Cendre from `Aejkatappaja/cendre/lua/cendre/palette.lua`. Their original dark background, foreground, and accent hex values are kept in `styles/themes/palettes.css`. The light variants derive from those same hues and are not source presets.

RehamVim and osyx are Apache-2.0; Cendre is MIT. The original license texts are retained in `src/styles/themes/licenses/`. Retroma is MIT, but its CSS defines dynamic hue-based colors and user-selectable accents rather than one fixed palette. It is therefore not represented as a standalone palette; importing it requires choosing a specific supported accent and recording that choice.

The source links provided enumerate 23 RehamVim palettes, three osyx palettes, and Cendre: 27 fixed palettes. Retroma contributes a dynamic theme, not a fixed palette, so the references do not specify 29 discrete palettes. No palette was fabricated to fill that count.

`modules/theme/index.ts` sorts the full registry by displayed name using case-insensitive comparison. Settings render the same registry as selectable cards whose previews use current palette tokens and current light/dark mode.
