import json
import os
import subprocess
import tarfile
from pathlib import Path

from config import ICON, ROOT, STYLE, file_sha256, integration_files
from source import MARKER, git


def source_files(source: Path) -> list[Path]:
    output = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                            cwd=source, check=True, stdout=subprocess.PIPE).stdout
    paths = sorted({os.fsdecode(p) for p in output.split(b"\0") if p})
    files = []
    for relative in paths:
        path = Path(relative)
        if path.name == MARKER:
            continue
        if path.is_absolute() or ".." in path.parts or any(p in {".git", "local.properties"} for p in path.parts):
            raise ValueError(f"Unsafe source archive member: {path}")
        if path.suffix.lower() in {".jks", ".keystore"} or path.name.startswith(".env"):
            raise ValueError(f"Refusing to package signing material or environment files: {path}")
        absolute = source / path
        if absolute.is_file() or absolute.is_symlink():
            files.append(path)
    return files


def package_source(source: Path, destination: Path, config: dict, variant: str) -> None:
    files = source_files(source)
    with tarfile.open(destination, "w:gz") as archive:
        for path in files:
            archive.add(source / path, arcname=str(Path("source") / path), recursive=False)
        inputs = [ROOT / STYLE / "palettes.css", ROOT / STYLE / "palette-semantic.css", ROOT / ICON,
                  ROOT / "knowledge base/android-client.md"]
        inputs += integration_files()
        for path in sorted(inputs):
            archive.add(path, arcname=str(Path("integration") / path.relative_to(ROOT)), recursive=False)
    payload = {"upstream": config["commit"], "upstream_version": config["upstream_version"],
               "version": config["version"], "version_code": config["version_code"], "variant": variant,
               "fork_commit": git("rev-parse", "HEAD", cwd=ROOT, capture=True),
               "fork_dirty": bool(git("status", "--porcelain", cwd=ROOT, capture=True)),
               "source_sha256": file_sha256(destination)}
    destination.with_suffix(".json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
