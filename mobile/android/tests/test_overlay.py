import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import ICON, STYLE, load_config
from overlay import apply_overlay
from test_contracts import MANIFEST, PALETTE, SEMANTICS


class OverlayIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.desktop = self.root / "desktop"
        self.app = self.source / "aquilum-app"
        for crate in ("core", "native", "android"):
            self.write(self.app / crate / "Cargo.toml", 'version = "0.3.26"\n')
        self.write(self.app / "android/app/src/main/AndroidManifest.xml", MANIFEST)
        self.write(self.app / "native/build.rs", '    files.push(styles.join("themes/dark.tokens"));\n')
        self.write(self.app / "native/src/android/mod.rs", 'let data = base.join("aquilum");\nlet vault = dir.join("Aquilum");\n')
        self.write(self.app / "native/src/updater/mod.rs", '(cfg!(feature = "installed") || ASKS) && apply::supported()\n')
        self.write(self.app / "core/src/sync/dropbox/mod.rs", 'id: "ytvmy13es5psczr"\n')
        self.write(self.app / "core/src/sync/service.rs", '    pub fn connect(&self, core: &Arc<Core>, links: Option<Receiver<String>>) -> io::Result<String> {\n        self.stop_login();\n    }\n')
        self.write(self.app / "native/src/ui/settings/schema/system.rs", 'const REPOSITORY_URL: &str = "https://github.com/Freaction/Aquilum";\nlet version = env!("CARGO_PKG_VERSION");\n')
        self.write(self.app / "native/assets/locales/en.json", '{"title": "Aquilum", "credits": "Aquilum authors"}')
        (self.app / "native/assets/styles/themes").mkdir(parents=True)
        for name in ("MainActivity.java", "SyncService.java"):
            self.write(self.app / "android/app/src/main/java/com/dmitriy/aquilum" / name, 'package com.dmitriy.aquilum;\nString title = "Aquilum";\n')
        self.write(self.desktop / STYLE / "palettes.css", PALETTE)
        self.write(self.desktop / STYLE / "palette-semantic.css", SEMANTICS)
        icon = self.desktop / ICON
        icon.parent.mkdir(parents=True)
        icon.write_bytes(b"fixture icon")
        self.write(self.app / "core/src/documents/replica.rs", "unchanged upstream replica\n")
        self.write(self.source / "LICENSE", "original license\n")

    def write(self, path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def test_complete_fixture_overlay_leaves_core_and_license_untouched(self):
        apply_overlay(self.source, self.desktop, load_config(), "")
        self.assertEqual((self.app / "core/src/documents/replica.rs").read_text(), "unchanged upstream replica\n")
        self.assertEqual((self.source / "LICENSE").read_text(), "original license\n")
        self.assertIn('CLIENT.id.is_empty()', (self.app / "core/src/sync/service.rs").read_text())
        self.assertIn('!cfg!(target_os = "android")', (self.app / "native/src/updater/mod.rs").read_text())
        self.assertIn('id: ""', (self.app / "core/src/sync/dropbox/mod.rs").read_text())
        self.assertIn('themes/obsidium.tokens', (self.app / "native/build.rs").read_text())
        self.assertIn('#090b11', (self.app / "native/assets/styles/themes/obsidium.tokens").read_text())
        self.assertIn('applicationId = "com.obsidium.mobile"', (self.app / "android/app/build.gradle.kts").read_text())
        self.assertIn('namespace = "com.dmitriy.aquilum"', (self.app / "android/app/build.gradle.kts").read_text())
        self.assertEqual(json.loads((self.app / "native/assets/locales/en.json").read_text())["credits"], "Aquilum authors")
        about = (self.app / "native/src/ui/settings/schema/system.rs").read_text()
        self.assertIn('"0.1.0"', about)
        self.assertIn('https://github.com/1tuz/Obsidium', about)

    def test_configured_oauth_key_is_consistent_across_native_and_android(self):
        apply_overlay(self.source, self.desktop, load_config(), "ownkey12345")
        native = (self.app / "core/src/sync/dropbox/mod.rs").read_text()
        android = (self.app / "android/app/src/main/AndroidManifest.xml").read_text()
        self.assertIn('id: "ownkey12345"', native)
        self.assertIn('db-ownkey12345', android)
        self.assertNotIn('ytvmy13es5psczr', native + android)

    def test_unexpected_upstream_version_is_rejected(self):
        self.write(self.app / "core/Cargo.toml", 'version = "9.9.9"\n')
        with self.assertRaises(ValueError):
            apply_overlay(self.source, self.desktop, load_config(), "")


if __name__ == "__main__":
    unittest.main()
