from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class SiteProfileViewTests(VisualizationValuesTestMixin, APITestCase):
    BASE_URL = "/api/v1/visualization/site-profile"

    def _url(self, parent_id=None, query=""):
        target = self.reg1.id if parent_id is None else parent_id
        return f"{self.BASE_URL}/{target}{query}"

    def test_returns_site_profile_payload_for_parent_datapoint(self):
        response = self.client.get(
            self._url(
                query=(
                    f"?parent_form_id={self.registration.id}"
                    "&questions=measurement_value,operational_status"
                    "&history=measurement_value"
                    "&records=inspection_date,operational_status"
                )
            )
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["parent_id"], self.reg1.id)
        self.assertEqual(body["name"], self.reg1.name)

        self.assertEqual(
            body["latest"]["measurement_value"]["value"],
            20.0,
        )
        self.assertEqual(
            body["latest"]["operational_status"]["options"],
            ["active"],
        )

        self.assertEqual(
            [row["value"] for row in body["history"]["measurement_value"]],
            [10.0, 20.0],
        )

        self.assertEqual(
            [row["data_id"] for row in body["submissions"]],
            [self.mon1b.id, self.mon1a.id],
        )
        self.assertEqual(
            body["submissions"][0]["answers"]["operational_status"],
            ["active"],
        )

    def test_records_preserve_repeatable_answers_as_arrays(self):
        response = self.client.get(
            self._url(
                query=(
                    f"?parent_form_id={self.registration.id}"
                    "&records=test_result"
                )
            )
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(
            body["submissions"][0]["answers"]["test_result"],
            [8.0, 12.0, 4.0],
        )

    def test_requires_parent_form_id(self):
        response = self.client.get(self._url())

        self.assertEqual(response.status_code, 400)
        self.assertIn("parent_form_id", response.json()["message"])
