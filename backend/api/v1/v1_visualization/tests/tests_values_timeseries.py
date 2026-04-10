from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesTimeseriesTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test time series (group_by=date) for line charts.

    Test data (from mixin setUp):
    - reg1 (Site Alpha, adm_parent):
        - mon1a: created=2025-01-15, date_answer=2025-01-15,
          measurement=10.0, repeatable=[5, 15]
        - mon1b: created=2025-03-10, date_answer=2025-03-10,
          measurement=20.0, repeatable=[8, 12, 4]
    - reg2 (Site Beta, adm_child):
        - mon2a: created=2025-01-20, date_answer=2025-01-20,
          measurement=30.0, repeatable=[10, 20]
        - mon2b: created=2025-03-15, date_answer=2025-03-15,
          measurement=40.0, repeatable=[25, 35]
    """

    # -- Single line: group_by=date --

    def test_timeseries_number_by_date(self):
        """Number question grouped by date — single line chart.

        All monitoring values plotted by FormData.created date.
        Expected: 4 data points, one per monitoring record.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            "&group_by=date&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 4)
        groups = sorted([d["group"] for d in data["data"]])
        self.assertEqual(groups, [
            "2025-01-15", "2025-01-20", "2025-03-10", "2025-03-15",
        ])

    def test_timeseries_number_by_date_with_date_question(self):
        """Number question grouped by date using date_question_id.

        Uses inspection_date answer instead of FormData.created.
        Should produce the same dates since our test data matches.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            f"&date_question_id={self.Q_DATE_ID}"
            "&group_by=date&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 4)
        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["2025-01-15"], 10.0)
        self.assertEqual(values_by_group["2025-01-20"], 30.0)
        self.assertEqual(values_by_group["2025-03-10"], 20.0)
        self.assertEqual(values_by_group["2025-03-15"], 40.0)

    def test_timeseries_with_date_range_filter(self):
        """Time series filtered by date range.

        from_date=2025-03-01 → only Mar records.
        Expected: 2 data points.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            f"&date_question_id={self.Q_DATE_ID}"
            "&group_by=date&monitoring=all"
            "&from_date=2025-03-01"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["2025-03-10"], 20.0)
        self.assertEqual(values_by_group["2025-03-15"], 40.0)

    def test_timeseries_with_admin_filter(self):
        """Time series filtered by administration.

        reg2 is registered in adm_child. Monitoring data inherits
        administration from its parent registration.
        Expected: only mon2a and mon2b.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            "&group_by=date&monitoring=all"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["2025-01-20"], 30.0)
        self.assertEqual(values_by_group["2025-03-15"], 40.0)

    def test_timeseries_repeatable_with_repeat_agg(self):
        """Time series with repeatable question using repeat_agg.

        Repeatable values per monitoring:
        - mon1a (2025-01-15): [5, 15] → avg=10.0
        - mon1b (2025-03-10): [8, 12, 4] → avg=8.0
        - mon2a (2025-01-20): [10, 20] → avg=15.0
        - mon2b (2025-03-15): [25, 35] → avg=30.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_REPEAT_ID}"
            "&group_by=date&monitoring=all"
            "&repeat_agg=average"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 4)
        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["2025-01-15"], 10.0)
        self.assertAlmostEqual(values_by_group["2025-03-10"], 8.0)
        self.assertEqual(values_by_group["2025-01-20"], 15.0)
        self.assertEqual(values_by_group["2025-03-15"], 30.0)

    # -- Multi-line: group_by=date + stack_by=parent_id --

    def test_timeseries_multiline_by_parent(self):
        """Multi-line chart: number per site over time.

        group_by=date, stack_by=parent_id.
        Each parent becomes a column in the response.

        Expected data points:
        - 2025-01-15: Site Alpha=10.0, Site Beta=null
        - 2025-01-20: Site Alpha=null, Site Beta=30.0
        - 2025-03-10: Site Alpha=20.0, Site Beta=null
        - 2025-03-15: Site Alpha=null, Site Beta=40.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            "&group_by=date&stack_by=parent_id&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIn("data", data)
        self.assertIn("labels", data)
        self.assertIn("stack_labels", data)

        self.assertEqual(len(data["data"]), 4)
        self.assertCountEqual(
            data["stack_labels"],
            ["Site Alpha", "Site Beta"],
        )

        # Find each date row
        rows = {list(d.values())[0]: d for d in data["data"]}

        self.assertEqual(rows["2025-01-15"]["Site Alpha"], 10.0)
        self.assertIsNone(rows["2025-01-15"].get("Site Beta"))
        self.assertIsNone(rows["2025-01-20"].get("Site Alpha"))
        self.assertEqual(rows["2025-01-20"]["Site Beta"], 30.0)
        self.assertEqual(rows["2025-03-10"]["Site Alpha"], 20.0)
        self.assertIsNone(rows["2025-03-10"].get("Site Beta"))
        self.assertIsNone(rows["2025-03-15"].get("Site Alpha"))
        self.assertEqual(rows["2025-03-15"]["Site Beta"], 40.0)

    def test_timeseries_multiline_by_month(self):
        """Multi-line chart: number per site over months.

        group_by=month, stack_by=parent_id.
        Values aggregated per month per parent.

        Jan: Site Alpha=10.0 (mon1a), Site Beta=30.0 (mon2a)
        Mar: Site Alpha=20.0 (mon1b), Site Beta=40.0 (mon2b)
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            "&group_by=month&stack_by=parent_id&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        self.assertCountEqual(
            data["stack_labels"],
            ["Site Alpha", "Site Beta"],
        )

        jan = next(
            d for d in data["data"]
            if "2025-01" in str(d.values())
        )
        mar = next(
            d for d in data["data"]
            if "2025-03" in str(d.values())
        )

        self.assertEqual(jan["Site Alpha"], 10.0)
        self.assertEqual(jan["Site Beta"], 30.0)
        self.assertEqual(mar["Site Alpha"], 20.0)
        self.assertEqual(mar["Site Beta"], 40.0)

    def test_timeseries_multiline_with_date_filter(self):
        """Multi-line chart filtered by date range.

        from_date=2025-03-01 → only Mar records.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            "&group_by=date&stack_by=parent_id&monitoring=all"
            "&from_date=2025-03-01"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        rows = {list(d.values())[0]: d for d in data["data"]}
        self.assertEqual(rows["2025-03-10"]["Site Alpha"], 20.0)
        self.assertEqual(rows["2025-03-15"]["Site Beta"], 40.0)

    def test_timeseries_multiline_with_admin_filter(self):
        """Multi-line chart filtered by administration.

        reg2 is registered in adm_child.
        Expected: only Site Beta data.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_ID}"
            "&group_by=date&stack_by=parent_id&monitoring=all"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        self.assertEqual(data["stack_labels"], ["Site Beta"])

        for row in data["data"]:
            self.assertNotIn("Site Alpha", row)
            self.assertIn("Site Beta", row)

    def test_timeseries_multiline_repeatable_average(self):
        """Multi-line chart with repeatable question, repeat_agg=average.

        Repeatable averages per site per date:
        - 2025-01-15: Site Alpha avg([5,15])=10.0
        - 2025-01-20: Site Beta avg([10,20])=15.0
        - 2025-03-10: Site Alpha avg([8,12,4])=8.0
        - 2025-03-15: Site Beta avg([25,35])=30.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_NUMBER_REPEAT_ID}"
            "&group_by=date&stack_by=parent_id&monitoring=all"
            "&repeat_agg=average"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 4)
        rows = {list(d.values())[0]: d for d in data["data"]}

        self.assertEqual(rows["2025-01-15"]["Site Alpha"], 10.0)
        self.assertAlmostEqual(rows["2025-03-10"]["Site Alpha"], 8.0)
        self.assertEqual(rows["2025-01-20"]["Site Beta"], 15.0)
        self.assertEqual(rows["2025-03-15"]["Site Beta"], 30.0)
