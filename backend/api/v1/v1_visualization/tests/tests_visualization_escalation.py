from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class EscalationTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test /visualization/escalation/{form_id} endpoint.

    Uses query-param-driven criteria and columns.

    Test data (from mixin setUp):
    - reg1 (Site Alpha, adm_parent):
        - mon1b (latest): operational_status=active,
          measurement=20.0, features=[feature_y, feature_z]
    - reg2 (Site Beta, adm_child):
        - mon2b (latest): operational_status=pending,
          measurement=40.0, features=[feature_x, feature_y, feature_z]
    """

    BASE_ESC_URL = "/api/v1/visualization/escalation"

    # -- Error cases --

    def test_missing_monitoring_form_id(self):
        """monitoring_form_id is required — returns 400."""
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            "?criteria=option_equals:600203:inactive"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_criteria(self):
        """criteria is required — returns 400."""
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_columns(self):
        """columns is required — returns 400."""
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            "&criteria=option_equals:600203:inactive"
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_form_id(self):
        """Non-existent form_id — returns 404."""
        response = self.client.get(
            f"{self.BASE_ESC_URL}/99999"
            f"?monitoring_form_id={self.monitoring.id}"
            "&criteria=option_equals:600203:inactive"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 404)

    # -- option_equals criteria --

    def test_option_equals_single_match(self):
        """Escalation with option_equals criteria — single match.

        criteria=option_equals:600203:pending (operational_status)
        Latest: reg1→active, reg2→pending.
        Expected: only reg2 (Site Beta).
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:pending"
            "&columns=name:parent_name,status:answer:"
            f"{self.Q_OPTION_ID}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["count"], 1)
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["name"], "Site Beta")
        self.assertEqual(data["results"][0]["status"], "pending")

    def test_option_equals_multiple_criteria_or(self):
        """Multiple criteria with OR logic.

        criteria=option_equals:600203:active,option_equals:600203:pending
        Latest: reg1→active, reg2→pending.
        Expected: both match (OR logic).
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:active"
            f",option_equals:{self.Q_OPTION_ID}:pending"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 2)

    def test_option_equals_no_match(self):
        """Criteria that matches nothing — empty results.

        criteria=option_equals:600203:inactive
        Latest: reg1→active, reg2→pending. No inactive.
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:inactive"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])

    # -- threshold criteria --

    def test_threshold_gt_criteria(self):
        """Threshold greater-than criteria.

        criteria=threshold_gt:600202:25 (measurement > 25)
        Latest: reg1→20.0, reg2→40.0.
        Expected: only reg2.
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=threshold_gt:{self.Q_NUMBER_ID}:25"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["name"], "Site Beta")

    def test_threshold_lt_criteria(self):
        """Threshold less-than criteria.

        criteria=threshold_lt:600202:25 (measurement < 25)
        Latest: reg1→20.0, reg2→40.0.
        Expected: only reg1.
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=threshold_lt:{self.Q_NUMBER_ID}:25"
            "&columns=name:parent_name"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["name"], "Site Alpha")

    # -- Dynamic columns --

    def test_columns_parent_name_and_administration(self):
        """Dynamic columns: parent_name + administration."""
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:pending"
            "&columns=name:parent_name,location:administration"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        result = data["results"][0]
        self.assertIn("name", result)
        self.assertIn("location", result)
        self.assertEqual(result["name"], "Site Beta")
        self.assertIsNotNone(result["location"])

    def test_columns_answer_and_latest_date(self):
        """Dynamic columns: answer value + latest_date."""
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:active"
            f"&columns=name:parent_name"
            f",status:answer:{self.Q_OPTION_ID}"
            f",last_visit:latest_date:{self.Q_DATE_ID}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        result = data["results"][0]
        self.assertEqual(result["name"], "Site Alpha")
        self.assertEqual(result["status"], "active")
        self.assertIn("last_visit", result)

    # -- Pagination --

    def test_pagination(self):
        """Pagination with page_size=1.

        Both match, but page_size=1 returns only 1 result.
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:active"
            f",option_equals:{self.Q_OPTION_ID}:pending"
            "&columns=name:parent_name"
            "&page=1&page_size=1"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["count"], 2)
        self.assertEqual(len(data["results"]), 1)
        self.assertIsNotNone(data["next"])

    # -- Filters --

    def test_administration_filter(self):
        """Escalation filtered by administration.

        reg2 is in adm_child. Criteria matches both,
        but admin filter limits to adm_child.
        """
        response = self.client.get(
            f"{self.BASE_ESC_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:active"
            f",option_equals:{self.Q_OPTION_ID}:pending"
            "&columns=name:parent_name"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["name"], "Site Beta")
