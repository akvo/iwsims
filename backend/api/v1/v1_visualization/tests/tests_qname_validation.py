from django.test import SimpleTestCase
from rest_framework import serializers

from api.v1.v1_visualization.dashboard_serializers import validate_qname


class ValidateQnameTestCases(SimpleTestCase):
    """Part A guard: dashboard endpoints are question_name-only.

    A question token must be a question_name string. A digits-only token
    (a legacy question_id) is rejected with a 400 so a stray id is never
    silently treated as a literal name that matches nothing.
    """

    def test_name_passes_through(self):
        self.assertEqual(
            validate_qname("operational_status"), "operational_status"
        )

    def test_short_name_passes_through(self):
        self.assertEqual(validate_qname("ph"), "ph")

    def test_none_returns_none(self):
        self.assertIsNone(validate_qname(None))

    def test_numeric_string_rejected(self):
        with self.assertRaises(serializers.ValidationError):
            validate_qname("1749630516826")

    def test_integer_token_rejected(self):
        with self.assertRaises(serializers.ValidationError):
            validate_qname(1749630516826)

    def test_name_with_digits_passes(self):
        """A name that merely contains digits is not a bare id."""
        self.assertEqual(
            validate_qname("e_coli_cfu_100ml"), "e_coli_cfu_100ml"
        )
