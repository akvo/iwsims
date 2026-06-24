from django.test import SimpleTestCase

from api.v1.v1_forms.constants import QuestionTypes
from utils.functions import _typed_value


class TypedValueTests(SimpleTestCase):
    """Shared typed-extraction helper for get_answer_value /
    get_answer_history. Administration is handled by the callers (they
    differ on webform / None handling), so it is out of scope here.
    """

    def test_option_returns_options(self):
        self.assertEqual(
            _typed_value(QuestionTypes.option, ["a"], None, None), ["a"]
        )

    def test_multiple_option_returns_options(self):
        self.assertEqual(
            _typed_value(
                QuestionTypes.multiple_option, ["a", "b"], None, None
            ),
            ["a", "b"],
        )

    def test_geo_returns_options(self):
        self.assertEqual(
            _typed_value(QuestionTypes.geo, [1.0, 2.0], None, None),
            [1.0, 2.0],
        )

    def test_number_returns_value(self):
        self.assertEqual(
            _typed_value(QuestionTypes.number, None, 42, None), 42
        )

    def test_text_returns_name(self):
        self.assertEqual(
            _typed_value(QuestionTypes.text, None, None, "hello"), "hello"
        )

    def test_date_returns_name(self):
        self.assertEqual(
            _typed_value(QuestionTypes.date, None, None, "2025-01-01"),
            "2025-01-01",
        )
