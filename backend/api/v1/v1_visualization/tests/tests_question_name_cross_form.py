from datetime import datetime

from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_visualization.tests.mixins import (
    CrossFormTestBase,
    refresh_all_mvs,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class QuestionNameCrossFormTestCases(CrossFormTestBase, APITestCase):
    """Cross-form behavior: two monitoring forms, same question name.

    One registration with two monitoring forms (mon_a, mon_b). Both have
    a question named "shared_status" (option type). mon_a submitted first,
    mon_b later. The cross-form MV returns the value from mon_b (latest).
    """

    # High IDs to avoid sequence collision with other test classes.
    REG_FORM_ID = 9800
    MON_A_FORM_ID = 9801
    MON_B_FORM_ID = 9802
    Q_MON_A_ID = 980101
    Q_MON_B_ID = 980102
    REG_DATA_ID = 9890
    MON_A_DATA_ID = 9891
    MON_B_DATA_ID = 9892

    def setUp(self):
        super().setUp()
        self.init_admin_user("crossform_test@akvo.org")

        reg_form = self.make_reg_form(
            self.REG_FORM_ID, "CrossForm Registration",
        )
        mon_a_form = self.make_monitoring_form(
            self.MON_A_FORM_ID, "CrossForm Monitor A", reg_form,
        )
        mon_b_form = self.make_monitoring_form(
            self.MON_B_FORM_ID, "CrossForm Monitor B", reg_form,
        )
        self.q_a = self.add_shared_status_question(
            mon_a_form, 98010, self.Q_MON_A_ID, "old_value",
            label="Shared Status (Form A)",
        )
        self.q_b = self.add_shared_status_question(
            mon_b_form, 98020, self.Q_MON_B_ID, "new_value",
            label="Shared Status (Form B)",
        )

        self.reg = self.make_registration(
            self.REG_DATA_ID, "Cross Site", reg_form,
        )
        # Monitoring A (older): shared_status = old_value
        self.mon_a = self.make_monitoring(
            self.MON_A_DATA_ID, "Mon A", mon_a_form, self.reg,
            self.q_a, "old_value", datetime(2025, 1, 10),
        )
        # Monitoring B (newer): shared_status = new_value
        self.mon_b = self.make_monitoring(
            self.MON_B_DATA_ID, "Mon B", mon_b_form, self.reg,
            self.q_b, "new_value", datetime(2025, 6, 10),
        )

        refresh_all_mvs()

    def test_cross_form_returns_latest_from_newer_monitoring_form(self):
        """When two forms share a question name, the latest value wins.

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
