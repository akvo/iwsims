from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    CrossFormTestBase,
    refresh_all_mvs,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameParentFormScopeTestCases(CrossFormTestBase, APITestCase):
    """Cross-form question_name scoped to one registration family.

    Two registration families each have a monitoring form that shares the
    question name "shared_status". A national query (no parent_form_id)
    spans both families; passing parent_form_id=<reg form> must restrict
    the result to that family's parents only.
    """

    # High IDs to avoid sequence collisions with other test classes.
    REG1_FORM_ID = 9820
    MON1_FORM_ID = 9821
    REG2_FORM_ID = 9830
    MON2_FORM_ID = 9831
    Q_MON1_ID = 982101
    Q_MON2_ID = 983101
    REG1_DATA_ID = 98201
    MON1_DATA_ID = 98211
    REG2_DATA_ID = 98301
    MON2_DATA_ID = 98311

    def setUp(self):
        super().setUp()
        self.init_admin_user("pfscope_test@akvo.org")
        self.reg1 = self.create_family(
            reg_form_id=self.REG1_FORM_ID, mon_form_id=self.MON1_FORM_ID,
            q_id=self.Q_MON1_ID, grp_id=98210,
            reg_data_id=self.REG1_DATA_ID, mon_data_id=self.MON1_DATA_ID,
            reg_name="Family One", opt_value="fam1_val",
        )
        self.reg2 = self.create_family(
            reg_form_id=self.REG2_FORM_ID, mon_form_id=self.MON2_FORM_ID,
            q_id=self.Q_MON2_ID, grp_id=98310,
            reg_data_id=self.REG2_DATA_ID, mon_data_id=self.MON2_DATA_ID,
            reg_name="Family Two", opt_value="fam2_val",
        )
        refresh_all_mvs()

    def test_national_includes_both_families(self):
        """No parent_form_id → cross-family: both parents present."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=shared_status"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        groups = {d["group"] for d in response.json()["data"]}
        self.assertIn(str(self.REG1_DATA_ID), groups)
        self.assertIn(str(self.REG2_DATA_ID), groups)

    def test_parent_form_id_scopes_to_one_family(self):
        """parent_form_id restricts to that registration family only."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=shared_status"
            f"&parent_form_id={self.REG1_FORM_ID}"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        groups = {d["group"] for d in response.json()["data"]}
        self.assertEqual(groups, {str(self.REG1_DATA_ID)})

    def test_parent_form_id_other_family(self):
        """Scoping to the second family returns only its parent."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=shared_status"
            f"&parent_form_id={self.REG2_FORM_ID}"
            "&group_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        groups = {d["group"] for d in response.json()["data"]}
        self.assertEqual(groups, {str(self.REG2_DATA_ID)})
