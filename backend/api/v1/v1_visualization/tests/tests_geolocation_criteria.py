from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_data.models import Answers
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class GeolocationCriteriaTestCases(
    VisualizationValuesTestMixin, APITestCase
):
    """Test criteria filter on /maps/geolocation/{form_id}."""

    BASE_URL = "/api/v1/maps/geolocation"

    def setUp(self):
        super().setUp()
        # Add an option answer on the registration form for reg1
        # (Site Alpha) so we have something to filter against.
        Answers.objects.create(
            data=self.reg1,
            question=self.q_reg_option,
            options=["type_a"],
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.reg2,
            question=self.q_reg_option,
            options=["type_b"],
            created_by=self.user,
        )

    def test_criteria_narrows_map_results(self):
        response = self.client.get(
            f"{self.BASE_URL}/{self.registration.id}"
            "?criteria=option_equals"
            f":{self.q_reg_option.id}:type_a"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        names = [row["name"] for row in data]
        self.assertEqual(names, ["Site Alpha"])

    def test_criteria_malformed_returns_200_empty(self):
        """Serializer invalid → view returns empty (existing behavior)."""
        response = self.client.get(
            f"{self.BASE_URL}/{self.registration.id}"
            "?criteria=bogus:1:2"
        )
        # GeoLocationFilterSerializer.is_valid() failure returns [] 200.
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_no_criteria_returns_all(self):
        response = self.client.get(
            f"{self.BASE_URL}/{self.registration.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        names = sorted(row["name"] for row in data)
        self.assertEqual(names, ["Site Alpha", "Site Beta"])
