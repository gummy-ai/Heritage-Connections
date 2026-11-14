from datetime import datetime
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from image_matching.images import make_thumbnail
from image_matching.quota import DailyQuotaReached, QuotaLedger


class QuotaTests(unittest.TestCase):
    def test_daily_operation_limits_are_separate_and_survive_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "quota.db"
            limits = {"list": 2, "detail": 2, "code": 2, "image": 2}
            ledger = QuotaLedger(path, limits)
            ledger.reserve("list")
            ledger.reserve("list")
            with self.assertRaises(DailyQuotaReached):
                ledger.reserve("list")
            ledger.reserve("detail")
            reopened = QuotaLedger(path, limits)
            self.assertEqual(reopened.status()["operations"]["list"]["remaining_local_budget"], 0)
            self.assertEqual(reopened.status()["operations"]["detail"]["remaining_local_budget"], 1)
            reopened.db.close()
            ledger.db.close()

    def test_next_kst_day_has_a_new_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = QuotaLedger(Path(directory) / "quota.db", {"list": 1})
            with patch("image_matching.quota.today", return_value="2026-11-14"):
                ledger.reserve("list")
                with self.assertRaises(DailyQuotaReached):
                    ledger.reserve("list")
            with patch("image_matching.quota.today", return_value="2026-11-15"):
                ledger.reserve("list")
                self.assertEqual(ledger.status()["operations"]["list"]["counted_or_reserved"], 1)
            ledger.db.close()

    def test_provider_limit_exhausts_only_the_relevant_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = QuotaLedger(Path(directory) / "quota.db", {"list": 1000, "detail": 1000})
            ledger.exhaust("detail")
            with self.assertRaises(DailyQuotaReached):
                ledger.reserve("detail")
            ledger.reserve("list")
            self.assertEqual(ledger.status()["operations"]["list"]["remaining_local_budget"], 999)
            ledger.db.close()


class ThumbnailAndSchemaTests(unittest.TestCase):
    def test_thumbnail_is_webp_and_keeps_the_original(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "photo.jpg"
            Image.new("RGB", (960, 1280), "#abc0ae").save(source)
            before = source.read_bytes()
            result = make_thumbnail(source, root)
            with Image.open(root / result["thumbnail_url"]) as image:
                self.assertEqual(image.format, "WEBP")
                self.assertEqual(image.size, (480, 640))
            self.assertEqual(source.read_bytes(), before)
            again = make_thumbnail(source, root)
            self.assertEqual(again, result)

    def test_site_builder_only_adds_fields_and_keeps_existing_items(self):
        path = Path(__file__).resolve().parents[2] / "scripts/build_site_data.py"
        build = runpy.run_path(str(path))["build"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            key = "artifact::국립중앙박물관::신수1"
            existing = {"schemaVersion": 1, "designerExtra": "keep", "count": 1, "artifacts": [{"headKey": key, "id": "신수1", "customLayout": "keep", "sourceUrl": "https://example.invalid/old"}]}
            (root / "assets/collection.json").write_text(json.dumps(existing))
            record = {"project_id": key, "collection_number": "신수1", "institution": "국립중앙박물관", "title": "유물", "official_title": "유물", "image_status": "available", "representative_image_url": "images/a.jpg", "thumbnail_url": "thumbs/a-480.webp", "emuseum_id": "official", "official_detail_page_url": "", "credit": "국립중앙박물관", "license": {"code": "1"}}
            matches = root / "matches.json"
            matches.write_text(json.dumps([record]))
            # runpy's function globals are separate from the returned namespace.
            with patch.dict(build.__globals__, {"ROOT": root}):
                build(None, matches, rows={}, quiet=True)
            data = json.loads((root / "assets/collection.json").read_text())
            self.assertEqual(data["designerExtra"], "keep")
            self.assertEqual(data["artifacts"][0]["customLayout"], "keep")
            self.assertEqual(data["artifacts"][0]["sourceUrl"], "https://example.invalid/old")
            self.assertEqual(data["artifacts"][0]["thumb"], "image_matching/public/thumbs/a-480.webp")


if __name__ == "__main__":
    unittest.main()
