# Palette Sources and Licenses

Vice is an original built-in palette inspired by the pink neon hues associated with Vice City. Its color values are defined directly in `styles/themes/palettes.css` and do not derive from an imported preset.

The theme registry includes 23 RehamVim palettes from `PzN2s/RehamVim/colors/reham_*.lua`, three palettes from `rccyx/osyx/packages/flavors/palettes` (Blush, Malachite, Sakura), Cendre from `Aejkatappaja/cendre/lua/cendre/palette.lua`, and Ardoise from `generalentropy/obsidian-ardoise`. Their source background, foreground, and accent hex values are kept in `styles/themes/palettes.css`. The RehamVim and osyx light variants derive from those same hues and are not source presets.

Ardoise uses the original Slate background and Ochre accent in both modes. The dark background, text, and accent are `#2d343d`, `#e2ded6`, and `#dbb57c`. The light values are `#eef0f2`, `#2f3740`, and `#8c5f1f`. The palette engine derives surfaces and borders from these colors. The original MIT license is in `src/styles/themes/licenses/ARDOISE-MIT.txt`. [Obsidian listing](https://community.obsidian.md/themes/ardoise) · [Upstream colors](https://github.com/generalentropy/obsidian-ardoise/blob/main/theme.css#L184-L274) · [Upstream license](https://github.com/generalentropy/obsidian-ardoise/blob/main/LICENSE)

RehamVim and osyx are Apache-2.0; Cendre and Ardoise are MIT. The original license texts are retained in `src/styles/themes/licenses/`. Retroma is MIT, but its CSS defines dynamic hue-based colors and user-selectable accents rather than one fixed palette. It is therefore not represented as a standalone palette; importing it requires choosing a specific supported accent and recording that choice.

The sources above provide 28 fixed palettes.

`modules/theme/index.ts` sorts the full registry by displayed name using case-insensitive comparison. Settings render the same registry as selectable cards whose previews use current palette tokens and current light/dark mode.

Custom DTCG palette import and its supported subset are documented in [theme-palette-import.md](theme-palette-import.md).
