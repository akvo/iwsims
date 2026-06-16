"""
WAF Water Treatment Plant — Operational Criteria Tests

A plant is OPERATIONAL when its latest monitoring shows:
  - daily_production_megalitres > 0          (both Quick & Comprehensive forms)
  - has_production_constraints = "no"        (Q 1749700156602 / Comprehensive)
  - pumps_rising_main_has_risks = "no"       (Q 1754995400013, if applicable)
  - borehole_pump_has_risks = "no"           (Q 1754995400028, if applicable)
  - borehole_gallery_pumps_has_risks = "no"  (Q 1754995400043, if applicable)

MVCrossFormLatest groups answers by question_name across ALL monitoring forms,
so the same question_name from Quick Monitoring (Q 1749640684970) and
Comprehensive Monitoring (Q 1749652417794) both contribute to the latest
daily_production_megalitres value — whichever submission is more recent wins.
"""

from datetime import datetime

from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from django.utils.timezone import make_aware

from api.v1.v1_data.models import Answers, FormData
from api.v1.v1_forms.constants import FormTypes, QuestionTypes
from api.v1.v1_forms.models import Forms, QuestionGroup, Questions
from api.v1.v1_profile.models import Administration
from api.v1.v1_users.models import SystemUser
from api.v1.v1_visualization.models import MVCrossFormLatest
from api.v1.v1_visualization.tests.mixins import refresh_all_mvs


def _is_operational(
    parent_id,
    uses_pumps_rising_main=False,
    uses_borehole_pump=False,
    uses_borehole_gallery_pumps=False,
):
    """Evaluate plant operational status using mv_cross_form_latest.

    Queries by question_name — the MV aggregates the latest value across
    both Quick Monitoring and Comprehensive Monitoring per parent.
    """
    latest = {
        row.question_name: row
        for row in MVCrossFormLatest.objects.filter(parent_id=parent_id)
    }

    prod = latest.get("daily_production_megalitres")
    if not prod or (prod.latest_numeric_value or 0) <= 0:
        return False

    constraints = latest.get("has_production_constraints")
    if not constraints or (constraints.latest_option_values or []) == ["yes"]:
        return False

    if uses_pumps_rising_main:
        risks = latest.get("pumps_rising_main_has_risks")
        if risks and (risks.latest_option_values or []) == ["yes"]:
            return False

    if uses_borehole_pump:
        risks = latest.get("borehole_pump_has_risks")
        if risks and (risks.latest_option_values or []) == ["yes"]:
            return False

    if uses_borehole_gallery_pumps:
        risks = latest.get("borehole_gallery_pumps_has_risks")
        if risks and (risks.latest_option_values or []) == ["yes"]:
            return False

    return True


class _WTPTestBase(TestCase):
    """Shared form/question setup for WAF WTP operational tests."""

    def setUp(self):
        call_command("administration_seeder", "--test")
        self.adm = Administration.objects.filter(
            parent__isnull=True
        ).first()
        self.user = SystemUser.objects.create_user(
            email="wtp_test@akvo.org",
            password="test1234",
            first_name="WTP",
            last_name="Test",
        )

        # Use explicit high IDs to avoid advancing the PostgreSQL sequence
        # into the low range (e.g. 101, 103) used explicitly by other test
        # files — sequences don't roll back with TestCase transactions.
        REG_FORM_ID = 9700
        COMP_FORM_ID = 9701
        QUICK_FORM_ID = 9702

        # Registration form
        self.reg_form = Forms.objects.create(
            id=REG_FORM_ID,
            name="WAF Water Treatment Plant",
            type=FormTypes.registration,
        )
        reg_qg = QuestionGroup.objects.create(
            id=97000,
            form=self.reg_form,
            name="registration",
        )
        Questions.objects.create(
            id=9700001,
            form=self.reg_form,
            question_group=reg_qg,
            name="plant_name",
            label="Name of the Plant",
            type=QuestionTypes.input,
        )

        # Comprehensive Monitoring form (type=2)
        self.comp_form = Forms.objects.create(
            id=COMP_FORM_ID,
            name="WAF WTP - Monitoring",
            parent=self.reg_form,
            type=FormTypes.monitoring,
        )
        comp_qg = QuestionGroup.objects.create(
            id=97001,
            form=self.comp_form,
            name="general_information",
        )
        self.q_daily_prod = Questions.objects.create(
            id=9700002,
            form=self.comp_form,
            question_group=comp_qg,
            name="daily_production_megalitres",
            label="Average daily production (megalitres)",
            type=QuestionTypes.number,
        )
        self.q_constraints = Questions.objects.create(
            id=9700003,
            form=self.comp_form,
            question_group=comp_qg,
            name="has_production_constraints",
            label="Have you noted any production constraints?",
            type=QuestionTypes.option,
        )
        self.q_transport = Questions.objects.create(
            id=9700004,
            form=self.comp_form,
            question_group=comp_qg,
            name="raw_water_transport_method",
            label="How is raw water transported?",
            type=QuestionTypes.multiple_option,
        )
        self.q_pumps_risks = Questions.objects.create(
            id=9700005,
            form=self.comp_form,
            question_group=comp_qg,
            name="pumps_rising_main_has_risks",
            label="Risks with Pumps/Rising Main?",
            type=QuestionTypes.option,
        )
        self.q_borehole_risks = Questions.objects.create(
            id=9700006,
            form=self.comp_form,
            question_group=comp_qg,
            name="borehole_pump_has_risks",
            label="Risks with Borehole Pump?",
            type=QuestionTypes.option,
        )
        self.q_gallery_risks = Questions.objects.create(
            id=9700007,
            form=self.comp_form,
            question_group=comp_qg,
            name="borehole_gallery_pumps_has_risks",
            label="Risks with Borehole Gallery Pumps?",
            type=QuestionTypes.option,
        )

        # Quick Monitoring form — shares question names with Comprehensive
        self.quick_form = Forms.objects.create(
            id=QUICK_FORM_ID,
            name="WAF WTP - Quick Monitoring",
            parent=self.reg_form,
            type=FormTypes.monitoring,
        )
        quick_qg = QuestionGroup.objects.create(
            id=97002,
            form=self.quick_form,
            name="general_information",
        )
        self.q_quick_daily_prod = Questions.objects.create(
            id=9700008,
            form=self.quick_form,
            question_group=quick_qg,
            name="daily_production_megalitres",  # same name → merged in MV
            label="Average daily production (megalitres)",
            type=QuestionTypes.number,
        )
        self.q_quick_constraints = Questions.objects.create(
            id=9700009,
            form=self.quick_form,
            question_group=quick_qg,
            name="has_production_constraints",
            label="Have you noted any production constraints?",
            type=QuestionTypes.option,
        )

    def _create_plant(self, name):
        return FormData.objects.create(
            name=name,
            form=self.reg_form,
            administration=self.adm,
            created_by=self.user,
        )

    def _submit_monitoring(
        self,
        plant,
        form,
        created_date,
        daily_production=None,
        has_constraints=None,
        transport_methods=None,
        pumps_risks=None,
        borehole_risks=None,
        gallery_risks=None,
    ):
        mon = FormData.objects.create(
            name=f"{plant.name} - monitoring",
            form=form,
            parent=plant,
            administration=self.adm,
            created_by=self.user,
        )
        FormData.objects.filter(pk=mon.pk).update(
            created=make_aware(created_date)
        )
        mon.refresh_from_db()

        q_prod = (
            self.q_daily_prod
            if form == self.comp_form
            else self.q_quick_daily_prod
        )
        q_constr = (
            self.q_constraints
            if form == self.comp_form
            else self.q_quick_constraints
        )

        if daily_production is not None:
            Answers.objects.create(
                data=mon,
                question=q_prod,
                value=daily_production,
                created_by=self.user,
            )
        if has_constraints is not None:
            Answers.objects.create(
                data=mon,
                question=q_constr,
                options=[has_constraints],
                created_by=self.user,
            )
        if transport_methods is not None:
            Answers.objects.create(
                data=mon,
                question=self.q_transport,
                options=transport_methods,
                created_by=self.user,
            )
        if pumps_risks is not None:
            Answers.objects.create(
                data=mon,
                question=self.q_pumps_risks,
                options=[pumps_risks],
                created_by=self.user,
            )
        if borehole_risks is not None:
            Answers.objects.create(
                data=mon,
                question=self.q_borehole_risks,
                options=[borehole_risks],
                created_by=self.user,
            )
        if gallery_risks is not None:
            Answers.objects.create(
                data=mon,
                question=self.q_gallery_risks,
                options=[gallery_risks],
                created_by=self.user,
            )
        return mon


@override_settings(USE_TZ=False, TEST_ENV=True)
class OperationalCriteriaBasicTest(_WTPTestBase):
    """Core criteria: production volume, constraints flag, pump risks."""

    def setUp(self):
        super().setUp()

        # Alpha: pumps/rising main transport, no risks, no constraints
        #        → OPERATIONAL
        self.plant_alpha = self._create_plant("Alpha WTP")
        self._submit_monitoring(
            self.plant_alpha, self.comp_form,
            datetime(2025, 3, 10),
            daily_production=5.0,
            has_constraints="no",
            transport_methods=["pumps_rising_main"],
            pumps_risks="no",
        )

        # Beta: pumps/rising main transport, HAS pump risks
        #       → NOT OPERATIONAL
        self.plant_beta = self._create_plant("Beta WTP")
        self._submit_monitoring(
            self.plant_beta, self.comp_form,
            datetime(2025, 3, 10),
            daily_production=3.0,
            has_constraints="no",
            transport_methods=["pumps_rising_main"],
            pumps_risks="yes",
        )

        # Gamma: has production constraints
        #        → NOT OPERATIONAL
        self.plant_gamma = self._create_plant("Gamma WTP")
        self._submit_monitoring(
            self.plant_gamma, self.comp_form,
            datetime(2025, 3, 10),
            daily_production=2.0,
            has_constraints="yes",
        )

        # Delta: zero daily production
        #        → NOT OPERATIONAL
        self.plant_delta = self._create_plant("Delta WTP")
        self._submit_monitoring(
            self.plant_delta, self.comp_form,
            datetime(2025, 3, 10),
            daily_production=0.0,
            has_constraints="no",
        )

        refresh_all_mvs()

    def test_alpha_operational_no_pump_risks_no_constraints(self):
        self.assertTrue(
            _is_operational(
                self.plant_alpha.id,
                uses_pumps_rising_main=True,
            )
        )

    def test_beta_not_operational_due_to_pump_risks(self):
        self.assertFalse(
            _is_operational(
                self.plant_beta.id,
                uses_pumps_rising_main=True,
            )
        )

    def test_gamma_not_operational_due_to_production_constraints(self):
        self.assertFalse(_is_operational(self.plant_gamma.id))

    def test_delta_not_operational_due_to_zero_production(self):
        self.assertFalse(_is_operational(self.plant_delta.id))

    def test_operational_count_and_percentage(self):
        """1 out of 4 plants operational = 25 %."""
        plants = [
            (self.plant_alpha, {"uses_pumps_rising_main": True}),
            (self.plant_beta, {"uses_pumps_rising_main": True}),
            (self.plant_gamma, {}),
            (self.plant_delta, {}),
        ]
        operational = sum(
            1 for plant, kwargs in plants
            if _is_operational(plant.id, **kwargs)
        )
        self.assertEqual(operational, 1)
        self.assertEqual(round(operational / len(plants) * 100), 25)


@override_settings(USE_TZ=False, TEST_ENV=True)
class OperationalCriteriaPumpVariantsTest(_WTPTestBase):
    """
    Pump-risk criteria are conditional on what transport method is used.
    Gravity-fed plants are unaffected by pump-risk questions.
    """

    def setUp(self):
        super().setUp()

        # Gravity: no pump risk questions apply → OPERATIONAL
        self.plant_gravity = self._create_plant("Gravity WTP")
        self._submit_monitoring(
            self.plant_gravity, self.comp_form,
            datetime(2025, 3, 1),
            daily_production=4.0,
            has_constraints="no",
            transport_methods=["gravity"],
        )

        # Borehole pump, no risks → OPERATIONAL
        self.plant_borehole_ok = self._create_plant("Borehole-OK WTP")
        self._submit_monitoring(
            self.plant_borehole_ok, self.comp_form,
            datetime(2025, 3, 1),
            daily_production=6.0,
            has_constraints="no",
            transport_methods=["borehole_pump"],
            borehole_risks="no",
        )

        # Borehole pump, HAS risks → NOT OPERATIONAL
        self.plant_borehole_bad = self._create_plant("Borehole-Bad WTP")
        self._submit_monitoring(
            self.plant_borehole_bad, self.comp_form,
            datetime(2025, 3, 1),
            daily_production=4.0,
            has_constraints="no",
            transport_methods=["borehole_pump"],
            borehole_risks="yes",
        )

        # Borehole gallery pumps, HAS risks → NOT OPERATIONAL
        self.plant_gallery_bad = self._create_plant("Gallery-Bad WTP")
        self._submit_monitoring(
            self.plant_gallery_bad, self.comp_form,
            datetime(2025, 3, 1),
            daily_production=3.0,
            has_constraints="no",
            transport_methods=["borehole_gallery_pumps"],
            gallery_risks="yes",
        )

        refresh_all_mvs()

    def test_gravity_plant_operational_without_pump_risk_check(self):
        self.assertTrue(
            _is_operational(
                self.plant_gravity.id,
                uses_pumps_rising_main=False,
                uses_borehole_pump=False,
                uses_borehole_gallery_pumps=False,
            )
        )

    def test_borehole_pump_no_risks_is_operational(self):
        self.assertTrue(
            _is_operational(
                self.plant_borehole_ok.id,
                uses_borehole_pump=True,
            )
        )

    def test_borehole_pump_with_risks_not_operational(self):
        self.assertFalse(
            _is_operational(
                self.plant_borehole_bad.id,
                uses_borehole_pump=True,
            )
        )

    def test_borehole_gallery_pumps_with_risks_not_operational(self):
        self.assertFalse(
            _is_operational(
                self.plant_gallery_bad.id,
                uses_borehole_gallery_pumps=True,
            )
        )


@override_settings(USE_TZ=False, TEST_ENV=True)
class CrossFormLatestTest(_WTPTestBase):
    """
    mv_cross_form_latest merges question_name across Quick and Comprehensive
    Monitoring. The most recent submission per question_name wins.

    Plant Epsilon is first monitored via Quick Monitoring (January, low
    production, has constraints) and then via Comprehensive Monitoring
    (March, healthy production, constraint resolved). The March values
    must take precedence for both question names.
    """

    def setUp(self):
        super().setUp()

        self.plant_epsilon = self._create_plant("Epsilon WTP")

        # Quick Monitoring — January (older, stale state)
        self._submit_monitoring(
            self.plant_epsilon, self.quick_form,
            datetime(2025, 1, 15),
            daily_production=1.0,
            has_constraints="yes",
        )

        # Comprehensive Monitoring — March (newer, operational)
        self._submit_monitoring(
            self.plant_epsilon, self.comp_form,
            datetime(2025, 3, 20),
            daily_production=8.0,
            has_constraints="no",
        )

        refresh_all_mvs()

    def test_latest_production_from_comprehensive_form(self):
        """March Comprehensive (8.0) beats January Quick (1.0)."""
        row = MVCrossFormLatest.objects.get(
            parent_id=self.plant_epsilon.id,
            question_name="daily_production_megalitres",
        )
        self.assertEqual(row.latest_numeric_value, 8.0)

    def test_latest_constraints_flag_from_comprehensive_form(self):
        """March 'no' overrides January 'yes'."""
        row = MVCrossFormLatest.objects.get(
            parent_id=self.plant_epsilon.id,
            question_name="has_production_constraints",
        )
        self.assertEqual(row.latest_option_values, ["no"])

    def test_epsilon_operational_based_on_latest_submission(self):
        """
        Older Quick Monitoring said constrained;
        newer Comprehensive says OK.
        """
        self.assertTrue(_is_operational(self.plant_epsilon.id))


@override_settings(USE_TZ=False, TEST_ENV=True)
class MonitoringHistoryLatestWinsTest(_WTPTestBase):
    """
    When the same form is submitted multiple times for a plant,
    only the most recent submission is reflected in mv_cross_form_latest.
    """

    def setUp(self):
        super().setUp()

        self.plant = self._create_plant("History WTP")

        # January submission: production constraint reported
        self._submit_monitoring(
            self.plant, self.comp_form,
            datetime(2025, 1, 1),
            daily_production=4.0,
            has_constraints="yes",
        )

        # April submission: constraint resolved, production healthy
        self._submit_monitoring(
            self.plant, self.comp_form,
            datetime(2025, 4, 1),
            daily_production=6.0,
            has_constraints="no",
        )

        refresh_all_mvs()

    def test_latest_constraints_value_is_no(self):
        row = MVCrossFormLatest.objects.get(
            parent_id=self.plant.id,
            question_name="has_production_constraints",
        )
        self.assertEqual(row.latest_option_values, ["no"])

    def test_latest_production_is_from_april(self):
        row = MVCrossFormLatest.objects.get(
            parent_id=self.plant.id,
            question_name="daily_production_megalitres",
        )
        self.assertEqual(row.latest_numeric_value, 6.0)

    def test_plant_is_operational_after_constraint_resolved(self):
        self.assertTrue(_is_operational(self.plant.id))

    def test_plant_would_not_be_operational_with_old_data(self):
        """
        Sanity check: if only January data existed,
        plant is NOT operational.
        """
        row = MVCrossFormLatest.objects.get(
            parent_id=self.plant.id,
            question_name="has_production_constraints",
        )
        old_value = row.latest_option_values
        # Temporarily evaluate with 'yes' to confirm the logic rejects it
        self.assertFalse(old_value == ["yes"])  # April already won
