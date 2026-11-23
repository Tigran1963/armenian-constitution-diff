import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.extract import extract, read_pages, join


class ExtractionTests(unittest.TestCase):
    def test_reports_absent_text_corruption_and_page_count(self):
        with patch("scripts.extract.command", side_effect=["\fՀայերեն �\f", "Pages: 3\n"]):
            issues = []
            list(read_pages(Path("source.pdf"), issues))
        self.assertEqual([x["code"] for x in issues], [
            "page-count", "weak-text-layer", "weak-text-layer", "unreadable-glyph",
        ])
        self.assertEqual(issues[-1]["page"], 2)

    def test_reports_partially_extracted_document(self):
        issues = []
        markdown, _, _ = extract("new", [(1, "Մենք՝ ժողովուրդը։")], issues)
        self.assertIn("Մենք՝ ժողովուրդը։", markdown)
        self.assertEqual({x["code"] for x in issues}, {"article-sequence", "chapter-sequence"})

    def test_reports_missing_preamble(self):
        issues = []
        self.assertEqual(extract("new", [(1, "Լրիվ այլ տեքստ")], issues)[0], "")
        self.assertEqual(issues[0]["code"], "preamble-missing")

    def test_flags_ocr_for_review_and_preserves_its_output(self):
        with patch("scripts.extract.command", side_effect=["\f", "Pages: 1\n"]):
            with patch("scripts.extract.ocr_page", return_value="Մենք՝ Հայաստանի ժողովուրդը։") as ocr:
                issues = []
                actual = list(read_pages(Path("scan.pdf"), issues, True))
        self.assertEqual(actual, [(1, "Մենք՝ Հայաստանի ժողովուրդը։")])
        self.assertEqual(issues[-1]["code"], "ocr-needs-proofreading")
        ocr.assert_called_once_with(Path("scan.pdf"), 1)

    def test_keeps_uncertain_hyphen_and_joins_wrapped_ordinals(self):
        issues = []
        text = join([(2, "Ըստ 11-"), (3, "րդ հոդվածի")], issues)
        self.assertEqual(text, "Ըստ 11-րդ հոդվածի")
        text = join([(2, "բառ-"), (3, "մաս")], issues)
        self.assertEqual(text, "բառ-\nմաս")
        self.assertEqual(issues[-1]["code"], "ambiguous-line-end-hyphen")


if __name__ == "__main__":
    unittest.main()
