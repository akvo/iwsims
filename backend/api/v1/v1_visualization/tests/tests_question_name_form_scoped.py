from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameFormScopedTestCases(
    VisualizationValuesTestMixin, APITestCase
):
    """form_id + question_name routes to the rich form-scoped handlers
    (not the global cross-form path).

    Discriminator: with monitoring=all the rich handler counts every
    monitoring submission, whereas the global path only ever returns the
    latest value per parent.

    Mixin monitoring options (operational_status):
      mon1a=active, mon1b=active, mon2a=inactive, mon2b=pending
    Rich + monitoring=all  → active:2, inactive:1, pending:1
    Global (latest only)   → active:1, pending:1
    """

    def test_form_scoped_name_uses_rich_handler_monitoring_all(self):
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&question_name=operational_status"
            "&group_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {
            d["group"]: d["value"] for d in response.json()["data"]
        }
        # Rich form-scoped path counts ALL submissions, not latest-only.
        self.assertEqual(by_group.get("active"), 2)
        self.assertEqual(by_group.get("inactive"), 1)
        self.assertEqual(by_group.get("pending"), 1)

    def test_form_scoped_name_unknown_on_form_returns_400(self):
        """A question_name not on the given form is rejected."""
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&question_name=not_a_real_question_on_this_form"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 400)

    def test_numeric_question_name_rejected(self):
        """A digits-only question_name is a 400 (Part A guard)."""
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_name={self.Q_OPTION_ID}"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 400)
