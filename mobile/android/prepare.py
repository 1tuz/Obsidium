import argparse
import os
import shutil
from pathlib import Path

from config import ROOT, WORK, dropbox_key, fingerprint, load_config
from overlay import apply_overlay
from source import mark, new_checkout, pinned_cache, remove_prepared, reuse


def prepare(*, offline: bool = False, recreate: bool = False) -> Path:
    config = load_config()
    key = dropbox_key(os.environ.get("OBSIDIUM_DROPBOX_APP_KEY", ""))
    signature = fingerprint(key)
    source = WORK / "source"
    if recreate:
        remove_prepared(source, WORK)
    if reuse(source, signature, config["commit"]):
        return source
    cache = WORK / "upstream.git"
    pinned_cache(cache, config["repository"], config["commit"], offline)
    temporary = new_checkout(cache, config["commit"], WORK)
    try:
        apply_overlay(temporary, ROOT, config, key)
        mark(temporary, signature, config)
        temporary.rename(source)
    except BaseException:
        shutil.rmtree(temporary)
        raise
    return source


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--recreate", action="store_true")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    source = prepare(offline=args.offline, recreate=args.recreate)
    if args.github_output:
        values = {**load_config(), "source": str(source)}
        with args.github_output.open("a", encoding="utf-8") as output:
            for key, value in values.items():
                output.write(f"{key}={value}\n")
    print(source)


if __name__ == "__main__":
    main()
