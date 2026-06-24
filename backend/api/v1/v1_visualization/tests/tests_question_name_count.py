from datetime import datetime

from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_data.models import FormData
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
    refresh_all_mvs,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameCountTestCases(VisualizationValuesTestMixin, APITestCase):
    """Tests for card/KPI count mode on the question_name path.

    Uses VisualizationValuesTestMixin data:
    - reg1 latest (mon1b, Mar 2025): operational_status=active
    - reg2 latest (mon2b, Mar 2025): operational_status=pending
    Two parents total, each with one latest cross-form value.
    """

    def test_date_question_window_filters_on_answer_not_created(self):
        """For a date question (inspection_date), from_date/to_date bound the
        latest *answer* date, not the submission timestamp.

        A parent whose monitoring was submitted long ago (created 2020) but
        whose inspection_date answer is recent (2025-03-10) must be counted
        by a 2025 window — proving the filter uses the answer, not created.
        """
        reg3 = FormData.objects.create(
            name="Backdated Submission",
            form=self.registration,
            administration=self.adm_parent,
            created_by=self.user,
        )
        self._create_monitoring(
            parent=reg3,
            created_date=datetime(2020, 1, 1),
            date_val="2025-03-10T00:00:00.000Z",
        )
        refresh_all_mvs()

        response = self.client.get(
            f"{self.BASE_URL}?question_name=inspection_date"
            "&sum_by=parent_id&from_date=2025-01-01"
        )
        self.assertEqual(response.status_code, 200)
        # reg1 (answer 2025-03-10), reg2 (2025-03-15) and reg3 (2025-03-10):
        # all three answers are within the window. Created-based filtering
        # would have dropped reg3 (created 2020) → 2.
        self.assertEqual(response.json()["data"][0]["value"], 3)

    def _add_gap_registrations(self):
        """Add reg3 (monitored but no operational_status answer) and reg4
        (never monitored) to exercise the unanswered vs empty gaps."""
        from datetime import datetime

        reg3 = FormData.objects.create(
            name="Monitored No Answer",
            form=self.registration,
            administration=self.adm_parent,
            created_by=self.user,
        )
        # A monitoring child with a date but NO operational_status option.
        self._create_monitoring(
            parent=reg3,
            created_date=datetime(2025, 3, 20),
            date_val="2025-03-20T00:00:00.000Z",
        )
        FormData.objects.create(
            name="Never Monitored",
            form=self.registration,
            administration=self.adm_parent,
            created_by=self.user,
        )
        refresh_all_mvs()

    def test_include_unanswered_adds_no_answer_registrations(self):
        """include_unanswered counts registrations with no latest answer for
        the question — both monitored-but-skipped (reg3) and never-monitored
        (reg4)."""
        self._add_gap_registrations()
        base = (
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=active"
        )
        # reg1 active; reg2 pending; reg3/reg4 no answer.
        self.assertEqual(self.client.get(base).json()["data"][0]["value"], 1)
        # +reg3 (monitored, no answer) +reg4 (never monitored) = 3.
        self.assertEqual(
            self.client.get(f"{base}&include_unanswered=true")
            .json()["data"][0]["value"],
            3,
        )

    def test_include_empty_adds_only_never_monitored(self):
        """include_empty counts only the coverage gap — registrations with
        zero monitoring (reg4) — not reg3, which was monitored."""
        self._add_gap_registrations()
        base = (
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=active"
        )
        # +reg4 only (never monitored) = 2; reg3 (monitored) is excluded.
        self.assertEqual(
            self.client.get(f"{base}&include_empty=true")
            .json()["data"][0]["value"],
            2,
        )

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
