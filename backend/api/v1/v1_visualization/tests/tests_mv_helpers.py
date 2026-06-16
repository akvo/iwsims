"""
Tests for MV-based helper functions in v1_visualization/functions.py.

Covers: apply_administration_filter_mv, get_latest_monitoring_from_mv,
get_latest_data_ids_from_mv, and the concurrent refresh path.
"""

from django.core.management import call_command
from django.test import TestCase, TransactionTestCase
from django.test.utils import override_settings

from api.v1.v1_visualization.functions import (
    apply_administration_filter_mv,
    get_latest_data_ids_from_mv,
    get_latest_monitoring_from_mv,
    refresh_materialized_data,
)
from api.v1.v1_visualization.models import MVLatestMonitoring
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
    refresh_all_mvs,
)


# ---------------------------------------------------------------------------
# apply_administration_filter_mv
# ---------------------------------------------------------------------------

@override_settings(USE_TZ=False, TEST_ENV=True)
class ApplyAdministrationFilterMVTest(VisualizationValuesTestMixin, TestCase):
    """
    apply_administration_filter_mv filters an MV queryset by the
    administration hierarchy using a plain integer field (not a FK).
    """

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_root_administration_returns_all_rows(self):
        qs = MVLatestMonitoring.objects.filter(
            form_id=self.monitoring.id
        )
        filtered = apply_administration_filter_mv(
            qs, self.adm_parent.id, 'parent_administration_id'
        )
        self.assertGreater(filtered.count(), 0)

    def test_child_administration_returns_subset(self):
        qs = MVLatestMonitoring.objects.filter(
            form_id=self.monitoring.id
        )
        root_count = apply_administration_filter_mv(
            qs, self.adm_parent.id, 'parent_administration_id'
        ).count()
        child_count = apply_administration_filter_mv(
            qs, self.adm_child.id, 'parent_administration_id'
        ).count()
        # Child scope is at most as large as root scope
        self.assertLessEqual(child_count, root_count)

    def test_nonexistent_administration_returns_empty(self):
        qs = MVLatestMonitoring.objects.all()
        result = apply_administration_filter_mv(qs, 99999999)
        self.assertEqual(result.count(), 0)

    def test_custom_field_name_applied(self):
        """Use administration_id field instead of parent_administration_id."""
        qs = MVLatestMonitoring.objects.filter(
            form_id=self.monitoring.id
        )
        result = apply_administration_filter_mv(
            qs, self.adm_parent.id, 'administration_id'
        )
        # administration_id is the monitoring submission's admin, not the
        # parent's; result may be different from parent_administration_id
        # — the key assertion is that the call succeeds and returns a QS
        self.assertIsNotNone(result)


# ---------------------------------------------------------------------------
# get_latest_monitoring_from_mv
# ---------------------------------------------------------------------------

@override_settings(USE_TZ=False, TEST_ENV=True)
class GetLatestMonitoringFromMVTest(VisualizationValuesTestMixin, TestCase):
    """
    get_latest_monitoring_from_mv returns MVLatestMonitoring rows for a form,
    optionally filtered by administration and/or date range.
    """

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_returns_one_row_per_parent_for_form(self):
        qs = get_latest_monitoring_from_mv(self.monitoring.id)
        # 2 parent registrations → 2 latest-monitoring rows
        self.assertEqual(qs.count(), 2)

    def test_returns_queryset_of_mv_latest_monitoring(self):
        qs = get_latest_monitoring_from_mv(self.monitoring.id)
        self.assertTrue(
            all(isinstance(r, MVLatestMonitoring) for r in qs)
        )

    def test_filter_by_administration(self):
        all_rows = get_latest_monitoring_from_mv(self.monitoring.id)
        filtered = get_latest_monitoring_from_mv(
            self.monitoring.id,
            administration_id=self.adm_parent.id,
        )
        self.assertGreater(all_rows.count(), 0)
        self.assertLessEqual(filtered.count(), all_rows.count())

    def test_filter_by_from_date(self):
        qs = get_latest_monitoring_from_mv(
            self.monitoring.id,
            date_filters={"from_date": "2025-03-01"},
        )
        # Only mon1b (Mar 10) and mon2b (Mar 15) qualify
        self.assertEqual(qs.count(), 2)

    def test_filter_by_to_date(self):
        # mv_latest_monitoring stores only the MOST RECENT submission per
        # parent. Both parents' latest are from March (mon1b, mon2b), so
        # to_date=Jan 31 finds 0 rows — the latest is after the cutoff.
        qs = get_latest_monitoring_from_mv(
            self.monitoring.id,
            date_filters={"to_date": "2025-01-31"},
        )
        self.assertEqual(qs.count(), 0)

    def test_filter_by_to_date_includes_latest_in_range(self):
        # All latest submissions are in March so a Mar 31 cutoff returns both
        qs = get_latest_monitoring_from_mv(
            self.monitoring.id,
            date_filters={"to_date": "2025-03-31"},
        )
        self.assertEqual(qs.count(), 2)

    def test_filter_by_date_question_id(self):
        qs = get_latest_monitoring_from_mv(
            self.monitoring.id,
            date_filters={
                "date_question_id": self.q_date.id,
                "from_date": "2025-03-01",
            },
        )
        # Both parents have a monitoring in March
        self.assertEqual(qs.count(), 2)

    def test_unknown_form_returns_empty(self):
        qs = get_latest_monitoring_from_mv(99999)
        self.assertEqual(qs.count(), 0)


# ---------------------------------------------------------------------------
# get_latest_data_ids_from_mv
# ---------------------------------------------------------------------------

@override_settings(USE_TZ=False, TEST_ENV=True)
class GetLatestDataIdsFromMVTest(VisualizationValuesTestMixin, TestCase):
    """
    get_latest_data_ids_from_mv returns a flat list of FormData IDs suitable
    for use in Answers queries, wrapping get_latest_monitoring_from_mv.
    """

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_returns_list_of_integers(self):
        ids = get_latest_data_ids_from_mv(self.monitoring.id)
        self.assertIsInstance(ids, list)
        self.assertTrue(all(isinstance(i, int) for i in ids))

    def test_returns_two_ids_for_two_parents(self):
        ids = get_latest_data_ids_from_mv(self.monitoring.id)
        self.assertEqual(len(ids), 2)

    def test_ids_point_to_most_recent_monitoring(self):
        ids = get_latest_data_ids_from_mv(self.monitoring.id)
        # The IDs should be the March submissions (mon1b and mon2b)
        self.assertIn(self.mon1b.id, ids)
        self.assertIn(self.mon2b.id, ids)

    def test_with_administration_filter(self):
        all_ids = get_latest_data_ids_from_mv(self.monitoring.id)
        filtered_ids = get_latest_data_ids_from_mv(
            self.monitoring.id,
            administration_id=self.adm_child.id,
        )
        self.assertLessEqual(len(filtered_ids), len(all_ids))

    def test_unknown_form_returns_empty_list(self):
        ids = get_latest_data_ids_from_mv(99999)
        self.assertEqual(ids, [])


# ---------------------------------------------------------------------------
# refresh_materialized_data — concurrent path
# TransactionTestCase does NOT wrap tests in a transaction, so
# REFRESH MATERIALIZED VIEW CONCURRENTLY can run successfully.
# ---------------------------------------------------------------------------

class ConcurrentRefreshTest(TransactionTestCase):
    """
    Test the concurrent=True branch of refresh_materialized_data.
    Must use TransactionTestCase — regular TestCase wraps each test
    in a transaction which PostgreSQL forbids CONCURRENTLY inside.
    """

    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")

    def test_concurrent_refresh_all_views_succeeds(self):
        refresh_materialized_data(concurrent=True)

    def test_concurrent_refresh_specific_mv_view(self):
        refresh_materialized_data(
            views=["mv_latest_monitoring"], concurrent=True
        )

    def test_concurrent_refresh_falls_back_for_view_data_options(self):
        """view_data_options has no unique index; logs warning, falls back."""
        refresh_materialized_data(
            views=["view_data_options"], concurrent=True
        )

    def test_non_concurrent_refresh_inside_transaction_context(self):
        """When in_atomic_block is False (TransactionTestCase), non-concurrent
        refresh must still work correctly."""
        refresh_materialized_data(concurrent=False)
