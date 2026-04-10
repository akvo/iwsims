from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesCountTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test count mode (no question_id) for /visualization/values."""

    def test_count_total_registration(self):
        """Count registration records — no group_by, no question_id.

        Expected: 2 registration records total.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.registration.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("data", data)
        self.assertIn("labels", data)
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["value"], 2)
        self.assertEqual(data["data"][0]["label"], "Total")

    def test_count_total_monitoring(self):
        """Count monitoring records — 4 total monitoring submissions.

        Expected: 4 monitoring records.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"][0]["value"], 4)

    def test_count_group_by_month(self):
        """Count monitoring records grouped by month.

        Setup: 2 in Jan 2025, 2 in Mar 2025.
        Expected: 2 groups with counts.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&group_by=month"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)
        # Verify groups exist
        groups = {d["group"] for d in data["data"]}
        self.assertIn("2025-01", groups)
        self.assertIn("2025-03", groups)
        # Verify counts
        jan = next(d for d in data["data"] if d["group"] == "2025-01")
        mar = next(d for d in data["data"] if d["group"] == "2025-03")
        self.assertEqual(jan["value"], 2)
        self.assertEqual(mar["value"], 2)

    def test_count_group_by_parent_id(self):
        """Count monitoring records per parent registration.

        Expected: 2 parents, each with 2 monitoring records.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)
        for d in data["data"]:
            self.assertEqual(d["value"], 2)

    def test_count_with_administration_filter(self):
        """Filter by administration — only records in hierarchy.

        reg1 is in adm_parent, reg2 is in adm_child.
        Filtering by adm_child should return only reg2's monitoring.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # Only reg2's 2 monitoring records are in adm_child
        self.assertEqual(data["data"][0]["value"], 2)

    def test_count_monitoring_latest_percentage(self):
        """Count with value_type=percentage.

        monitoring=latest&sum_by=parent_id&value_type=percentage.
        2 parents monitored out of 2 total = 100%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&monitoring=latest&sum_by=parent_id"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"][0]["value"], 100.0)

    def test_count_monitoring_latest_sum_by_parent(self):
        """Count unique parents with latest monitoring.

        monitoring=latest&sum_by=parent_id.
        Expected: 2 (both parents have at least one monitoring).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&monitoring=latest&sum_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"][0]["value"], 2)

    def test_count_by_month_with_date_range_and_date_question(self):
        """Inspections per month filtered by date range and date question.

        Covers: "Inspections [District A] [between 23-04-2023 - 23-06-2023]
        per Month over Last Year" from dashboard design.

        Params: group_by=month, date_question_id (inspection_date),
        from_date, to_date, administration_id.

        Test data dates (from inspection_date answers):
        - mon1a: 2025-01-15 (adm_parent)
        - mon1b: 2025-03-10 (adm_parent)
        - mon2a: 2025-01-20 (adm_child)
        - mon2b: 2025-03-15 (adm_child)

        Filter: from_date=2025-01-01, to_date=2025-01-31
        Expected: Jan only → 2 records (mon1a + mon2a).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&group_by=month"
            f"&date_question_id={self.Q_DATE_ID}"
            "&from_date=2025-01-01&to_date=2025-01-31"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["group"], "2025-01")
        self.assertEqual(data["data"][0]["value"], 2)

    def test_count_by_month_with_date_range_and_admin_filter(self):
        """Inspections per month with admin + date filter combined.

        Covers: filtering by both district and time period.

        Filter: adm_child only + full date range.
        Expected: 2 months, but only adm_child records:
        - Jan: mon2a (1 record)
        - Mar: mon2b (1 record)
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&group_by=month"
            f"&date_question_id={self.Q_DATE_ID}"
            f"&administration_id={self.adm_child.id}"
            "&from_date=2025-01-01&to_date=2025-12-31"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)
        groups = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(groups["2025-01"], 1)
        self.assertEqual(groups["2025-03"], 1)

    def test_count_by_month_with_date_range_no_results(self):
        """Date range that has no inspections — empty months.

        Filter: from_date=2025-06-01, to_date=2025-06-30.
        No monitoring records in June.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&group_by=month"
            f"&date_question_id={self.Q_DATE_ID}"
            "&from_date=2025-06-01&to_date=2025-06-30"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 0)
        self.assertEqual(data["labels"], [])

    def test_option_percentage_by_group_latest(self):
        """Option percentage grouped by option, latest monitoring.

        Latest monitoring answers:
        - reg1 (mon1b): operational_status = active
        - reg2 (mon2b): operational_status = pending

        Total parents with latest monitoring: 2.
        Expected: active=50%, pending=50%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=option&monitoring=latest"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["active"], 50.0)
        self.assertEqual(values_by_group["pending"], 50.0)

    def test_option_percentage_by_group_all(self):
        """Option percentage grouped by option, all monitoring.

        All 4 monitoring answers:
        - mon1a: active, mon1b: active, mon2a: inactive, mon2b: pending

        Total: 4 records.
        Expected: active=50%, inactive=25%, pending=25%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=option&monitoring=all"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["active"], 50.0)
        self.assertEqual(values_by_group["inactive"], 25.0)
        self.assertEqual(values_by_group["pending"], 25.0)

    def test_option_percentage_with_date_filter(self):
        """Option percentage filtered by date range.

        from_date=2025-03-01 (only Mar records).
        Mar monitoring: mon1b=active, mon2b=pending.
        Total in range: 2.
        Expected: active=50%, pending=50%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=option&monitoring=all"
            "&value_type=percentage"
            "&from_date=2025-03-01"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["active"], 50.0)
        self.assertEqual(values_by_group["pending"], 50.0)
        self.assertNotIn("inactive", values_by_group)

    def test_option_percentage_with_admin_filter(self):
        """Option percentage filtered by administration.

        reg2 is registered in adm_child. Monitoring data inherits
        administration from its parent registration.
        mon2a=inactive, mon2b=pending (both in adm_child).
        Total in admin: 2.
        Expected: inactive=50%, pending=50%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=option&monitoring=all"
            "&value_type=percentage"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["inactive"], 50.0)
        self.assertEqual(values_by_group["pending"], 50.0)
        self.assertNotIn("active", values_by_group)
