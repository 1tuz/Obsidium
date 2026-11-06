import json
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

from config import HERE, ICON, UPSTREAM_KEY
from theme import install_theme

ANDROID = "http://schemas.android.com/apk/res/android"
NS = "{" + ANDROID + "}"
ET.register_namespace("android", ANDROID)


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise ValueError(f"Upstream contract changed in {path}: expected exactly one replacement")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def configure_manifest(path: Path, key: str) -> None:
    document = ET.parse(path)
    root = document.getroot()
    application = root.find("application")
    if application is None:
        raise ValueError("Missing Android application")
    application.set(NS + "label", "@string/app_name")
    application.set(NS + "icon", "@drawable/obsidium_icon")
    application.set(NS + "allowBackup", "false")
    application.set(NS + "usesCleartextTraffic", "false")
    for permission in list(root.findall("uses-permission")):
        if permission.get(NS + "name") == "android.permission.REQUEST_INSTALL_PACKAGES":
            root.remove(permission)
    for provider in list(application.findall("provider")):
        if provider.get(NS + "authorities") == "${applicationId}.updates":
            application.remove(provider)
    found = 0
    for activity in application.findall("activity"):
        for intent in list(activity.findall("intent-filter")):
            for data in intent.findall("data"):
                if data.get(NS + "scheme") == "db-" + UPSTREAM_KEY:
                    found += 1
                    if key:
                        data.set(NS + "scheme", "db-" + key)
                    else:
                        activity.remove(intent)
    if found != 1:
        raise ValueError("Upstream Dropbox callback contract changed")
    for node in application:
        name = node.get(NS + "name", "")
        if name.startswith("."):
            node.set(NS + "name", "com.dmitriy.aquilum" + name)
    ET.indent(document, space="    ")
    document.write(path, encoding="utf-8", xml_declaration=True)


def brand_value(value, key: str = ""):
    if any(word in key.lower() for word in ("license", "copyright", "author", "credit", "attribution")):
        return value
    if isinstance(value, dict):
        return {k: brand_value(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [brand_value(v, key) for v in value]
    if isinstance(value, str):
        return value.replace("https://github.com/Freaction/Aquilum", "https://github.com/1tuz/Obsidium").replace("Aquilum", "Obsidium")
    return value


def apply_overlay(source: Path, root: Path, config: dict, key: str) -> None:
    app = source / "aquilum-app"
    for crate in ("core", "native", "android"):
        manifest = (app / crate / "Cargo.toml").read_text(encoding="utf-8")
        if f'version = "{config["upstream_version"]}"' not in manifest:
            raise ValueError(f"Unexpected upstream version in {crate}")
    build_gradle = (HERE / "overrides/app.build.gradle.kts").read_text(encoding="utf-8")
    for name in ("version", "version_code", "application_id", "ndk", "compile_sdk", "min_sdk", "build_tools"):
        build_gradle = build_gradle.replace("@" + name.upper() + "@", str(config[name]))
    (app / "android/app/build.gradle.kts").write_text(build_gradle, encoding="utf-8")
    configure_manifest(app / "android/app/src/main/AndroidManifest.xml", key)
    drawable = app / "android/app/src/main/res/drawable-nodpi"
    drawable.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / ICON, drawable / "obsidium_icon.png")
    install_theme(source, root, config["palette"])
    replace_once(app / "native/build.rs", '    files.push(styles.join("themes/dark.tokens"));',
                 '    files.push(styles.join("themes/dark.tokens"));\n    files.push(styles.join("themes/obsidium.tokens"));')
    replace_once(app / "native/src/android/mod.rs", '.join("aquilum");', '.join("obsidium");')
    replace_once(app / "native/src/android/mod.rs", 'dir.join("Aquilum")', 'dir.join("Obsidium")')
    replace_once(app / "native/src/updater/mod.rs",
                 '(cfg!(feature = "installed") || ASKS) && apply::supported()',
                 '!cfg!(target_os = "android") && (cfg!(feature = "installed") || ASKS) && apply::supported()')
    replace_once(app / "core/src/sync/dropbox/mod.rs", f'id: "{UPSTREAM_KEY}"', f'id: "{key}"')
    signature = '    pub fn connect(&self, core: &Arc<Core>, links: Option<Receiver<String>>) -> io::Result<String> {\n'
    guard = ('        if CLIENT.id.is_empty() {\n'
             '            return Err(io::Error::new(io::ErrorKind::Unsupported,\n'
             '                "Dropbox is not configured for this Obsidium build. Set your own app key at build time."));\n'
             '        }\n')
    replace_once(app / "core/src/sync/service.rs", signature, signature + guard)
    settings = app / "native/src/ui/settings/schema/system.rs"
    replace_once(settings, 'const REPOSITORY_URL: &str = "https://github.com/Freaction/Aquilum";',
                 'const REPOSITORY_URL: &str = "https://github.com/1tuz/Obsidium";')
    replace_once(settings, 'env!("CARGO_PKG_VERSION")', json.dumps(config["version"]))
    for path in sorted((app / "native/assets/locales").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        path.write_text(json.dumps(brand_value(data), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name in ("MainActivity.java", "SyncService.java"):
        path = app / "android/app/src/main/java/com/dmitriy/aquilum" / name
        text = path.read_text(encoding="utf-8")
        path.write_text(text.replace('"Aquilum"', '"Obsidium"'), encoding="utf-8")
    (source / "NOTICE.obsidium.md").write_text(
        f'# Obsidium Android {config["version"]}\n\n'
        f'Downstream of Freaction/Aquilum {config["upstream_version"]}, commit {config["commit"]}.\n'
        'Original authors, copyright notices and AGPL-3.0-only license are retained.\n'
        'Changes: application identity, desktop-derived palette and icon, isolated OAuth, disabled upstream updater, build and CI.\n'
        'This is a companion Markdown client, not the Preact/CodeMirror desktop application.\n', encoding="utf-8")
