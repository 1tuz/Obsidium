import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build import signing_ready
from package_source import source_files
from source import MARKER, git, mark, new_checkout, pinned_cache, remove_prepared, reuse


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin = self.root / "origin"
        git("init", str(self.origin))
        git("config", "user.name", "Test", cwd=self.origin)
        git("config", "user.email", "test@example.invalid", cwd=self.origin)
        (self.origin / "note.md").write_text("original\n")
        git("add", ".", cwd=self.origin)
        git("commit", "-m", "initial", cwd=self.origin)
        self.commit = git("rev-parse", "HEAD", cwd=self.origin, capture=True)
        self.work = self.root / "work"
        self.work.mkdir()

    def checkout(self):
        cache = self.work / "upstream.git"
        pinned_cache(cache, str(self.origin), self.commit)
        source = new_checkout(cache, self.commit, self.work)
        destination = self.work / "source"
        source.rename(destination)
        return destination

    def test_preparation_checks_out_pin_not_current_branch(self):
        (self.origin / "note.md").write_text("later\n")
        git("add", ".", cwd=self.origin)
        git("commit", "-m", "later", cwd=self.origin)
        source = self.checkout()
        self.assertEqual((source / "note.md").read_text(), "original\n")
        self.assertEqual(git("rev-parse", "HEAD", cwd=source, capture=True), self.commit)

    def test_cached_commit_can_be_used_offline(self):
        cache = self.work / "upstream.git"
        pinned_cache(cache, str(self.origin), self.commit)
        pinned_cache(cache, str(self.origin), self.commit, offline=True)
        with self.assertRaises(ValueError):
            pinned_cache(cache, str(self.origin), "1" * 40, offline=True)

    def test_remote_mismatch_fails(self):
        cache = self.work / "upstream.git"
        pinned_cache(cache, str(self.origin), self.commit)
        with self.assertRaises(ValueError):
            pinned_cache(cache, "https://example.invalid/unreviewed.git", self.commit)

    def test_unchanged_preparation_is_reused(self):
        source = self.checkout()
        mark(source, "signature", {"commit": self.commit, "version": "0.1.0"})
        self.assertTrue(reuse(source, "signature", self.commit))

    def test_modified_prepared_files_are_not_overwritten(self):
        source = self.checkout()
        mark(source, "signature", {"commit": self.commit, "version": "0.1.0"})
        (source / "note.md").write_text("manual edit\n")
        with self.assertRaises(ValueError):
            reuse(source, "signature", self.commit)
        self.assertEqual((source / "note.md").read_text(), "manual edit\n")

    def test_new_inputs_are_not_silently_ignored(self):
        source = self.checkout()
        mark(source, "old", {"commit": self.commit, "version": "0.1.0"})
        with self.assertRaises(ValueError):
            reuse(source, "new", self.commit)

    def test_unmanaged_directory_cannot_be_deleted(self):
        source = self.work / "source"
        source.mkdir()
        with self.assertRaises(ValueError):
            remove_prepared(source, self.work)
        self.assertTrue(source.exists())

    def test_managed_recreation_is_scoped(self):
        source = self.checkout()
        mark(source, "signature", {"commit": self.commit, "version": "0.1.0"})
        with self.assertRaises(ValueError):
            remove_prepared(self.origin, self.work)
        remove_prepared(source, self.work)
        self.assertFalse(source.exists())
        self.assertTrue(self.origin.exists())

    def test_archives_include_untracked_overlay_but_no_marker(self):
        source = self.checkout()
        (source / "NOTICE.obsidium.md").write_text("downstream source\n")
        mark(source, "signature", {"commit": self.commit, "version": "0.1.0"})
        paths = source_files(source)
        self.assertIn(Path("note.md"), paths)
        self.assertIn(Path("NOTICE.obsidium.md"), paths)
        self.assertNotIn(Path(MARKER), paths)

    def test_archive_refuses_a_keystore(self):
        source = self.checkout()
        (source / "release.keystore").write_bytes(b"not a real key")
        with self.assertRaises(ValueError):
            source_files(source)

    def test_release_cannot_fall_back_to_debug_key(self):
        with self.assertRaises(ValueError):
            signing_ready("release", {}, self.root)
        signing_ready("debug", {}, self.root)


if __name__ == "__main__":
    unittest.main()
