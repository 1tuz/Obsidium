import json
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import HERE, UPSTREAM_KEY, dropbox_key, integration_files, load_config
from overlay import NS, brand_value, configure_manifest, replace_once
from theme import make_tokens, on_accent, palette_colors, portable_semantics

PALETTE = '''
:root {
 --q-palette-obsidium-light-background: #ffffff;
 --q-palette-obsidium-light-text: #181a20;
 --q-palette-obsidium-light-accent: #1471eb;
 --q-palette-obsidium-dark-background: #090b11;
 --q-palette-obsidium-dark-text: #f5f7fa;
 --q-palette-obsidium-dark-accent: #5690dc;
}
'''
SEMANTICS = '''
:root[data-palette][data-theme] {
 --q-bg-canvas: var(--q-palette-current-background);
 --q-text-primary: var(--q-palette-current-text);
 --q-sidebar-bg: var(--q-bg-canvas);
 --q-editor-code-keyword: oklch(from var(--q-text-accent) l c h);
}
'''
MANIFEST = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android">
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
<application android:label="Aquilum" android:icon="@mipmap/ic_launcher">
<activity android:name=".MainActivity">
<intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
<intent-filter><action android:name="android.intent.action.VIEW" />
<data android:scheme="db-ytvmy13es5psczr" /></intent-filter>
</activity>
<service android:name=".SyncService" />
<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.updates" />
</application></manifest>'''


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_default_pin_and_independent_package(self):
        config = load_config()
        self.assertEqual(len(config["commit"]), 40)
        self.assertEqual(config["application_id"], "com.obsidium.mobile")
        self.assertEqual(config["upstream_version"], "0.3.26")

    def test_config_rejects_floating_pin(self):
        config = load_config()
        config["commit"] = "main"
        path = self.folder / "pin.json"
        path.write_text(json.dumps(config))
        with self.assertRaises(ValueError):
            load_config(path)

    def test_config_rejects_original_identity(self):
        config = load_config()
        config["application_id"] = "com.dmitriy.aquilum"
        path = self.folder / "pin.json"
        path.write_text(json.dumps(config))
        with self.assertRaises(ValueError):
            load_config(path)

    def test_config_rejects_invalid_version_code(self):
        for value in (True, -1, 2_100_000_001, "1"):
            with self.subTest(value=value):
                config = load_config()
                config["version_code"] = value
                path = self.folder / "pin.json"
                path.write_text(json.dumps(config))
                with self.assertRaises(ValueError):
                    load_config(path)

    def test_no_borrowed_dropbox_identity_or_code_injection(self):
        for key in (UPSTREAM_KEY, 'abc";panic!()', " abcdef12345 ", "abcdef12345\n"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                dropbox_key(key)
        self.assertEqual(dropbox_key(""), "")
        self.assertEqual(dropbox_key("ownkey12345"), "ownkey12345")

    def manifest(self, key):
        path = self.folder / "AndroidManifest.xml"
        path.write_text(MANIFEST)
        configure_manifest(path, key)
        return ET.parse(path).getroot()

    def test_manifest_has_no_original_update_permission(self):
        root = self.manifest("")
        permissions = [p.get(NS + "name") for p in root.findall("uses-permission")]
        self.assertEqual(permissions, ["android.permission.INTERNET"])
        self.assertEqual(root.findall("application/provider"), [])

    def test_unconfigured_build_has_no_oauth_intent(self):
        root = self.manifest("")
        self.assertEqual(root.findall(".//data"), [])
        self.assertEqual(len(root.findall(".//intent-filter")), 1)

    def test_configured_build_has_own_oauth_intent(self):
        root = self.manifest("ownkey12345")
        self.assertEqual(root.find(".//data").get(NS + "scheme"), "db-ownkey12345")

    def test_manifest_preserves_jni_class_names(self):
        root = self.manifest("")
        app = root.find("application")
        self.assertEqual(app.find("activity").get(NS + "name"), "com.dmitriy.aquilum.MainActivity")
        self.assertEqual(app.find("service").get(NS + "name"), "com.dmitriy.aquilum.SyncService")
        self.assertEqual(app.get(NS + "allowBackup"), "false")
        self.assertEqual(app.get(NS + "label"), "@string/app_name")

    def test_contract_drift_fails_instead_of_silent_partial_patch(self):
        path = self.folder / "file.rs"
        for original in ("missing", "needle needle"):
            path.write_text(original)
            with self.assertRaises(ValueError):
                replace_once(path, "needle", "replacement")
            self.assertEqual(path.read_text(), original)

    def test_branding_preserves_original_credits(self):
        data = {"title": "Aquilum", "credits": "Aquilum by Dmitriy", "copyright": "Aquilum",
                "repository": "https://github.com/Freaction/Aquilum", "nested": ["Aquilum"]}
        branded = brand_value(data)
        self.assertEqual(branded["title"], "Obsidium")
        self.assertEqual(branded["credits"], data["credits"])
        self.assertEqual(branded["copyright"], data["copyright"])
        self.assertEqual(branded["repository"], "https://github.com/1tuz/Obsidium")
        self.assertEqual(branded["nested"], ["Obsidium"])

    def test_themes_use_desktop_colors_for_both_modes(self):
        text, colors = make_tokens(PALETTE, SEMANTICS, "obsidium")
        self.assertIn('[data-theme="dark"]', text)
        self.assertIn("#090b11", text)
        self.assertIn("#ffffff", text)
        self.assertEqual(colors["dark"]["accent"], "#5690dc")
        self.assertNotIn("oklch(", text)

    def test_missing_palette_or_semantics_is_an_error(self):
        with self.assertRaises(ValueError):
            palette_colors(PALETTE, "missing")
        with self.assertRaises(ValueError):
            portable_semantics(":root { --q-one: #ffffff; }")

    def test_on_accent_chooses_contrasting_text(self):
        self.assertEqual(on_accent("#ffffff"), "#000000")
        self.assertEqual(on_accent("#000000"), "#ffffff")

    def test_packaged_integration_sources_exclude_arbitrary_files(self):
        paths = integration_files()
        self.assertIn(HERE / "upstream.json", paths)
        self.assertTrue(all(not {".build", "dist", "__pycache__"}.intersection(p.relative_to(HERE).parts) for p in paths))
        self.assertTrue(all(p.suffix not in {".jks", ".keystore"} for p in paths))

    def test_gradle_uses_own_signer_and_separate_debug_identity(self):
        text = (HERE / "overrides/app.build.gradle.kts").read_text()
        self.assertIn('applicationIdSuffix = ".debug"', text)
        self.assertIn('signingConfigs.findByName("obsidium")', text)
        self.assertNotIn('signingConfigs.getByName("debug")', text)
        self.assertIn('abiFilters += "arm64-v8a"', text)
        self.assertIn("releaseRequested && keystorePath.isNullOrBlank()", text)


if __name__ == "__main__":
    unittest.main()
