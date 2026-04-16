from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesFilterTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test date/administration filtering and edge cases.

    Test data dates (from mixin setUp):
    - mon1a: created=2025-01-15, date_answer=2025-01-15
    - mon1b: created=2025-03-10, date_answer=2025-03-10
    - mon2a: created=2025-01-20, date_answer=2025-01-20
    - mon2b: created=2025-03-15, date_answer=2025-03-15
    """

    def test_date_filter_by_created(self):
        """Filter by FormData.created when no date_question_id.

        from_date=2025-03-01 → only mon1b (Mar 10) and mon2b (Mar 15).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&from_date=2025-03-01"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"][0]["value"], 2)

    def test_date_filter_by_date_question(self):
        """Filter by date question answer instead of created.

        date_question_id provided, from_date=2025-01-01, to_date=2025-01-31.
        date answers in Jan: mon1a (2025-01-15), mon2a (2025-01-20).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&date_question_id={self.q_date.id}"
            "&from_date=2025-01-01&to_date=2025-01-31"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"][0]["value"], 2)

    def test_date_range_excludes_records(self):
        """Date range that excludes all records — empty result.

        from_date=2026-01-01 → no records.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&from_date=2026-01-01"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"][0]["value"], 0)

    def test_empty_results_with_filters(self):
        """Valid form but filters match nothing — returns empty.

        Registration form filtered by non-matching administration.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.registration.id}"
            "&administration_id=99999"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # Either empty data array or single item with value=0
        if len(data["data"]) > 0:
            self.assertEqual(data["data"][0]["value"], 0)
        else:
            self.assertEqual(data["data"], [])
