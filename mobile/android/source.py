import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

MARKER = ".obsidium-prepared.json"


def git(*args: str, cwd: Path | None = None, capture: bool = False) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, check=True,
                            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                            text=True, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    return result.stdout.strip() if capture else ""


def pinned_cache(cache: Path, repository: str, commit: str, offline: bool = False) -> None:
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists():
        git("init", "--bare", str(cache))
        git("remote", "add", "origin", repository, cwd=cache)
    if git("remote", "get-url", "origin", cwd=cache, capture=True) != repository:
        raise ValueError(f"Unexpected remote in {cache}")
    available = subprocess.run(["git", "cat-file", "-e", f"{commit}^{{commit}}"], cwd=cache,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not available:
        if offline:
            raise ValueError("The pinned upstream object is not cached; run preparation online once")
        git("fetch", "--no-tags", "--depth=1", "origin", commit, cwd=cache)
    resolved = git("rev-parse", f"{commit}^{{commit}}", cwd=cache, capture=True)
    if resolved != commit:
        raise ValueError("The fetched upstream commit does not match the pin")
    git("update-ref", f"refs/obsidium/pins/{commit}", commit, cwd=cache)


def new_checkout(cache: Path, commit: str, parent: Path) -> Path:
    directory = Path(tempfile.mkdtemp(prefix="prepare-", dir=parent))
    try:
        git("init", str(directory))
        git("config", "core.autocrlf", "false", cwd=directory)
        git("fetch", "--no-tags", "--depth=1", str(cache), commit, cwd=directory)
        git("checkout", "--detach", commit, cwd=directory)
        return directory
    except BaseException:
        shutil.rmtree(directory)
        raise


def tree_digest(source: Path) -> str:
    changed = subprocess.run(["git", "diff", "--binary", "HEAD"], cwd=source,
                             check=True, stdout=subprocess.PIPE).stdout
    digest = hashlib.sha256(changed)
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "-z"],
                               cwd=source, check=True, stdout=subprocess.PIPE).stdout
    for raw in sorted(filter(None, untracked.split(b"\0"))):
        path = source / os.fsdecode(raw)
        if path.name == MARKER:
            continue
        digest.update(raw)
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def reuse(source: Path, signature: str, commit: str) -> bool:
    if not source.exists():
        return False
    marker = source / MARKER
    if not marker.is_file():
        raise ValueError(f"Refusing to replace an unmanaged directory: {source}")
    state = json.loads(marker.read_text(encoding="utf-8"))
    valid = state.get("inputs") == signature and state.get("upstream") == commit
    valid = valid and git("rev-parse", "HEAD", cwd=source, capture=True) == commit
    valid = valid and state.get("tree") == tree_digest(source)
    if not valid:
        raise ValueError("Prepared sources or inputs changed; review edits, then run prepare.py --recreate")
    return True


def remove_prepared(source: Path, work: Path) -> None:
    if source.is_symlink() or source.resolve().parent != work.resolve() or source.name != "source":
        raise ValueError("Refusing to remove a directory outside the managed build tree")
    if source.exists():
        if not (source / MARKER).is_file():
            raise ValueError("Refusing to remove a directory without the preparation marker")
        shutil.rmtree(source)


def mark(source: Path, signature: str, config: dict) -> None:
    state = {"inputs": signature, "upstream": config["commit"], "version": config["version"],
             "tree": tree_digest(source)}
    (source / MARKER).write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
