from datetime import datetime

from django.test.utils import override_settings
from django.utils.timezone import make_aware
from rest_framework.test import APITestCase

from api.v1.v1_data.models import Answers, FormData
from api.v1.v1_forms.models import (
    Questions,
    QuestionGroup,
    QuestionOptions,
    QuestionTypes,
)
from api.v1.v1_visualization.tests.mixins import (
    CrossFormTestBase,
    refresh_all_mvs,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameMonthTestCases(CrossFormTestBase, APITestCase):
    """group_by=month over the cross-form question_name path.

    The Compliance-Trend widget asks for a value per month across *all*
    monitoring submissions (not the latest per parent). That path reads
    mv_answer_denormalized via _values_by_qname_month. Topology: one
    registration form with one monitoring form carrying a number question
    ("bod_level") and an option question ("ohs_ok"); two plants each
    monitored in January and February 2025.
    """

    REG_FORM_ID = 9700
    MON_FORM_ID = 9701
    Q_NUM_ID = 970101
    Q_OPT_ID = 970102
    REG_A_ID = 9790
    REG_B_ID = 9791

    def add_question(self, form, group_id, q_id, name, qtype, options=None):
        grp = QuestionGroup.objects.create(
            id=group_id, form=form, name=f"grp_{q_id}", order=1,
        )
        question = Questions.objects.create(
            id=q_id, form=form, question_group=grp,
            name=name, label=name, type=qtype, order=1,
        )
        for idx, (value, label) in enumerate(options or []):
            QuestionOptions.objects.create(
                question=question, value=value, label=label, order=idx + 1,
            )
        return question

    def add_monitoring(self, data_id, name, mon_form, parent, created, rows):
        mon = FormData.objects.create(
            id=data_id, name=name, form=mon_form, parent=parent,
            administration=self.adm, created_by=self.user,
        )
        FormData.objects.filter(id=mon.id).update(created=make_aware(created))
        for question, kwargs in rows:
            Answers.objects.create(
                data=mon, question=question, created_by=self.user, **kwargs
            )
        return mon

    def setUp(self):
        super().setUp()
        self.init_admin_user("month_test@akvo.org")

        self.reg_form = self.make_reg_form(self.REG_FORM_ID, "Month Reg")
        self.mon_form = self.make_monitoring_form(
            self.MON_FORM_ID, "Month Mon", self.reg_form,
        )
        self.q_num = self.add_question(
            self.mon_form, 970110, self.Q_NUM_ID,
            "bod_level", QuestionTypes.number,
        )
        self.q_opt = self.add_question(
            self.mon_form, 970120, self.Q_OPT_ID, "ohs_ok",
            QuestionTypes.option, options=[("yes", "Yes"), ("no", "No")],
        )
        self.reg_a = self.make_registration(
            self.REG_A_ID, "Plant A", self.reg_form,
        )
        self.reg_b = self.make_registration(
            self.REG_B_ID, "Plant B", self.reg_form,
        )

        # Two plants, each monitored in Jan and Feb 2025.
        self.add_monitoring(
            97001, "A Jan", self.mon_form, self.reg_a, datetime(2025, 1, 15),
            [(self.q_num, {"value": 10.0}),
             (self.q_opt, {"options": ["yes"]})],
        )
        self.add_monitoring(
            97002, "A Feb", self.mon_form, self.reg_a, datetime(2025, 2, 15),
            [(self.q_num, {"value": 50.0}),
             (self.q_opt, {"options": ["no"]})],
        )
        self.add_monitoring(
            97003, "B Jan", self.mon_form, self.reg_b, datetime(2025, 1, 20),
            [(self.q_num, {"value": 30.0}),
             (self.q_opt, {"options": ["yes"]})],
        )
        self.add_monitoring(
            97004, "B Feb", self.mon_form, self.reg_b, datetime(2025, 2, 20),
            [(self.q_num, {"value": 20.0}),
             (self.q_opt, {"options": ["yes"]})],
        )
        refresh_all_mvs()

    def _get(self, query):
        return self.client.get(f"{self.BASE_URL}?{query}")

    def test_month_number_buckets_every_submission_by_parent(self):
        """Number question → one row per month, one column per plant.

        Both January and February appear (all submissions, not the
        latest-per-parent snapshot the cross-form MV would give).
        """
        response = self._get(
            "question_name=bod_level&group_by=month&stack_by=parent_id"
            f"&parent_form_id={self.REG_FORM_ID}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        by_month = {r["month"]: r for r in data}
        self.assertEqual(set(by_month), {"Jan 2025", "Feb 2025"})

        a, b = str(self.REG_A_ID), str(self.REG_B_ID)
        self.assertEqual(by_month["Jan 2025"][a], 10.0)
        self.assertEqual(by_month["Jan 2025"][b], 30.0)
        self.assertEqual(by_month["Feb 2025"][a], 50.0)
        self.assertEqual(by_month["Feb 2025"][b], 20.0)
        # Each row carries the YYYY-MM group key the frontend buckets on.
        self.assertEqual(by_month["Jan 2025"]["group"], "2025-01")

    def test_month_option_counts_by_option_label(self):
        """Option question → per-month counts keyed by option label."""
        response = self._get(
            "question_name=ohs_ok&group_by=month&stack_by=option"
            f"&parent_form_id={self.REG_FORM_ID}"
        )
        self.assertEqual(response.status_code, 200)
        by_month = {r["month"]: r for r in response.json()["data"]}
        self.assertEqual(set(by_month), {"Jan 2025", "Feb 2025"})
        self.assertEqual(by_month["Jan 2025"]["Yes"], 2)
        self.assertEqual(by_month["Jan 2025"]["No"], 0)
        self.assertEqual(by_month["Feb 2025"]["Yes"], 1)
        self.assertEqual(by_month["Feb 2025"]["No"], 1)

    def test_month_window_from_date_excludes_earlier_month(self):
        """from_date trims months before the window."""
        response = self._get(
            "question_name=bod_level&group_by=month&stack_by=parent_id"
            f"&parent_form_id={self.REG_FORM_ID}&from_date=2025-02-01"
        )
        self.assertEqual(response.status_code, 200)
        months = {r["month"] for r in response.json()["data"]}
        self.assertEqual(months, {"Feb 2025"})

    def test_month_scoped_to_parent_form_family(self):
        """parent_form_id keeps another family's same-named question out."""
        other_reg = self.make_reg_form(9710, "Other Reg")
        other_mon = self.make_monitoring_form(9711, "Other Mon", other_reg)
        other_q = self.add_question(
            other_mon, 971110, 971101, "bod_level", QuestionTypes.number,
        )
        other_plant = self.make_registration(9795, "Other Plant", other_reg)
        self.add_monitoring(
            97005, "Other Jan", other_mon, other_plant,
            datetime(2025, 1, 15), [(other_q, {"value": 999.0})],
        )
        refresh_all_mvs()

        response = self._get(
            "question_name=bod_level&group_by=month&stack_by=parent_id"
            f"&parent_form_id={self.REG_FORM_ID}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        for row in data:
            self.assertNotIn("9795", row)
        self.assertEqual(
            {r["month"] for r in data}, {"Jan 2025", "Feb 2025"}
        )
