from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesStackTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test stack_by parameter for stacked charts.

    Test data (from mixin setUp):
    - reg1 (adm_parent):
        - mon1a (Jan 2025): operational_status=active,
          features=[feature_x, feature_y]
        - mon1b (Mar 2025): operational_status=active,
          features=[feature_y, feature_z]
    - reg2 (adm_child):
        - mon2a (Jan 2025): operational_status=inactive,
          features=[feature_x, feature_z]
        - mon2b (Mar 2025): operational_status=pending,
          features=[feature_x, feature_y, feature_z]
    """

    def test_stack_by_option_group_by_month(self):
        """Operational status stacked by option, grouped by month.

        Jan 2025: active=1, inactive=1, pending=0
        Mar 2025: active=1, inactive=0, pending=1

        Response should have option labels as columns.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=month&stack_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIn("data", data)
        self.assertIn("labels", data)
        self.assertIn("stack_labels", data)
        self.assertIn("colors", data)

        self.assertEqual(len(data["data"]), 2)

        # Verify stack_labels contains all option labels
        self.assertCountEqual(
            data["stack_labels"],
            ["Active", "Inactive", "Pending"],
        )

        # Verify colors from QuestionOptions
        self.assertCountEqual(
            data["colors"],
            ["#64A73B", "#e41a1c", "#ff7f00"],
        )

        # Verify data rows — each row has month + option counts
        jan = next(
            d for d in data["data"]
            if "2025-01" in str(d.values())
        )
        mar = next(
            d for d in data["data"]
            if "2025-03" in str(d.values())
        )

        self.assertEqual(jan["Active"], 1)
        self.assertEqual(jan["Inactive"], 1)
        self.assertEqual(jan["Pending"], 0)
        self.assertEqual(mar["Active"], 1)
        self.assertEqual(mar["Inactive"], 0)
        self.assertEqual(mar["Pending"], 1)

    def test_stack_by_option_group_by_parent_id(self):
        """Operational status stacked by option, grouped by parent.

        reg1 (all monitoring): active=2, inactive=0, pending=0
        reg2 (all monitoring): active=0, inactive=1, pending=1
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=parent_id&stack_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        self.assertIn("stack_labels", data)

        rows_by_label = {
            list(d.values())[0]: d
            for d in data["data"]
        }

        alpha = rows_by_label.get("Site Alpha")
        beta = rows_by_label.get("Site Beta")

        self.assertIsNotNone(alpha)
        self.assertIsNotNone(beta)

        self.assertEqual(alpha["Active"], 2)
        self.assertEqual(alpha["Inactive"], 0)
        self.assertEqual(alpha["Pending"], 0)
        self.assertEqual(beta["Active"], 0)
        self.assertEqual(beta["Inactive"], 1)
        self.assertEqual(beta["Pending"], 1)

    def test_stack_by_option_group_by_month_latest(self):
        """Stacked chart with monitoring=latest.

        Latest: reg1→active (Mar), reg2→pending (Mar).
        Both latest are in Mar.
        Expected: only Mar row with active=1, pending=1.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=month&stack_by=option&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        # Only 1 month (Mar) since both latest are in March
        self.assertEqual(len(data["data"]), 1)
        mar = data["data"][0]
        self.assertEqual(mar["Active"], 1)
        self.assertEqual(mar["Pending"], 1)

    def test_stack_by_option_multiple_option_question(self):
        """Multiple option question stacked by option, grouped by month.

        Each selected option is counted separately.
        Jan: feature_x=2, feature_y=1, feature_z=1
          (mon1a=[x,y], mon2a=[x,z])
        Mar: feature_x=1, feature_y=2, feature_z=2
          (mon1b=[y,z], mon2b=[x,y,z])
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_MULTI_ID}"
            "&group_by=month&stack_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)
        self.assertCountEqual(
            data["stack_labels"],
            ["Feature X", "Feature Y", "Feature Z"],
        )

        jan = next(
            d for d in data["data"]
            if "2025-01" in str(d.values())
        )
        mar = next(
            d for d in data["data"]
            if "2025-03" in str(d.values())
        )

        self.assertEqual(jan["Feature X"], 2)
        self.assertEqual(jan["Feature Y"], 1)
        self.assertEqual(jan["Feature Z"], 1)
        self.assertEqual(mar["Feature X"], 1)
        self.assertEqual(mar["Feature Y"], 2)
        self.assertEqual(mar["Feature Z"], 2)

    def test_stack_by_option_with_date_filter(self):
        """Stacked chart filtered by date range.

        from_date=2025-03-01 → only Mar records.
        Mar: mon1b=active, mon2b=pending.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=month&stack_by=option&monitoring=all"
            "&from_date=2025-03-01"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 1)
        mar = data["data"][0]
        self.assertEqual(mar["Active"], 1)
        self.assertEqual(mar["Pending"], 1)

    def test_stack_by_option_with_admin_filter(self):
        """Stacked chart filtered by administration.

        reg2 is registered in adm_child. Monitoring data inherits
        administration from its parent registration.
        mon2a (Jan)=inactive, mon2b (Mar)=pending.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=month&stack_by=option&monitoring=all"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)

        jan = next(
            d for d in data["data"]
            if "2025-01" in str(d.values())
        )
        mar = next(
            d for d in data["data"]
            if "2025-03" in str(d.values())
        )

        self.assertEqual(jan["Inactive"], 1)
        self.assertNotIn("Active", jan)
        self.assertEqual(mar["Pending"], 1)
        self.assertNotIn("Active", mar)

    def test_stack_by_option_percentage(self):
        """Stacked chart with value_type=percentage.

        All monitoring, group_by=month, stack_by=option.
        Jan: active=1, inactive=1 → total=2 → active=50%, inactive=50%
        Mar: active=1, pending=1 → total=2 → active=50%, pending=50%
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=month&stack_by=option&monitoring=all"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 2)

        jan = next(
            d for d in data["data"]
            if "2025-01" in str(d.values())
        )
        mar = next(
            d for d in data["data"]
            if "2025-03" in str(d.values())
        )

        self.assertEqual(jan["Active"], 50.0)
        self.assertEqual(jan["Inactive"], 50.0)
        self.assertEqual(mar["Active"], 50.0)
        self.assertEqual(mar["Pending"], 50.0)

    def test_stack_by_requires_group_by(self):
        """stack_by without group_by — returns 400."""
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&stack_by=option"
        )
        self.assertEqual(response.status_code, 400)

    def test_stack_by_requires_question_id(self):
        """stack_by without question_id — returns 400."""
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&group_by=month&stack_by=option"
        )
        self.assertEqual(response.status_code, 400)

    def test_stack_by_invalid_value(self):
        """Invalid stack_by value — returns 400."""
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.Q_OPTION_ID}"
            "&group_by=month&stack_by=invalid"
        )
        self.assertEqual(response.status_code, 400)
