from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameNumberTestCases(VisualizationValuesTestMixin, APITestCase):
    """Tests for /visualization/values?question_name= with number questions.

    measurement_value question (name="measurement_value"):
    - reg1 latest (mon1b): value=20.0
    - reg2 latest (mon2b): value=40.0
    Average = 30.0
    """

    def test_number_default_returns_average(self):
        """Without group_by, returns average across all parents."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=measurement_value"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertAlmostEqual(data[0]["value"], 30.0, places=1)
        self.assertEqual(data[0]["group"], "total")

    def test_number_group_by_parent_id(self):
        """group_by=parent_id returns latest value per parent."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=measurement_value"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 2)
        by_group = {d["group"]: d["value"] for d in data}
        self.assertAlmostEqual(
            by_group[str(self.reg1.id)], 20.0, places=1
        )
        self.assertAlmostEqual(
            by_group[str(self.reg2.id)], 40.0, places=1
        )

    def test_number_group_by_parent_id_label_is_name(self):
        """group_by=parent_id uses FormData.name as label."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=measurement_value"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        labels = {d["group"]: d["label"] for d in response.json()["data"]}
        self.assertEqual(labels[str(self.reg1.id)], self.reg1.name)
        self.assertEqual(labels[str(self.reg2.id)], self.reg2.name)

    def test_number_percentage_sums_to_100(self):
        """value_type=percentage: each share of the total."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=measurement_value"
            "&group_by=parent_id&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        total = sum(d["value"] for d in response.json()["data"])
        self.assertAlmostEqual(total, 100.0, places=1)
