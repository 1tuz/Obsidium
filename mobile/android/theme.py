import re
from pathlib import Path

from config import STYLE

DECLARATION = re.compile(r"(--q-[\w-]+)\s*:\s*([^;{}]+);")


def palette_colors(css: str, palette: str) -> dict[str, dict[str, str]]:
    values = dict(DECLARATION.findall(css))
    result = {}
    for mode in ("light", "dark"):
        result[mode] = {}
        for role in ("background", "text", "accent"):
            name = f"--q-palette-{palette}-{mode}-{role}"
            value = values.get(name, "").strip()
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
                raise ValueError(f"Missing six-digit palette color: {name}")
            result[mode][role] = value
    return result


def on_accent(hex_color: str) -> str:
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
    luminance = sum(a * b for a, b in zip(linear, (0.2126, 0.7152, 0.0722)))
    return "#000000" if (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) else "#ffffff"


def portable_semantics(css: str) -> list[tuple[str, str]]:
    declarations = []
    for name, raw in DECLARATION.findall(css):
        value = raw.strip()
        if "oklch(" not in value:
            declarations.append((name, value))
    if not {"--q-bg-canvas", "--q-text-primary", "--q-sidebar-bg"}.issubset(dict(declarations)):
        raise ValueError("The desktop palette semantic contract changed")
    return declarations


def make_tokens(palettes: str, semantics: str, palette: str) -> tuple[str, dict]:
    colors = palette_colors(palettes, palette)
    semantic = portable_semantics(semantics)
    blocks = []
    for mode, selector in (("light", ":root"), ("dark", '[data-theme="dark"]')):
        selected = colors[mode]
        accent = selected["accent"]
        variables = {
            "--q-palette-current-background": selected["background"],
            "--q-palette-current-text": selected["text"],
            "--q-palette-current-text-accent": accent,
            "--q-palette-current-text-on-accent": on_accent(accent),
            "--q-blue-alpha-main": accent,
            "--q-blue-500": accent,
            "--q-blue-600": f"color-mix(in srgb, {accent} 78%, #000000)",
        }
        variables.update(semantic)
        blocks.append(selector + " {\n" + "".join(f"    {k}: {v};\n" for k, v in variables.items()) + "}\n")
    return "\n".join(blocks), colors


def install_theme(source: Path, root: Path, palette: str) -> dict:
    styles = root / STYLE
    tokens, colors = make_tokens((styles / "palettes.css").read_text(encoding="utf-8"),
                                (styles / "palette-semantic.css").read_text(encoding="utf-8"), palette)
    native = source / "aquilum-app/native"
    (native / "assets/styles/themes/obsidium.tokens").write_text(tokens, encoding="utf-8")
    for mode, folder in (("light", "values"), ("dark", "values-night")):
        target = source / "aquilum-app/android/app/src/main/res" / folder / "colors.xml"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                          f'    <color name="background">{colors[mode]["background"]}</color>\n'
                          '</resources>\n', encoding="utf-8")
    return colors
