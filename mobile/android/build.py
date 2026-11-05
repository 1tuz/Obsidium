import argparse
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from config import DIST, ROOT, WORK, file_sha256, load_config
from package_source import package_source
from prepare import prepare

SIGNING = ("OBSIDIUM_ANDROID_KEYSTORE", "OBSIDIUM_ANDROID_STORE_PASSWORD",
           "OBSIDIUM_ANDROID_KEY_ALIAS", "OBSIDIUM_ANDROID_KEY_PASSWORD")


def signing_ready(variant: str, environment: dict, source: Path) -> None:
    if variant != "release":
        return
    if any(not environment.get(name) for name in SIGNING):
        raise ValueError("Release signing needs all four OBSIDIUM_ANDROID_* credentials")
    keystore = Path(environment[SIGNING[0]]).resolve()
    if not keystore.is_file():
        raise ValueError("The signing keystore does not exist")
    if keystore.is_relative_to(source.resolve()) or keystore.is_relative_to(ROOT):
        raise ValueError("Keep signing material outside both source trees")


def without_signing(environment: dict) -> dict:
    return {name: value for name, value in environment.items()
            if not name.startswith("OBSIDIUM_ANDROID_") and name != "KEYSTORE_BASE64"}


def verify_apk(apk: Path, config: dict, variant: str, sdk: Path) -> str:
    tools = sdk / "build-tools" / config["build_tools"]
    suffix = ".bat" if os.name == "nt" else ""
    subprocess.run([str(tools / ("apksigner" + suffix)), "verify", str(apk)], check=True)
    aapt = tools / ("aapt.exe" if os.name == "nt" else "aapt")
    badging = subprocess.run([str(aapt), "dump", "badging", str(apk)], check=True,
                             stdout=subprocess.PIPE, text=True).stdout
    package = config["application_id"] + (".debug" if variant == "debug" else "")
    version = config["version"] + ("-preview" if variant == "debug" else "")
    if f"package: name='{package}'" not in badging or f"versionCode='{config['version_code']}'" not in badging:
        raise ValueError("APK package identity/versionCode does not match the configuration")
    if f"versionName='{version}'" not in badging:
        raise ValueError("APK versionName does not match the configuration")
    abis = re.search(r"^native-code: (.+)$", badging, re.MULTILINE)
    if not abis or abis.group(1).strip() != "'arm64-v8a'":
        raise ValueError("The APK must contain only the ARM64 native library")
    return package


def build(variant: str, core_tests: bool = False) -> Path:
    config = load_config()
    source = prepare()
    app = source / "aquilum-app"
    env = dict(os.environ) if variant == "release" else without_signing(os.environ)
    signing_ready(variant, env, source)
    sdk = Path(env.get("ANDROID_HOME") or env.get("ANDROID_SDK_ROOT") or "")
    if not (sdk / "platforms" / f"android-{config['compile_sdk']}").is_dir():
        raise ValueError("Set ANDROID_HOME to an SDK with the pinned Android platform installed")
    ndk = sdk / "ndk" / config["ndk"]
    if not ndk.is_dir():
        raise ValueError(f"Missing pinned Android NDK: {ndk}")
    env.update(ANDROID_NDK_HOME=str(ndk.resolve()), CARGO_TARGET_DIR=str(WORK / "cargo"))
    DIST.mkdir(parents=True, exist_ok=True)
    stem = f"Obsidium_{config['version']}_arm64_{variant}"
    package_source(source, DIST / (stem + "_source.tar.gz"), config, variant)
    compile_env = without_signing(env)
    if core_tests:
        subprocess.run(["cargo", "test", "--locked", "-p", "aquilum-core", "--lib"], cwd=app, env=compile_env, check=True)
    subprocess.run(["cargo", "ndk", "-t", "arm64-v8a", "-P", str(config["min_sdk"]),
                    "-o", "android/app/src/main/jniLibs", "build", "--locked", "-p", "aquilum-android", "--release"],
                   cwd=app, env=compile_env, check=True)
    gradle = shutil.which("gradle")
    if not gradle:
        raise ValueError(f"Install Gradle {config['gradle']} and put it on PATH")
    subprocess.run([gradle, "-p", "android", "--no-daemon", "--console", "plain",
                    "assemble" + variant.title(), f"-PappVersion={config['version']}",
                    f"-PappVersionCode={config['version_code']}"], cwd=app, env=env, check=True)
    apk = app / f"android/app/build/outputs/apk/{variant}/app-{variant}.apk"
    package = verify_apk(apk, config, variant, sdk)
    target = DIST / (stem + ".apk")
    shutil.copyfile(apk, target)
    digest = file_sha256(target)
    target.with_suffix(".apk.sha256").write_text(f"{digest}  {target.name}\n", encoding="utf-8")
    metadata = {"application_id": package, "version": config["version"], "version_code": config["version_code"],
                "variant": variant, "upstream": config["commit"], "sha256": digest,
                "runtime_tested": False}
    target.with_suffix(".build.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", choices=("debug", "release"), default="debug")
    parser.add_argument("--test-core", action="store_true")
    args = parser.parse_args()
    print(build(args.variant, args.test_core))
