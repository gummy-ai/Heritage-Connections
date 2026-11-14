from pathlib import Path
import tempfile
import unittest

from image_matching.api import APIError, parse_xml, public_url, sanitize
from image_matching.data import Artifact, canonical_number, sample_artifacts
from image_matching.images import copy_image, usage_check
from image_matching.matching import choose_candidate


def artifact(institution="국립중앙박물관", number="신수14621", title="달항아리"):
    return Artifact(f"artifact::{institution}::{number}", 2, "1", institution, number, title)


def candidate(**overrides):
    return {"id": "official-id-1", "museumName2": "국립중앙박물관", "museumCode2": "PS01001001",
            "museumName3": "신수", "relicNo": "14621", "relicSubNo": "00000", "nameKr": "달항아리", **overrides}


class IdentityTests(unittest.TestCase):
    def test_unicode_spacing_and_leading_zeroes(self):
        self.assertEqual(canonical_number("신수－０１４６２１－００"), "신수14621")
        self.assertEqual(canonical_number("신수 014621"), "신수14621")
        self.assertEqual(canonical_number("신수014621-00001"), "신수14621-1")
        self.assertNotEqual(canonical_number("신수14621"), canonical_number("본관14621"))

    def test_same_name_and_wrong_number_never_matches(self):
        self.assertEqual(choose_candidate(artifact(), [candidate(relicNo="999")])["status"], "not_found")

    def test_same_number_in_other_institution_never_matches(self):
        self.assertEqual(choose_candidate(artifact(), [candidate(museumName2="다른박물관")])["status"], "manual_review")
        self.assertEqual(choose_candidate(artifact(), [candidate(museumCode2="other-code")])["status"], "manual_review")

    def test_subnumber_cannot_match_a_parent(self):
        self.assertEqual(choose_candidate(artifact(), [candidate(relicSubNo="00001")])["status"], "not_found")

    def test_duplicate_candidates_require_review(self):
        result = choose_candidate(artifact(), [candidate(), candidate(id="official-id-2")])
        self.assertEqual(result["status"], "manual_review")

    def test_exact_and_normalized_are_reported_separately(self):
        self.assertEqual(choose_candidate(artifact(), [candidate()])["status"], "matched_exact")
        self.assertEqual(choose_candidate(artifact(number="신수 014621"), [candidate()])["status"], "matched_normalized")

    def test_truncated_search_never_auto_matches(self):
        self.assertEqual(choose_candidate(artifact(), [candidate()], truncated=True)["status"], "manual_review")

    def test_sample_does_not_depend_on_row_order(self):
        rows = [artifact(number="신수" + str(n)) for n in range(30)]
        self.assertEqual(sample_artifacts(rows, 10), sample_artifacts(list(reversed(rows)), 10))


class TransportTests(unittest.TestCase):
    def test_actual_xml_shape(self):
        xml = b'<result><resultCode>0000</resultCode><totalCount>1</totalCount><list><data><item key="id" value="sample"/></data></list><imageList><totalCount>1</totalCount><list><data><item key="imgId" value="image-1"/></data></list></imageList></result>'
        result = parse_xml(xml)
        self.assertEqual(result["list"][0]["id"], "sample")
        self.assertEqual(result["imageList"][0]["imgId"], "image-1")

    def test_unrecognized_schema_fails_closed(self):
        with self.assertRaises(APIError):
            parse_xml(b'<result><resultCode>0000</resultCode><totalCount>1</totalCount><list><unknown/></list></result>')
        with self.assertRaises(APIError):
            parse_xml(b'<!DOCTYPE x [<!ENTITY y "secret">]><result/>')

    def test_echoed_keys_and_image_tokens_never_reach_exports(self):
        value = {"params": {"serviceKey": "SECRET"}, "imgUri": "https://www.emuseum.go.kr/openapi/img?serviceKey=IMAGE-TOKEN&imageId=x",
                 "serviceKey": "SECRET", "description": "SECRET"}
        clean = sanitize(value, "SECRET")
        self.assertNotIn("params", clean)
        self.assertNotIn("serviceKey", clean)
        self.assertEqual(clean["imgUri"], "")
        self.assertNotIn("SECRET", str(clean))
        self.assertNotIn("IMAGE-TOKEN", str(clean))
        self.assertEqual(public_url(value["imgUri"]), "")
        self.assertEqual(public_url("https://evil.example/photo.jpg"), "")


class LicenseTests(unittest.TestCase):
    def test_missing_restricted_or_other_record_license_is_not_downloaded(self):
        for code in ["", "2", "3", "4"]:
            usage = usage_check({"id": "a", "glsv": code}, {"id": "a"})
            self.assertFalse(usage["download_allowed"])
        self.assertFalse(usage_check({"id": "a", "glsv": "1"}, {"id": "b"})["download_allowed"])
        self.assertFalse(usage_check({"id": "a", "glsv": "1"}, {"id": "a", "glsv": "4"})["download_allowed"])

    def test_record_license_scope_is_not_invented_as_image_scope(self):
        usage = usage_check({"id": "a", "glsv": "1"}, {"id": "a"})
        self.assertTrue(usage["download_allowed"])
        self.assertEqual(usage["scope"], "collection_record")

    def test_html_with_http_200_is_not_saved_as_a_photo(self):
        class Headers:
            def get_content_type(self): return "text/html"
        class Response:
            headers = Headers()
            url = "https://www.emuseum.go.kr/error"
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, n): return b"<html>error</html>"
        class Opener:
            def open(self, *args, **kwargs): return Response()
        class FakeClient:
            opener = Opener()
            failures = retries = rate_limits = 0
            def _pace(self, *args): pass
        with tempfile.TemporaryDirectory() as directory:
            result = copy_image(FakeClient(), {"id": "a", "imgUri": "https://www.emuseum.go.kr/photo"},
                                {"download_allowed": True}, Path(directory))
            self.assertEqual(result["error_code"], "NOT_AN_IMAGE")
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
