from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_data.models import FormData
from api.v1.v1_visualization.models import (
    MVAnswerDenormalized,
    MVCrossFormLatest,
    MVLatestMonitoring,
    MVParentAggregates,
)
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
    refresh_all_mvs,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class DeletedDatapointsTestCase(VisualizationValuesTestMixin, APITestCase):
    """Soft-deleted datapoints must not survive in the dashboard views.

    `data.deleted_at` is what the default FormData manager filters on, so a
    datapoint deleted in the UI vanishes everywhere — except, before this was
    fixed, the four materialized views the dashboards are built on. They
    filtered is_pending and is_draft but never deleted_at, which inflated every
    count and compliance denominator and could make a site's "latest" answers
    come from a submission somebody had deleted.
    """

    BASE_URL = "/api/v1/visualization/values"

    def _mv_state(self):
        return {
            "answers": set(
                MVAnswerDenormalized.objects.values_list("data_id", flat=True)
            ),
            "latest": set(
                MVLatestMonitoring.objects.values_list(
                    "latest_data_id", flat=True
                )
            ),
            "cross_form": set(
                MVCrossFormLatest.objects.values_list("parent_id", flat=True)
            ),
            "aggregates": set(
                MVParentAggregates.objects.values_list("parent_id", flat=True)
            ),
        }

    def test_deleting_a_monitoring_row_removes_it_from_every_view(self):
        monitoring = FormData.objects.filter(
            parent__isnull=False,
        ).order_by("id").first()
        before = self._mv_state()
        self.assertIn(monitoring.id, before["answers"])

        monitoring.delete()
        refresh_all_mvs()
        after = self._mv_state()

        self.assertNotIn(monitoring.id, after["answers"])
        self.assertNotIn(monitoring.id, after["latest"])

    def test_deleting_a_site_removes_its_monitoring_history_too(self):
        # Deleting a registration must retire everything recorded under it;
        # leaving the children behind would keep the site in every count while
        # it no longer exists.
        parent = FormData.objects.filter(parent__isnull=True).order_by(
            "id"
        ).first()
        children = list(
            FormData.objects.filter(parent=parent).values_list("id", flat=True)
        )
        self.assertGreater(len(children), 0)

        before = self._mv_state()
        self.assertIn(parent.id, before["cross_form"])

        parent.delete()
        refresh_all_mvs()
        after = self._mv_state()

        self.assertNotIn(parent.id, after["cross_form"])
        self.assertNotIn(parent.id, after["aggregates"])
        for child in children:
            self.assertNotIn(child, after["answers"])
            self.assertNotIn(child, after["latest"])

    def test_deleted_sites_leave_the_values_endpoint(self):
        # The count a dashboard card shows must drop when a site is deleted.
        url = (
            f"{self.BASE_URL}?question_name=operational_status"
            f"&parent_form_id={self.REGISTRATION_FORM_ID}"
            "&group_by=parent_id&monitoring=latest"
        )
        before = self.client.get(url).json()["data"]
        self.assertGreater(len(before), 0)

        parent = FormData.objects.filter(parent__isnull=True).order_by(
            "id"
        ).first()
        parent.delete()
        refresh_all_mvs()

        after = self.client.get(url).json()["data"]
        self.assertEqual(len(after), len(before) - 1)
        self.assertNotIn(parent.id, [row["group"] for row in after])

    def test_live_datapoints_are_untouched(self):
        # The filter must remove only deleted rows — a view that dropped live
        # data would be a worse bug than the one it fixes.
        before = self._mv_state()
        refresh_all_mvs()
        self.assertEqual(self._mv_state(), before)

    def test_restoring_a_site_brings_it_back(self):
        parent = FormData.objects.filter(parent__isnull=True).order_by(
            "id"
        ).first()
        parent.delete()
        refresh_all_mvs()
        self.assertNotIn(parent.id, self._mv_state()["cross_form"])

        FormData.objects_deleted.filter(id=parent.id).restore()
        refresh_all_mvs()
        self.assertIn(parent.id, self._mv_state()["cross_form"])
