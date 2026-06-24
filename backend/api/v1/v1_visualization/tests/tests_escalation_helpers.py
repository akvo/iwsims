"""Unit tests for the escalation helper functions.

Targets three helpers in ``escalation_functions`` that the API-level tests
don't fully exercise:

- ``_escalation_base_params`` — pure querystring builder (no DB).
- ``_split_filter_criteria_registration`` — registration-vs-monitoring split.
- ``_cross_form_and_narrow`` — AND-narrowing via ``mv_cross_form_latest``.

The DB-backed cases reuse VisualizationValuesTestMixin, whose setUp seeds one
registration form (6001) + one monitoring form (6002) and refreshes the MVs:
  reg1 (Site Alpha): operational_status=active, measurement=20,
                     features=[feature_y, feature_z]
  reg2 (Site Beta):  operational_status=pending, measurement=40,
                     features=[feature_x, feature_y, feature_z]
"""
import unittest

from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_visualization.escalation_functions import (
    _cross_form_and_narrow,
    _escalation_base_params,
    _split_filter_criteria_registration,
)
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


class EscalationBaseParamsTests(unittest.TestCase):
    """Pure-function tests for the page-link querystring builder."""

    def test_query_string_passthrough_strips_page(self):
        params = {
            "query_string": [
                ("monitoring_form_id", "6002"),
                ("page", "3"),
                ("foo", "bar"),
            ]
        }
        out = _escalation_base_params(params, 6002, 20, None)
        self.assertEqual(
            out, [("monitoring_form_id", "6002"), ("foo", "bar")]
        )

    def test_builds_params_with_monitoring_form_id(self):
        out = _escalation_base_params({}, 6002, 50, None)
        self.assertEqual(
            out, [("monitoring_form_id", 6002), ("page_size", 50)]
        )

    def test_omits_monitoring_form_id_when_absent(self):
        out = _escalation_base_params({}, None, 20, None)
        self.assertEqual(out, [("page_size", 20)])

    def test_includes_administration_and_date_params(self):
        params = {
            "from_date": "2025-01-01",
            "to_date": "2025-06-30",
            "date_question_name": "inspection_date",
        }
        out = _escalation_base_params(params, None, 20, 42)
        self.assertEqual(
            out,
            [
                ("page_size", 20),
                ("administration_id", 42),
                ("from_date", "2025-01-01"),
                ("to_date", "2025-06-30"),
                ("date_question_name", "inspection_date"),
            ],
        )

    def test_skips_missing_date_keys(self):
        out = _escalation_base_params(
            {"from_date": "2025-01-01"}, None, 20, None
        )
        self.assertEqual(
            out, [("page_size", 20), ("from_date", "2025-01-01")]
        )


@override_settings(USE_TZ=False, TEST_ENV=True)
class SplitFilterCriteriaRegistrationTests(
    VisualizationValuesTestMixin, TestCase
):
    """A criterion on the registration form is a parent filter; anything
    else narrows via the cross-form latest."""

    def _crit(self, qname, value="x"):
        return {"type": "option_equals", "parts": [qname, value]}

    def test_empty_returns_none_none(self):
        pfid = self.registration.id
        self.assertEqual(
            _split_filter_criteria_registration(None, pfid), (None, None)
        )
        self.assertEqual(
            _split_filter_criteria_registration([], pfid), (None, None)
        )

    def test_splits_registration_vs_monitoring(self):
        reg = self._crit(self.q_reg_option.name)
        mon = self._crit(self.q_option.name)
        mon_out, parent_out = _split_filter_criteria_registration(
            [reg, mon], self.registration.id
        )
        self.assertEqual(parent_out, [reg])
        self.assertEqual(mon_out, [mon])

    def test_all_registration(self):
        reg = self._crit(self.q_reg_option.name)
        mon_out, parent_out = _split_filter_criteria_registration(
            [reg], self.registration.id
        )
        self.assertIsNone(mon_out)
        self.assertEqual(parent_out, [reg])

    def test_all_monitoring(self):
        mon = self._crit(self.q_option.name)
        mon_out, parent_out = _split_filter_criteria_registration(
            [mon], self.registration.id
        )
        self.assertEqual(mon_out, [mon])
        self.assertIsNone(parent_out)


@override_settings(USE_TZ=False, TEST_ENV=True)
class CrossFormAndNarrowTests(VisualizationValuesTestMixin, TestCase):
    """AND-narrowing of parent ids against the cross-form latest MV."""

    def setUp(self):
        super().setUp()
        self.pids = [self.reg1.id, self.reg2.id]
        self.pfid = self.registration.id

    def _narrow(self, *criteria):
        return _cross_form_and_narrow(list(criteria), self.pids, self.pfid)

    def test_option_equals_narrows_to_match(self):
        c = {"type": "option_equals", "parts": [self.q_option.name, "active"]}
        self.assertEqual(self._narrow(c), {self.reg1.id})

    def test_threshold_gt(self):
        c = {"type": "threshold_gt", "parts": [self.q_number.name, 25]}
        self.assertEqual(self._narrow(c), {self.reg2.id})

    def test_threshold_lt(self):
        c = {"type": "threshold_lt", "parts": [self.q_number.name, 25]}
        self.assertEqual(self._narrow(c), {self.reg1.id})

    def test_option_contains(self):
        c = {
            "type": "option_contains",
            "parts": [self.q_multi.name, "feature_x"],
        }
        self.assertEqual(self._narrow(c), {self.reg2.id})

    def test_option_in_list_value(self):
        c = {"type": "option_in", "parts": [self.q_multi.name, ["feature_x"]]}
        self.assertEqual(self._narrow(c), {self.reg2.id})

    def test_multiple_criteria_and(self):
        # operational_status=active AND measurement<25 → only reg1.
        c1 = {
            "type": "option_equals",
            "parts": [self.q_option.name, "active"],
        }
        c2 = {"type": "threshold_lt", "parts": [self.q_number.name, 25]}
        self.assertEqual(self._narrow(c1, c2), {self.reg1.id})

    def test_conflicting_criteria_yields_empty(self):
        # active matches reg1, measurement>25 matches reg2 → no overlap.
        c1 = {
            "type": "option_equals",
            "parts": [self.q_option.name, "active"],
        }
        c2 = {"type": "threshold_gt", "parts": [self.q_number.name, 25]}
        self.assertEqual(self._narrow(c1, c2), set())

    def test_unknown_type_is_ignored(self):
        # Unsupported criterion type → no narrowing, full set kept.
        c = {"type": "not_a_type", "parts": [self.q_option.name, "x"]}
        self.assertEqual(self._narrow(c), set(self.pids))


if __name__ == "__main__":
    unittest.main()
