from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
    refresh_all_mvs,
)
from api.v1.v1_visualization.models import (
    MVLatestMonitoring,
    MVAnswerDenormalized,
    MVCrossFormLatest,
    MVParentAggregates,
)
from api.v1.v1_forms.constants import QuestionTypes


@override_settings(USE_TZ=False, TEST_ENV=True)
class MVLatestMonitoringTest(VisualizationValuesTestMixin, TestCase):

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_one_row_per_parent_form_pair(self):
        rows = MVLatestMonitoring.objects.filter(
            parent_id=self.reg1.id,
            form_id=self.monitoring.id,
        )
        self.assertEqual(rows.count(), 1)

    def test_latest_data_id_points_to_most_recent_monitoring(self):
        row = MVLatestMonitoring.objects.get(
            parent_id=self.reg1.id,
            form_id=self.monitoring.id,
        )
        # mon1b (March) is newer than mon1a (January)
        self.assertEqual(row.latest_data_id, self.mon1b.id)

    def test_filter_by_administration(self):
        rows = MVLatestMonitoring.objects.filter(
            form_id=self.monitoring.id,
            parent_administration_id=self.adm_parent.id,
        )
        self.assertGreater(rows.count(), 0)
        for row in rows:
            self.assertEqual(row.parent_administration_id, self.adm_parent.id)

    def test_only_monitoring_records_appear(self):
        # Registrations have no parent_id so they must not appear
        from api.v1.v1_data.models import FormData
        data_ids = list(
            MVLatestMonitoring.objects.values_list('latest_data_id', flat=True)
        )
        self.assertGreater(len(data_ids), 0)
        for data_id in data_ids:
            data = FormData.objects.get(pk=data_id)
            self.assertIsNotNone(data.parent_id)

    def test_total_row_count_equals_unique_parent_form_pairs(self):
        total = MVLatestMonitoring.objects.count()
        # 2 parents × 1 monitoring form = 2 rows
        self.assertEqual(total, 2)


@override_settings(USE_TZ=False, TEST_ENV=True)
class MVAnswerDenormalizedTest(VisualizationValuesTestMixin, TestCase):

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_contains_monitoring_answers(self):
        rows = MVAnswerDenormalized.objects.filter(
            form_id=self.monitoring.id,
        )
        self.assertGreater(rows.count(), 0)

    def test_question_name_populated(self):
        rows = MVAnswerDenormalized.objects.filter(
            form_id=self.monitoring.id,
            question_id=self.q_number.id,
        )
        self.assertGreater(rows.count(), 0)
        for row in rows:
            self.assertEqual(row.question_name, self.q_number.name)

    def test_question_type_populated(self):
        rows = MVAnswerDenormalized.objects.filter(
            question_id=self.q_number.id,
        )
        self.assertGreater(rows.count(), 0)
        for row in rows:
            self.assertEqual(row.question_type, QuestionTypes.number)

    def test_numeric_answer_value_stored(self):
        rows = MVAnswerDenormalized.objects.filter(
            data_id=self.mon1a.id,
            question_id=self.q_number.id,
        )
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.first().answer_value, 10.0)

    def test_option_answer_stored_in_answer_options(self):
        rows = MVAnswerDenormalized.objects.filter(
            data_id=self.mon1a.id,
            question_id=self.q_option.id,
        )
        self.assertEqual(rows.count(), 1)
        self.assertIn("active", rows.first().answer_options)

    def test_filter_by_option_contains(self):
        rows = MVAnswerDenormalized.objects.filter(
            question_id=self.q_option.id,
            answer_options__contains=["active"],
        )
        self.assertGreater(rows.count(), 0)

    def test_parent_id_set_for_monitoring_answers(self):
        rows = MVAnswerDenormalized.objects.filter(
            form_id=self.monitoring.id,
        )
        for row in rows:
            self.assertIsNotNone(row.parent_id)

    def test_no_pending_or_draft_records(self):
        from api.v1.v1_data.models import FormData
        data_ids = MVAnswerDenormalized.objects.values_list(
            'data_id', flat=True
        ).distinct()
        for data_id in data_ids:
            data = FormData.objects.filter(pk=data_id).first()
            if data:
                self.assertFalse(data.is_pending)
                self.assertFalse(data.is_draft)


@override_settings(USE_TZ=False, TEST_ENV=True)
class MVCrossFormLatestTest(VisualizationValuesTestMixin, TestCase):

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_one_row_per_parent_question_name(self):
        rows = MVCrossFormLatest.objects.filter(
            parent_id=self.reg1.id,
            question_name=self.q_number.name,
        )
        self.assertEqual(rows.count(), 1)

    def test_returns_most_recent_value_across_forms(self):
        row = MVCrossFormLatest.objects.get(
            parent_id=self.reg1.id,
            question_name=self.q_number.name,
        )
        # mon1b (March, value=20.0) is newer than mon1a (January, value=10.0)
        self.assertEqual(row.latest_numeric_value, 20.0)

    def test_filter_by_question_name(self):
        rows = MVCrossFormLatest.objects.filter(
            question_name=self.q_option.name,
        )
        self.assertGreater(rows.count(), 0)
        for row in rows:
            self.assertEqual(row.question_name, self.q_option.name)

    def test_filter_by_option_contains(self):
        rows = MVCrossFormLatest.objects.filter(
            question_name=self.q_option.name,
            latest_option_values__contains=["active"],
        )
        self.assertGreater(rows.count(), 0)

    def test_administration_id_populated(self):
        rows = MVCrossFormLatest.objects.filter(
            parent_id=self.reg1.id,
        )
        self.assertGreater(rows.count(), 0)
        for row in rows:
            self.assertIsNotNone(row.administration_id)


@override_settings(USE_TZ=False, TEST_ENV=True)
class MVParentAggregatesTest(VisualizationValuesTestMixin, TestCase):

    def setUp(self):
        super().setUp()
        refresh_all_mvs()

    def test_rows_exist_for_monitoring_form(self):
        rows = MVParentAggregates.objects.filter(
            form_id=self.monitoring.id,
        )
        self.assertGreater(rows.count(), 0)

    def test_option_values_populated_for_option_questions(self):
        rows = MVParentAggregates.objects.filter(
            form_id=self.monitoring.id,
            question_id=self.q_option.id,
            parent_id=self.reg1.id,
        )
        self.assertEqual(rows.count(), 1)
        row = rows.first()
        self.assertIsNotNone(row.option_values)
        self.assertIn("active", row.option_values)

    def test_avg_value_populated_for_number_questions(self):
        rows = MVParentAggregates.objects.filter(
            form_id=self.monitoring.id,
            question_id=self.q_number.id,
            parent_id=self.reg1.id,
        )
        self.assertEqual(rows.count(), 1)
        row = rows.first()
        self.assertIsNotNone(row.avg_value)
        self.assertEqual(row.avg_value, 20.0)  # latest monitoring only (mon1b)

    def test_filter_by_option_contains(self):
        rows = MVParentAggregates.objects.filter(
            question_id=self.q_multi.id,
            option_values__contains=["feature_x"],
        )
        self.assertGreater(rows.count(), 0)

    def test_answer_count_is_positive(self):
        rows = MVParentAggregates.objects.filter(
            form_id=self.monitoring.id,
        )
        for row in rows:
            self.assertGreater(row.answer_count, 0)
