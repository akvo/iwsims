from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameTextTestCases(VisualizationValuesTestMixin, APITestCase):
    """Tests for text/date question_name rows used by ranking widgets."""

    def test_date_question_rows_use_parent_names_as_labels(self):
        response = self.client.get(
            f"{self.BASE_URL}?question_name=inspection_date"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)

        by_group = {
            row["group"]: row
            for row in response.json()["data"]
        }
        self.assertEqual(by_group[str(self.reg1.id)]["label"], self.reg1.name)
        self.assertEqual(by_group[str(self.reg2.id)]["label"], self.reg2.name)
        self.assertEqual(
            by_group[str(self.reg1.id)]["value"],
            "2025-03-10T00:00:00.000Z",
        )
