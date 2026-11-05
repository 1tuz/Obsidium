import hashlib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = HERE / ".build"
DIST = HERE / "dist"
STYLE = Path("obsidium-app/src/styles/themes")
ICON = Path("obsidium-app/src-tauri/icons/128x128@2x.png")
UPSTREAM_KEY = "ytvmy13es5psczr"


def load_config(path: Path = HERE / "upstream.json") -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if config["repository"] != "https://github.com/Freaction/Aquilum.git":
        raise ValueError("The upstream repository must be reviewed before changing it")
    if not re.fullmatch(r"[a-f0-9]{40}", config["commit"]):
        raise ValueError("Pin a full upstream commit, not a branch or tag")
    for name in ("version", "upstream_version", "gradle", "cargo_ndk", "build_tools"):
        if not re.fullmatch(r"\d+\.\d+\.\d+", config[name]):
            raise ValueError(f"Invalid {name}")
    if not re.fullmatch(r"\d+\.\d+\.\d+", config["ndk"]):
        raise ValueError("Invalid NDK version")
    if not re.fullmatch(r"com\.obsidium\.[a-z][a-z0-9_.]*", config["application_id"]):
        raise ValueError("Use an independent Obsidium application ID")
    for name in ("version_code", "compile_sdk", "min_sdk"):
        if type(config[name]) is not int or config[name] < 1:
            raise ValueError(f"Invalid {name}")
    if config["version_code"] > 2_100_000_000:
        raise ValueError("Android versionCode is too large")
    if not 26 <= config["min_sdk"] <= config["compile_sdk"]:
        raise ValueError("Invalid SDK range")
    if not re.fullmatch(r"[a-z0-9-]+", config["palette"]):
        raise ValueError("Invalid palette")
    return config


def dropbox_key(value: str) -> str:
    if value and (not re.fullmatch(r"[a-zA-Z0-9]{8,64}", value) or value == UPSTREAM_KEY):
        raise ValueError("Use your own Dropbox app key, not Aquilum's key")
    return value


def integration_files() -> list[Path]:
    return sorted([HERE / "upstream.json", HERE / ".gitignore", *HERE.glob("*.py"),
                   *HERE.glob("overrides/*.kts"), *HERE.glob("tests/*.py")])


def input_files(root: Path = ROOT) -> list[Path]:
    return integration_files() + [root / STYLE / "palettes.css", root / STYLE / "palette-semantic.css", root / ICON]


def fingerprint(key: str, root: Path = ROOT) -> str:
    digest = hashlib.sha256(key.encode())
    for path in input_files(root):
        digest.update(str(path.relative_to(root)).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
