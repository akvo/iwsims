"""Pure-function unit tests for the progress formula handlers.

No DB, no Django fixtures — just the per-component scoring helpers in
``api.v1.v1_visualization.progress_functions``. The answers map is keyed
by ``(latest_data_id, question_name)`` and each value is a dict carrying
``options`` (list) and/or ``value``.
"""
import unittest

from api.v1.v1_visualization.progress_functions import (
    compute_any_yes,
    compute_completed_binary,
)

DID = 101  # latest_data_id used across the cases


def _map(**by_qname):
    """Build an answers_map keyed by (DID, qname) from qname=options."""
    return {(DID, q): v for q, v in by_qname.items()}


class ComputeAnyYesTests(unittest.TestCase):
    def test_single_yes_is_complete(self):
        amap = _map(has_dam={"options": ["yes"]})
        self.assertEqual(compute_any_yes(DID, ["has_dam"], amap), 100.0)

    def test_yes_among_other_options(self):
        amap = _map(features={"options": ["other", "yes", "more"]})
        self.assertEqual(compute_any_yes(DID, ["features"], amap), 100.0)

    def test_second_question_has_yes(self):
        amap = _map(
            a={"options": ["no"]},
            b={"options": ["yes"]},
        )
        self.assertEqual(compute_any_yes(DID, ["a", "b"], amap), 100.0)

    def test_no_yes_is_zero(self):
        amap = _map(has_dam={"options": ["no"]})
        self.assertEqual(compute_any_yes(DID, ["has_dam"], amap), 0.0)

    def test_missing_answer_is_zero(self):
        self.assertEqual(compute_any_yes(DID, ["has_dam"], {}), 0.0)

    def test_answer_without_options_is_zero(self):
        amap = _map(has_dam={"value": 5, "options": None})
        self.assertEqual(compute_any_yes(DID, ["has_dam"], amap), 0.0)

    def test_empty_options_is_zero(self):
        amap = _map(has_dam={"options": []})
        self.assertEqual(compute_any_yes(DID, ["has_dam"], amap), 0.0)

    def test_empty_question_names_is_zero(self):
        amap = _map(has_dam={"options": ["yes"]})
        self.assertEqual(compute_any_yes(DID, [], amap), 0.0)

    def test_is_case_sensitive(self):
        # Stored option values are lowercase; "Yes" must not match.
        amap = _map(has_dam={"options": ["Yes"]})
        self.assertEqual(compute_any_yes(DID, ["has_dam"], amap), 0.0)

    def test_other_data_id_not_matched(self):
        amap = {(999, "has_dam"): {"options": ["yes"]}}
        self.assertEqual(compute_any_yes(DID, ["has_dam"], amap), 0.0)


class ComputeCompletedBinaryTests(unittest.TestCase):
    def test_completed_is_complete(self):
        amap = _map(dam={"options": ["completed"]})
        self.assertEqual(
            compute_completed_binary(DID, ["dam"], amap), 100.0
        )

    def test_completed_among_other_options(self):
        amap = _map(dam={"options": ["started", "completed"]})
        self.assertEqual(
            compute_completed_binary(DID, ["dam"], amap), 100.0
        )

    def test_second_question_completed(self):
        amap = _map(
            household={"options": ["in_progress"]},
            communal={"options": ["completed"]},
        )
        self.assertEqual(
            compute_completed_binary(
                DID, ["household", "communal"], amap
            ),
            100.0,
        )

    def test_not_completed_is_zero(self):
        amap = _map(dam={"options": ["in_progress"]})
        self.assertEqual(compute_completed_binary(DID, ["dam"], amap), 0.0)

    def test_missing_answer_is_zero(self):
        self.assertEqual(compute_completed_binary(DID, ["dam"], {}), 0.0)

    def test_answer_without_options_is_zero(self):
        amap = _map(dam={"value": 1, "options": None})
        self.assertEqual(compute_completed_binary(DID, ["dam"], amap), 0.0)

    def test_empty_options_is_zero(self):
        amap = _map(dam={"options": []})
        self.assertEqual(compute_completed_binary(DID, ["dam"], amap), 0.0)

    def test_empty_question_names_is_zero(self):
        amap = _map(dam={"options": ["completed"]})
        self.assertEqual(compute_completed_binary(DID, [], amap), 0.0)

    def test_is_case_sensitive(self):
        amap = _map(dam={"options": ["Completed"]})
        self.assertEqual(compute_completed_binary(DID, ["dam"], amap), 0.0)


if __name__ == "__main__":
    unittest.main()
