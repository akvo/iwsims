from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameCountTestCases(VisualizationValuesTestMixin, APITestCase):
    """Tests for card/KPI count mode on the question_name path.

    Uses VisualizationValuesTestMixin data:
    - reg1 latest (mon1b, Mar 2025): operational_status=active
    - reg2 latest (mon2b, Mar 2025): operational_status=pending
    Two parents total, each with one latest cross-form value.
    """

    def test_sum_by_parent_id_counts_distinct_parents(self):
        """sum_by=parent_id returns a single total parent count."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["value"], 2)
        self.assertEqual(data[0]["group"], "total")

    def test_option_value_counts_matching_parents(self):
        """option_value narrows the count to matching parents."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=active"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["value"], 1)
        self.assertEqual(data[0]["group"], "active")

    def test_option_value_without_sum_by_triggers_count(self):
        """option_value alone is enough to switch to count mode."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&option_value=pending"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["value"], 1)

    def test_option_value_no_match_returns_zero(self):
        """A value no parent has selected counts zero (not empty)."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=inactive"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data[0]["value"], 0)

    def test_option_value_percentage_of_answered_parents(self):
        """value_type=percentage divides matched by total answered."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=active&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertAlmostEqual(data[0]["value"], 50.0, places=1)

    def test_count_respects_administration_filter(self):
        """administration_id scopes the parent count."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            f"&sum_by=parent_id&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        # Only reg2 is in adm_child
        self.assertEqual(response.json()["data"][0]["value"], 1)

    def test_rolling_months_wide_window_includes_all(self):
        """A wide rolling window keeps every parent."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&rolling_months=120"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 2)

    def test_rolling_months_narrow_window_excludes_old(self):
        """A 1-month window excludes the 2025 fixture submissions."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&rolling_months=1"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 0)

    def test_date_window_includes_matching_range(self):
        """from_date/to_date bound the count by latest answer date."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&from_date=2025-01-01&to_date=2025-12-31"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 2)

    def test_date_window_excludes_out_of_range(self):
        """from_date after the fixture dates yields zero parents."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&from_date=2025-04-01"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 0)
