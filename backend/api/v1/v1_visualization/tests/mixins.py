from datetime import datetime

from django.core.management import call_command
from django.db import connection
from django.utils.timezone import make_aware

from api.v1.v1_data.models import Answers, FormData
from api.v1.v1_forms.models import (
    Forms,
    Questions,
    QuestionGroup,
    QuestionOptions,
    QuestionTypes,
)
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


def refresh_all_mvs():
    """Refresh all visualization materialized views.

    Call in test setUp() after creating FormData/Answers so MV-based
    queries see the test data. Works inside TestCase transactions
    (regular REFRESH, not CONCURRENTLY).
    """
    with connection.cursor() as cursor:
        cursor.execute(
            "REFRESH MATERIALIZED VIEW mv_latest_monitoring"
        )
        cursor.execute(
            "REFRESH MATERIALIZED VIEW mv_answer_denormalized"
        )
        cursor.execute(
            "REFRESH MATERIALIZED VIEW mv_cross_form_latest"
        )
        cursor.execute(
            "REFRESH MATERIALIZED VIEW mv_parent_aggregates"
        )


class MVRefreshMixin:
    """Mixin that refreshes all materialized views after setUp.

    Include before TestCase/APITestCase in the MRO for test classes
    whose assertions rely on MV-backed queries:

        class MyTest(MVRefreshMixin, VisualizationValuesTestMixin, TestCase):
            ...
    """

    def setUp(self):
        super().setUp()
        refresh_all_mvs()


class VisualizationValuesTestMixin(ProfileTestHelperMixin):
    """Shared test data setup for /visualization/values tests.

    Uses form seeder with example-vis-6 form definitions:
    - example-vis-6.json: Registration form (id=6001)
    - example-vis-6.monitoring.json: Monitoring form (id=6002)

    Creates test data:
    - 1 superuser
    - 2 administrations (parent-child)
    - 2 registration records (in different administrations)
    - 4 monitoring records (2 per parent, different dates)
    - Answers for: number, option, multiple_option, date,
      and repeatable number questions
    """

    # Form IDs from example-vis-6 seed files
    REGISTRATION_FORM_ID = 6001
    MONITORING_FORM_ID = 6002

    # Question IDs from example-vis-6.monitoring seed file
    Q_DATE_ID = 600201            # date: inspection_date
    Q_NUMBER_ID = 600202          # number: measurement_value
    Q_OPTION_ID = 600203          # option: operational_status
    Q_MULTI_ID = 600204           # multiple_option: features
    Q_TEXT_ID = 600205            # text: notes (unsupported type)
    Q_NUMBER_REPEAT_ID = 600206   # number: test_result (repeatable)

    # Registration question IDs
    Q_REG_OPTION_ID = 600102      # option: site_type
    Q_REG_ADMIN_ID = 600103       # administration: location
    Q_REG_GEO_ID = 600104         # geo: geolocation

    BASE_URL = "/api/v1/visualization/values"

    def setUp(self):
        super().setUp()
        self.maxDiff = None
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")

        # User
        self.user = self.create_user(
            email="viz_test@akvo.org",
            role_level=self.IS_SUPER_ADMIN,
        )

        # Load seeded forms
        self.registration = Forms.objects.get(
            pk=self.REGISTRATION_FORM_ID,
        )
        self.monitoring = Forms.objects.get(
            pk=self.MONITORING_FORM_ID,
        )

        # Load seeded questions
        self.q_date = Questions.objects.get(pk=self.Q_DATE_ID)
        self.q_number = Questions.objects.get(pk=self.Q_NUMBER_ID)
        self.q_option = Questions.objects.get(pk=self.Q_OPTION_ID)
        self.q_multi = Questions.objects.get(pk=self.Q_MULTI_ID)
        self.q_text = Questions.objects.get(pk=self.Q_TEXT_ID)
        self.q_number_repeat = Questions.objects.get(
            pk=self.Q_NUMBER_REPEAT_ID,
        )

        # Administrations: pick parent (level 0) and child (level 1)
        self.adm_parent = Administration.objects.filter(
            level__level=0,
        ).first()
        self.adm_child = Administration.objects.filter(
            level__level=1,
        ).first()

        # Load registration questions
        self.q_reg_option = Questions.objects.get(
            pk=self.Q_REG_OPTION_ID,
        )
        self.q_reg_admin = Questions.objects.get(
            pk=self.Q_REG_ADMIN_ID,
        )
        self.q_reg_geo = Questions.objects.get(
            pk=self.Q_REG_GEO_ID,
        )

        # Create registration records (2, different administrations)
        self.reg1 = FormData.objects.create(
            id=7200,
            name="Site Alpha",
            form=self.registration,
            administration=self.adm_parent,
            geo=[-18.1190718, 178.4504677],
            created_by=self.user,
        )
        # Registration answers for reg1
        Answers.objects.create(
            data=self.reg1,
            question=self.q_reg_admin,
            value=self.adm_parent.id,
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.reg1,
            question=self.q_reg_geo,
            options=[-18.1190718, 178.4504677],
            created_by=self.user,
        )

        self.reg2 = FormData.objects.create(
            id=7201,
            name="Site Beta",
            form=self.registration,
            administration=self.adm_child,
            geo=[-18.1175162, 178.4478261],
            created_by=self.user,
        )
        # Registration answers for reg2
        Answers.objects.create(
            data=self.reg2,
            question=self.q_reg_admin,
            value=self.adm_child.id,
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.reg2,
            question=self.q_reg_geo,
            options=[-18.1175162, 178.4478261],
            created_by=self.user,
        )

        # Create monitoring records with answers
        # reg1: 2 monitoring records (Jan + Mar)
        self.mon1a = self._create_monitoring(
            parent=self.reg1,
            created_date=datetime(2025, 1, 15),
            number_val=10.0,
            number_repeat_vals=[5.0, 15.0],
            option_val="active",
            multi_vals=["feature_x", "feature_y"],
            date_val="2025-01-15T00:00:00.000Z",
        )
        self.mon1b = self._create_monitoring(
            parent=self.reg1,
            created_date=datetime(2025, 3, 10),
            number_val=20.0,
            number_repeat_vals=[8.0, 12.0, 4.0],
            option_val="active",
            multi_vals=["feature_y", "feature_z"],
            date_val="2025-03-10T00:00:00.000Z",
        )

        # reg2: 2 monitoring records (Jan + Mar)
        self.mon2a = self._create_monitoring(
            parent=self.reg2,
            created_date=datetime(2025, 1, 20),
            number_val=30.0,
            number_repeat_vals=[10.0, 20.0],
            option_val="inactive",
            multi_vals=["feature_x", "feature_z"],
            date_val="2025-01-20T00:00:00.000Z",
        )
        self.mon2b = self._create_monitoring(
            parent=self.reg2,
            created_date=datetime(2025, 3, 15),
            number_val=40.0,
            number_repeat_vals=[25.0, 35.0],
            option_val="pending",
            multi_vals=["feature_x", "feature_y", "feature_z"],
            date_val="2025-03-15T00:00:00.000Z",
        )

        refresh_all_mvs()

    def _create_monitoring(
        self,
        parent,
        created_date,
        number_val=None,
        number_repeat_vals=None,
        option_val=None,
        multi_vals=None,
        date_val=None,
    ):
        """Create a monitoring FormData with answers.

        Args:
            parent: Parent registration FormData.
            created_date: datetime for FormData.created.
            number_val: Value for measurement_value question.
            number_repeat_vals: List of values for repeatable
                test_result question.
            option_val: Option value for operational_status.
            multi_vals: List of option values for features.
            date_val: ISO date string for inspection_date.

        Returns:
            Created FormData instance.
        """
        mon = FormData.objects.create(
            name=f"{parent.name} - Monitoring",
            form=self.monitoring,
            parent=parent,
            administration=parent.administration,
            created_by=self.user,
        )
        # Set created date (bypass auto_now_add)
        FormData.objects.filter(id=mon.id).update(
            created=make_aware(created_date),
        )
        mon.refresh_from_db()

        if number_val is not None:
            Answers.objects.create(
                data=mon,
                question=self.q_number,
                value=number_val,
                created_by=self.user,
                index=0,
            )

        if number_repeat_vals:
            for idx, val in enumerate(number_repeat_vals):
                Answers.objects.create(
                    data=mon,
                    question=self.q_number_repeat,
                    value=val,
                    created_by=self.user,
                    index=idx,
                )

        if option_val:
            Answers.objects.create(
                data=mon,
                question=self.q_option,
                options=[option_val],
                created_by=self.user,
                index=0,
            )

        if multi_vals:
            Answers.objects.create(
                data=mon,
                question=self.q_multi,
                options=multi_vals,
                created_by=self.user,
                index=0,
            )

        if date_val:
            Answers.objects.create(
                data=mon,
                question=self.q_date,
                name=date_val,
                created_by=self.user,
                index=0,
            )

        return mon


class CrossFormTestBase(ProfileTestHelperMixin):
    """Base for cross-form question_name tests.

    These tests need fixture topologies the fixed example-vis-6 dataset
    (VisualizationValuesTestMixin) cannot express: multiple monitoring
    forms under one registration, or multiple registration families that
    share a question name. This base provides the admin/user boilerplate
    plus small builders so each test only declares the topology it needs.

    All shared monitoring questions are option-type named "shared_status".
    """

    BASE_URL = "/api/v1/visualization/values"

    def init_admin_user(self, email):
        """Seed administrations + create a super-admin user."""
        call_command("administration_seeder", "--test")
        self.adm = Administration.objects.filter(level__level=0).first()
        self.user = self.create_user(
            email=email,
            role_level=self.IS_SUPER_ADMIN,
        )

    def make_reg_form(self, form_id, name):
        return Forms.objects.create(
            id=form_id, name=name, type=1, version=1,
        )

    def make_monitoring_form(self, form_id, name, parent):
        return Forms.objects.create(
            id=form_id, name=name, type=2, version=1, parent=parent,
        )

    def add_shared_status_question(
        self, form, group_id, q_id, opt_value, label="Shared Status",
    ):
        """Add an option question named "shared_status" with one option."""
        grp = QuestionGroup.objects.create(
            id=group_id, form=form, name=f"grp_{form.id}", order=1,
        )
        question = Questions.objects.create(
            id=q_id, form=form, question_group=grp,
            name="shared_status", label=label,
            type=QuestionTypes.option, order=1,
        )
        QuestionOptions.objects.create(
            question=question, value=opt_value, label=opt_value, order=1,
        )
        return question

    def make_registration(self, data_id, name, reg_form):
        return FormData.objects.create(
            id=data_id, name=name, form=reg_form,
            administration=self.adm, created_by=self.user,
        )

    def make_monitoring(
        self, data_id, name, mon_form, parent_reg, question,
        opt_value, created,
    ):
        """Create a monitoring datapoint + its shared_status answer."""
        mon = FormData.objects.create(
            id=data_id, name=name, form=mon_form, parent=parent_reg,
            administration=self.adm, created_by=self.user,
        )
        FormData.objects.filter(id=mon.id).update(
            created=make_aware(created)
        )
        Answers.objects.create(
            data=mon, question=question, options=[opt_value],
            created_by=self.user,
        )
        return mon

    def create_family(
        self, *, reg_form_id, mon_form_id, q_id, grp_id,
        reg_data_id, mon_data_id, reg_name, opt_value,
        created=datetime(2025, 6, 10),
    ):
        """Build a one-registration / one-monitoring family sharing
        the "shared_status" question. Returns the registration FormData."""
        reg_form = self.make_reg_form(
            reg_form_id, f"{reg_name} Registration",
        )
        mon_form = self.make_monitoring_form(
            mon_form_id, f"{reg_name} Monitor", reg_form,
        )
        question = self.add_shared_status_question(
            mon_form, grp_id, q_id, opt_value,
        )
        reg = self.make_registration(reg_data_id, reg_name, reg_form)
        self.make_monitoring(
            mon_data_id, f"{reg_name} Mon", mon_form, reg, question,
            opt_value, created,
        )
        return reg
