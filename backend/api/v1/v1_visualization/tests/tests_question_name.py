from django.core.management import call_command
from django.test.utils import override_settings
from rest_framework.test import APITestCase
from datetime import datetime
from django.utils.timezone import make_aware

from api.v1.v1_data.models import Answers, FormData
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
    refresh_all_mvs,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameOptionTestCases(VisualizationValuesTestMixin, APITestCase):
    """Tests for /visualization/values?question_name= with option questions.

    Uses VisualizationValuesTestMixin data:
    - reg1 latest monitoring (mon1b, Mar): operational_status=active
    - reg2 latest monitoring (mon2b, Mar): operational_status=pending
    """

    def test_question_name_missing_form_id_returns_200(self):
        """question_name without form_id is valid and returns 200."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 200)

    def test_neither_question_name_nor_form_id_returns_400(self):
        """No form_id and no question_name returns 400."""
        response = self.client.get(
            f"{self.BASE_URL}?group_by=option"
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_question_name_returns_empty_200(self):
        """Unknown question_name returns 200 with empty data."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=nonexistent_question_xyz"
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["data"], [])
        self.assertEqual(body["labels"], [])

    def test_option_group_by_option_counts_latest_per_parent(self):
        """group_by=option counts one latest answer per parent.

        reg1 latest: active (1), reg2 latest: pending (1).
        inactive appeared only in non-latest mon2a so count=0.
        """
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {
            d["group"]: d["value"]
            for d in response.json()["data"]
        }
        self.assertEqual(by_group.get("active"), 1)
        self.assertEqual(by_group.get("pending"), 1)
        self.assertEqual(by_group.get("inactive", 0), 0)

    def test_option_labels_in_response(self):
        """Labels list matches option labels."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("labels", body)
        self.assertIsInstance(body["labels"], list)
        self.assertTrue(len(body["labels"]) > 0)

    def test_option_color_included(self):
        """Color is present on each data row (from QuestionOptions)."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 200)
        for row in response.json()["data"]:
            self.assertIn("color", row)

    def test_option_percentage_sums_to_100(self):
        """value_type=percentage: values sum to 100 when all parents answered."""  # noqa: E501
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=option&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        total = sum(d["value"] for d in response.json()["data"])
        self.assertAlmostEqual(total, 100.0, places=1)

    def test_option_group_by_parent_id_returns_per_parent_rows(self):
        """group_by=parent_id returns one row per parent."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 2)
        groups = {d["group"] for d in data}
        self.assertIn(str(self.reg1.id), groups)
        self.assertIn(str(self.reg2.id), groups)

    def test_option_group_by_parent_id_label_is_name(self):
        """group_by=parent_id uses FormData.name as label (not bare id)."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {d["group"]: d["label"] for d in response.json()["data"]}
        self.assertEqual(by_group[str(self.reg1.id)], self.reg1.name)
        self.assertEqual(by_group[str(self.reg2.id)], self.reg2.name)

    def test_administration_filter_scopes_results(self):
        """administration_id limits results to that administration's parents.

        reg1 is in adm_parent, reg2 is in adm_child.
        Filtering by adm_child should return only reg2.
        """
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            f"&group_by=option&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {
            d["group"]: d["value"]
            for d in response.json()["data"]
        }
        # reg2 latest: pending
        self.assertEqual(by_group.get("pending"), 1)
        # reg1 (in adm_parent only) should not appear
        self.assertEqual(by_group.get("active", 0), 0)


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


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameCountTestCases(VisualizationValuesTestMixin, APITestCase):
    """Tests for card/KPI count mode on the question_name path.

    Uses VisualizationValuesTestMixin data:
    - reg1 latest (mon1b, Mar 2025): operational_status=active
    - reg2 latest (mon2b, Mar 2025): operational_status=pending
    Two parents total, each with one latest cross-form value.
    """

    def test_sum_by_parent_id_counts_distinct_parents(self):
        """sum_by=parent_id returns a single total parent count."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["value"], 2)
        self.assertEqual(data[0]["group"], "total")

    def test_option_value_counts_matching_parents(self):
        """option_value narrows the count to matching parents."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=active"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["value"], 1)
        self.assertEqual(data[0]["group"], "active")

    def test_option_value_without_sum_by_triggers_count(self):
        """option_value alone is enough to switch to count mode."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&option_value=pending"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["value"], 1)

    def test_option_value_no_match_returns_zero(self):
        """A value no parent has selected counts zero (not empty)."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=inactive"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data[0]["value"], 0)

    def test_option_value_percentage_of_answered_parents(self):
        """value_type=percentage divides matched by total answered."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&option_value=active&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertAlmostEqual(data[0]["value"], 50.0, places=1)

    def test_count_respects_administration_filter(self):
        """administration_id scopes the parent count."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            f"&sum_by=parent_id&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        # Only reg2 is in adm_child
        self.assertEqual(response.json()["data"][0]["value"], 1)

    def test_rolling_months_wide_window_includes_all(self):
        """A wide rolling window keeps every parent."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&rolling_months=120"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 2)

    def test_rolling_months_narrow_window_excludes_old(self):
        """A 1-month window excludes the 2025 fixture submissions."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&rolling_months=1"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 0)

    def test_date_window_includes_matching_range(self):
        """from_date/to_date bound the count by latest answer date."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&from_date=2025-01-01&to_date=2025-12-31"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 2)

    def test_date_window_excludes_out_of_range(self):
        """from_date after the fixture dates yields zero parents."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=operational_status"
            "&sum_by=parent_id&from_date=2025-04-01"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"][0]["value"], 0)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameCrossFormTestCases(ProfileTestHelperMixin, APITestCase):
    """Tests for cross-form behavior: two monitoring forms, same question name.

    Setup: one registration with two monitoring forms (mon_a, mon_b).
    Both forms have a question named "shared_status" (option type).
    mon_a submitted first, mon_b submitted later.
    The cross-form MV should return the value from mon_b (most recent).
    """

    BASE_URL = "/api/v1/visualization/values"

    # Use high IDs to avoid sequence collision with other test classes
    REG_FORM_ID = 9800
    MON_A_FORM_ID = 9801
    MON_B_FORM_ID = 9802
    Q_REG_ID = 980100
    Q_MON_A_ID = 980101
    Q_MON_B_ID = 980102
    Q_OPT_A_ID = 9801001
    Q_OPT_B_ID = 9802001
    REG_DATA_ID = 9890
    MON_A_DATA_ID = 9891
    MON_B_DATA_ID = 9892

    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")

        self.adm = (
            __import__(
                "api.v1.v1_profile.models",
                fromlist=["Administration"],
            ).Administration.objects.filter(
                level__level=0
            ).first()
        )
        self.user = self.create_user(
            email="crossform_test@akvo.org",
            role_level=self.IS_SUPER_ADMIN,
        )

        from api.v1.v1_forms.models import (
            Forms as _Forms,
            Questions as _Questions,
            QuestionOptions as _QO,
            QuestionGroup as _QG,
            QuestionTypes as _QT,
        )

        # Registration form
        reg_form = _Forms.objects.create(
            id=self.REG_FORM_ID,
            name="CrossForm Registration",
            type=1,
            version=1,
        )
        # Monitoring form A
        mon_a_form = _Forms.objects.create(
            id=self.MON_A_FORM_ID,
            name="CrossForm Monitor A",
            type=2,
            version=1,
            parent=reg_form,
        )
        # Monitoring form B
        mon_b_form = _Forms.objects.create(
            id=self.MON_B_FORM_ID,
            name="CrossForm Monitor B",
            type=2,
            version=1,
            parent=reg_form,
        )

        grp_a = _QG.objects.create(
            id=98010,
            form=mon_a_form, name="grp_a",
            order=1,
        )
        grp_b = _QG.objects.create(
            id=98020,
            form=mon_b_form, name="grp_b",
            order=1,
        )

        # Both monitoring forms share question name "shared_status"
        self.q_a = _Questions.objects.create(
            id=self.Q_MON_A_ID,
            form=mon_a_form,
            question_group=grp_a,
            name="shared_status",
            label="Shared Status (Form A)",
            type=_QT.option,
            order=1,
        )
        self.q_b = _Questions.objects.create(
            id=self.Q_MON_B_ID,
            form=mon_b_form,
            question_group=grp_b,
            name="shared_status",
            label="Shared Status (Form B)",
            type=_QT.option,
            order=1,
        )
        _QO.objects.create(
            question=self.q_a, value="old_value",
            label="Old Value", order=1,
        )
        _QO.objects.create(
            question=self.q_b, value="new_value",
            label="New Value", order=1,
        )

        # One registration
        self.reg = FormData.objects.create(
            id=self.REG_DATA_ID,
            name="Cross Site",
            form=reg_form,
            administration=self.adm,
            created_by=self.user,
        )

        # Monitoring A (older): shared_status = old_value
        self.mon_a = FormData.objects.create(
            id=self.MON_A_DATA_ID,
            name="Mon A",
            form=mon_a_form,
            parent=self.reg,
            administration=self.adm,
            created_by=self.user,
        )
        FormData.objects.filter(id=self.mon_a.id).update(
            created=make_aware(datetime(2025, 1, 10))
        )
        Answers.objects.create(
            data=self.mon_a, question=self.q_a,
            options=["old_value"], created_by=self.user,
        )

        # Monitoring B (newer): shared_status = new_value
        self.mon_b = FormData.objects.create(
            id=self.MON_B_DATA_ID,
            name="Mon B",
            form=mon_b_form,
            parent=self.reg,
            administration=self.adm,
            created_by=self.user,
        )
        FormData.objects.filter(id=self.mon_b.id).update(
            created=make_aware(datetime(2025, 6, 10))
        )
        Answers.objects.create(
            data=self.mon_b, question=self.q_b,
            options=["new_value"], created_by=self.user,
        )

        refresh_all_mvs()

    def test_cross_form_returns_latest_from_newer_monitoring_form(self):
        """When two forms have the same question name, latest value wins.

        mon_b (June) is newer than mon_a (January) so new_value wins.
        """
        response = self.client.get(
            f"{self.BASE_URL}?question_name=shared_status"
            "&group_by=option"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {
            d["group"]: d["value"]
            for d in response.json()["data"]
        }
        self.assertEqual(by_group.get("new_value"), 1)
        self.assertEqual(by_group.get("old_value", 0), 0)

    def test_cross_form_group_by_parent_id_single_row(self):
        """One parent registration → one row per parent per question_name."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=shared_status"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["group"], str(self.REG_DATA_ID))
        self.assertEqual(data[0]["value"], ["new_value"])
