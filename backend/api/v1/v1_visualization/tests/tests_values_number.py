from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesNumberTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test number question handling for /visualization/values.

    Test data (from mixin setUp):
    - reg1 (Site Alpha):
        - mon1a (Jan): number=10, repeatable=[5, 15]
        - mon1b (Mar, latest): number=20, repeatable=[8, 12, 4]
    - reg2 (Site Beta):
        - mon2a (Jan): number=30, repeatable=[10, 20]
        - mon2b (Mar, latest): number=40, repeatable=[25, 35]
    """

    def test_number_no_grouping(self):
        """Number question without group_by — single aggregate of all.

        All 4 monitoring values: 10, 20, 30, 40.
        Default aggregate (no group_by) returns single value.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        # Single aggregate — could be sum or average depending on impl
        self.assertIsNotNone(data["data"][0]["value"])

    def test_number_group_by_parent_id_latest(self):
        """Number question grouped by parent, latest monitoring only.

        Latest for reg1: mon1b → number=20
        Latest for reg2: mon2b → number=40
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number.id}"
            "&group_by=parent_id&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)

        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_label["Site Alpha"], 20.0)
        self.assertEqual(values_by_label["Site Beta"], 40.0)

    def test_number_group_by_parent_id_all(self):
        """Number question grouped by parent, all monitoring.

        reg1: mon1a=10, mon1b=20 → depends on aggregation
        reg2: mon2a=30, mon2b=40 → depends on aggregation
        Should return all values (4 total).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number.id}"
            "&group_by=parent_id&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # With monitoring=all, values should be aggregated per parent
        self.assertEqual(len(data["data"]), 2)

    def test_number_group_by_month(self):
        """Number question grouped by month.

        Jan 2025: mon1a=10, mon2a=30
        Mar 2025: mon1b=20, mon2b=40
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number.id}"
            "&group_by=month"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)
        groups = {d["group"] for d in data["data"]}
        self.assertIn("2025-01", groups)
        self.assertIn("2025-03", groups)

    def test_number_repeat_agg_average(self):
        """Repeatable number question — average aggregation (default).

        Latest for reg1 (mon1b): repeatable=[8, 12, 4] → avg=8.0
        Latest for reg2 (mon2b): repeatable=[25, 35] → avg=30.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number_repeat.id}"
            "&group_by=parent_id&monitoring=latest&repeat_agg=average"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)

        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_label["Site Alpha"], 8.0)
        self.assertEqual(values_by_label["Site Beta"], 30.0)

    def test_number_repeat_agg_sum(self):
        """Repeatable number question — sum aggregation.

        Latest for reg1 (mon1b): [8, 12, 4] → sum=24.0
        Latest for reg2 (mon2b): [25, 35] → sum=60.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number_repeat.id}"
            "&group_by=parent_id&monitoring=latest&repeat_agg=sum"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_label["Site Alpha"], 24.0)
        self.assertEqual(values_by_label["Site Beta"], 60.0)

    def test_number_repeat_agg_max(self):
        """Repeatable number question — max aggregation.

        Latest for reg1 (mon1b): [8, 12, 4] → max=12.0
        Latest for reg2 (mon2b): [25, 35] → max=35.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number_repeat.id}"
            "&group_by=parent_id&monitoring=latest&repeat_agg=max"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_label["Site Alpha"], 12.0)
        self.assertEqual(values_by_label["Site Beta"], 35.0)

    def test_number_repeat_agg_min(self):
        """Repeatable number question — min aggregation.

        Latest for reg1 (mon1b): [8, 12, 4] → min=4.0
        Latest for reg2 (mon2b): [25, 35] → min=25.0
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number_repeat.id}"
            "&group_by=parent_id&monitoring=latest&repeat_agg=min"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_label["Site Alpha"], 4.0)
        self.assertEqual(values_by_label["Site Beta"], 25.0)

    def test_number_percentage_group_by_parent(self):
        """Number question with value_type=percentage, grouped by parent.

        Covers: "what percentage does each site contribute to the total?"

        Latest monitoring values:
        - reg1 (mon1b): measurement_value = 20.0
        - reg2 (mon2b): measurement_value = 40.0
        Total = 60.0

        Expected: Site Alpha = 33.33%, Site Beta = 66.67%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number.id}"
            "&group_by=parent_id&monitoring=latest"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)

        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertAlmostEqual(
            values_by_label["Site Alpha"], 33.33, places=2
        )
        self.assertAlmostEqual(
            values_by_label["Site Beta"], 66.67, places=2
        )

    def test_number_percentage_repeat_agg_average(self):
        """Repeatable number percentage with average aggregation.

        Covers: "what percentage does each site's average test result
        contribute to the total?"

        Latest monitoring repeatable values:
        - reg1 (mon1b): [8, 12, 4] → avg = 8.0
        - reg2 (mon2b): [25, 35] → avg = 30.0
        Total = 38.0

        Expected: Site Alpha = 21.05%, Site Beta = 78.95%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number_repeat.id}"
            "&group_by=parent_id&monitoring=latest"
            "&repeat_agg=average&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)

        values_by_label = {d["label"]: d["value"] for d in data["data"]}
        self.assertAlmostEqual(
            values_by_label["Site Alpha"], 21.05, places=2
        )
        self.assertAlmostEqual(
            values_by_label["Site Beta"], 78.95, places=2
        )

    def test_number_percentage_group_by_month(self):
        """Number question percentage grouped by month.

        All monitoring values by month:
        - Jan 2025: mon1a=10, mon2a=30 → total 40
        - Mar 2025: mon1b=20, mon2b=40 → total 60
        Grand total = 100.

        Expected: Jan=40%, Mar=60%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_number.id}"
            "&group_by=month&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 2)

        values_by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values_by_group["2025-01"], 40.0)
        self.assertEqual(values_by_group["2025-03"], 60.0)
