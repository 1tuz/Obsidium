import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build import SIGNING, verify_apk, without_signing
from config import file_sha256, load_config


class BuildContracts(unittest.TestCase):
    def setUp(self):
        self.config = load_config()
        self.badging = "package: name='com.obsidium.mobile.debug' versionCode='1' versionName='0.1.0-preview'\nnative-code: 'arm64-v8a'\n"

    def verify(self, badging=None, variant="debug"):
        with patch("build.subprocess.run", side_effect=[
            subprocess.CompletedProcess([], 0),
            subprocess.CompletedProcess([], 0, stdout=self.badging if badging is None else badging),
        ]):
            return verify_apk(Path("fixture.apk"), self.config, variant, Path("sdk"))

    def test_preview_identity(self):
        self.assertEqual(self.verify(), "com.obsidium.mobile.debug")

    def test_release_cannot_accept_preview_package(self):
        with self.assertRaises(ValueError):
            self.verify(variant="release")

    def test_rejects_wrong_version(self):
        with self.assertRaises(ValueError):
            self.verify(self.badging.replace("0.1.0-preview", "9.9.9"))

    def test_rejects_wrong_abi(self):
        with self.assertRaises(ValueError):
            self.verify(self.badging.replace("arm64-v8a", "x86_64"))

    def test_signature_verification_failure_is_not_ignored(self):
        with patch("build.subprocess.run", side_effect=subprocess.CalledProcessError(1, ["apksigner"])):
            with self.assertRaises(subprocess.CalledProcessError):
                verify_apk(Path("fixture.apk"), self.config, "debug", Path("sdk"))

    def test_compiler_does_not_receive_signing_credentials(self):
        environment = {name: "sensitive" for name in SIGNING}
        environment.update(KEYSTORE_BASE64="sensitive", OBSIDIUM_ANDROID_KEYSTORE_BASE64="sensitive",
                           ANDROID_NDK_HOME="ndk", PATH="tools", OBSIDIUM_DROPBOX_APP_KEY="public")
        self.assertEqual(without_signing(environment),
                         {"ANDROID_NDK_HOME": "ndk", "PATH": "tools", "OBSIDIUM_DROPBOX_APP_KEY": "public"})

    def test_streamed_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "input"
            path.write_bytes(b"abc")
            self.assertEqual(file_sha256(path), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


if __name__ == "__main__":
    unittest.main()
