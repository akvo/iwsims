from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesOptionTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test option/multiple_option handling for /visualization/values.

    Test data (from mixin setUp):
    - reg1:
        - mon1a (Jan): option=active, multi=[feature_x, feature_y]
        - mon1b (Mar, latest): option=active, multi=[feature_y, feature_z]
    - reg2:
        - mon2a (Jan): option=inactive, multi=[feature_x, feature_z]
        - mon2b (Mar, latest): option=pending,
          multi=[feature_x, feature_y, feature_z]
    """

    def test_option_group_by_option_all(self):
        """Option question group_by=option, monitoring=all.

        All 4 monitoring: active(2), inactive(1), pending(1).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 3)

        values_by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(values_by_group["active"]["value"], 2)
        self.assertEqual(values_by_group["active"]["color"], "#64A73B")
        self.assertEqual(values_by_group["inactive"]["value"], 1)
        self.assertEqual(values_by_group["inactive"]["color"], "#e41a1c")
        self.assertEqual(values_by_group["pending"]["value"], 1)
        self.assertEqual(values_by_group["pending"]["color"], "#ff7f00")

    def test_option_group_by_option_latest(self):
        """Option question group_by=option, monitoring=latest.

        Latest: reg1→active, reg2→pending.
        Expected: active(1), pending(1), inactive(0) — all options
        present so pie/doughnut charts have stable legends and colors.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        values_by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(values_by_group["active"]["value"], 1)
        self.assertEqual(values_by_group["pending"]["value"], 1)
        # Zero-count options MUST be present for chart stability
        self.assertIn("inactive", values_by_group)
        self.assertEqual(values_by_group["inactive"]["value"], 0)
        self.assertEqual(
            values_by_group["inactive"]["color"], "#e41a1c"
        )

    def test_option_group_by_option_all_options_in_labels(self):
        """All defined options must appear in data and labels array.

        Even with monitoring=latest where "inactive" has 0 records,
        the labels array must list all 3 options so the frontend
        pie chart renders a complete legend.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 3)
        groups = {d["group"] for d in data["data"]}
        self.assertEqual(groups, {"active", "inactive", "pending"})
        labels = set(data["labels"])
        self.assertEqual(labels, {"Active", "Inactive", "Pending"})

    def test_option_group_by_option_empty_dataset(self):
        """No matching records — still return all options with value=0.

        Filter by a date range with no monitoring records. All 3
        operational_status options must appear with value=0 so the
        frontend can render an empty-but-labeled pie chart.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=all"
            "&from_date=2020-01-01&to_date=2020-12-31"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 3)
        for row in data["data"]:
            self.assertEqual(row["value"], 0)
        groups = {d["group"] for d in data["data"]}
        self.assertEqual(groups, {"active", "inactive", "pending"})

    def test_option_group_by_option_percentage_zero_count(self):
        """Percentage mode must include zero-count options as 0.0.

        Latest monitoring: active=50%, pending=50%, inactive=0%.
        All 3 must be in the response.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_group = {
            d["group"]: d["value"] for d in data["data"]
        }
        self.assertEqual(len(data["data"]), 3)
        self.assertEqual(values_by_group["active"], 50.0)
        self.assertEqual(values_by_group["pending"], 50.0)
        self.assertEqual(values_by_group["inactive"], 0.0)

    def test_multiple_option_group_by_option(self):
        """Multiple option question group_by=option, monitoring=all.

        All 4 monitoring multi selections:
        - mon1a: [feature_x, feature_y]
        - mon1b: [feature_y, feature_z]
        - mon2a: [feature_x, feature_z]
        - mon2b: [feature_x, feature_y, feature_z]
        Counts: feature_x=3, feature_y=3, feature_z=3
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_multi.id}"
            "&group_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 3)

        values_by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(values_by_group["feature_x"]["value"], 3)
        self.assertEqual(values_by_group["feature_y"]["value"], 3)
        self.assertEqual(values_by_group["feature_z"]["value"], 3)

    def test_option_value_count(self):
        """Filter by option_value with sum_by=parent_id.

        option_value=active, monitoring=latest.
        Latest: reg1→active, reg2→pending.
        Count of parents with active: 1.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=active&sum_by=parent_id&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["value"], 1)

    def test_option_value_percentage(self):
        """Filter by option_value with value_type=percentage.

        option_value=active, monitoring=latest, value_type=percentage.
        1 out of 2 parents = 50%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=active&sum_by=parent_id"
            "&monitoring=latest&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["value"], 50.0)
