"""Pure-function unit tests for the formula evaluator.

No DB, no Django setup — just the logic in
``api.v1.v1_visualization.formula``.
"""
import unittest

from api.v1.v1_visualization.formula import (
    _match,
    evaluate,
    pick_latest_repeat,
    validate_shape,
)


class _Answer:
    """Minimal Answers stand-in for tests."""
    def __init__(self, question_id, value=None, options=None, index=0):
        self.question_id = question_id
        self.value = value
        self.options = options
        self.index = index


class FormulaMatchTests(unittest.TestCase):
    def test_lte_pass(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "<=", "value": 5},
            {1: _Answer(1, value=5)},
        ))

    def test_lte_fail(self):
        self.assertFalse(_match(
            {"question_id": 1, "op": "<=", "value": 5},
            {1: _Answer(1, value=6)},
        ))

    def test_lt_strict(self):
        self.assertFalse(_match(
            {"question_id": 1, "op": "<", "value": 5},
            {1: _Answer(1, value=5)},
        ))

    def test_gt_pass(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": ">", "value": 5},
            {1: _Answer(1, value=6)},
        ))

    def test_eq_pass(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "==", "value": 7},
            {1: _Answer(1, value=7)},
        ))

    def test_neq_pass(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "!=", "value": 7},
            {1: _Answer(1, value=8)},
        ))

    def test_between_inclusive_min(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "between", "min": 6.5, "max": 8.5},
            {1: _Answer(1, value=6.5)},
        ))

    def test_between_inclusive_max(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "between", "min": 6.5, "max": 8.5},
            {1: _Answer(1, value=8.5)},
        ))

    def test_between_outside(self):
        self.assertFalse(_match(
            {"question_id": 1, "op": "between", "min": 6.5, "max": 8.5},
            {1: _Answer(1, value=9.0)},
        ))

    def test_option_equals_pass(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "option_equals", "value": "yes"},
            {1: _Answer(1, options=["yes"])},
        ))

    def test_option_equals_fail(self):
        self.assertFalse(_match(
            {"question_id": 1, "op": "option_equals", "value": "yes"},
            {1: _Answer(1, options=["no"])},
        ))

    def test_option_in_pass(self):
        self.assertTrue(_match(
            {"question_id": 1, "op": "option_in",
             "values": ["a", "b"]},
            {1: _Answer(1, options=["b"])},
        ))

    def test_missing_answer_is_false(self):
        self.assertFalse(_match(
            {"question_id": 99, "op": "<=", "value": 5},
            {1: _Answer(1, value=5)},
        ))

    def test_unknown_op_is_false(self):
        self.assertFalse(_match(
            {"question_id": 1, "op": "@@", "value": 5},
            {1: _Answer(1, value=5)},
        ))


class FormulaEvaluateTests(unittest.TestCase):
    def _formula(self):
        return {
            "buckets": [
                {
                    "value": "compliant",
                    "label": "Yes",
                    "all_of": [
                        {"question_id": 1, "op": "<=", "value": 5},
                        {"question_id": 2, "op": "between",
                         "min": 6.5, "max": 8.5},
                    ],
                },
            ],
            "default": {"value": "non_compliant", "label": "No"},
        }

    def test_first_bucket_wins(self):
        answers = {
            1: _Answer(1, value=3),
            2: _Answer(2, value=7),
        }
        self.assertEqual(evaluate(self._formula(), answers), "compliant")

    def test_default_when_condition_fails(self):
        answers = {
            1: _Answer(1, value=10),
            2: _Answer(2, value=7),
        }
        self.assertEqual(
            evaluate(self._formula(), answers), "non_compliant"
        )

    def test_default_when_answer_missing(self):
        answers = {1: _Answer(1, value=3)}
        self.assertEqual(
            evaluate(self._formula(), answers), "non_compliant"
        )

    def test_later_bucket_wins(self):
        formula = {
            "buckets": [
                {
                    "value": "high",
                    "label": "High",
                    "all_of": [
                        {"question_id": 1, "op": ">=", "value": 100},
                    ],
                },
                {
                    "value": "medium",
                    "label": "Medium",
                    "all_of": [
                        {"question_id": 1, "op": ">=", "value": 50},
                    ],
                },
            ],
            "default": {"value": "low", "label": "Low"},
        }
        answers = {1: _Answer(1, value=75)}
        self.assertEqual(evaluate(formula, answers), "medium")


class PickLatestRepeatTests(unittest.TestCase):
    def test_latest_repeat_wins(self):
        answers = [
            _Answer(1, value=3, index=0),
            _Answer(1, value=99, index=2),
            _Answer(1, value=10, index=1),
        ]
        out = pick_latest_repeat(answers)
        self.assertEqual(out[1].value, 99)

    def test_separate_questions(self):
        answers = [
            _Answer(1, value=1, index=0),
            _Answer(2, value=2, index=0),
        ]
        out = pick_latest_repeat(answers)
        self.assertEqual(set(out.keys()), {1, 2})

    def test_dict_inputs(self):
        answers = [
            {"question_id": 1, "value": 5, "index": 0},
            {"question_id": 1, "value": 9, "index": 3},
        ]
        out = pick_latest_repeat(answers)
        self.assertEqual(out[1]["value"], 9)


class ValidateShapeTests(unittest.TestCase):
    def _good(self):
        return {
            "buckets": [
                {
                    "value": "x",
                    "label": "X",
                    "all_of": [
                        {"question_id": 1, "op": "<=", "value": 5},
                    ],
                },
            ],
            "default": {"value": "y", "label": "Y"},
        }

    def test_good_passes(self):
        self.assertEqual(validate_shape(self._good()), self._good())

    def test_missing_buckets(self):
        with self.assertRaises(ValueError):
            validate_shape({"default": {"value": "y", "label": "Y"}})

    def test_empty_buckets(self):
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [],
                "default": {"value": "y", "label": "Y"},
            })

    def test_bucket_missing_value(self):
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [{
                    "label": "X",
                    "all_of": [
                        {"question_id": 1, "op": "<=", "value": 5},
                    ],
                }],
                "default": {"value": "y", "label": "Y"},
            })

    def test_unknown_op(self):
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [{
                    "value": "x",
                    "label": "X",
                    "all_of": [
                        {"question_id": 1, "op": "@@", "value": 5},
                    ],
                }],
                "default": {"value": "y", "label": "Y"},
            })

    def test_between_requires_min_max(self):
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [{
                    "value": "x",
                    "label": "X",
                    "all_of": [
                        {"question_id": 1, "op": "between", "min": 1},
                    ],
                }],
                "default": {"value": "y", "label": "Y"},
            })

    def test_numeric_op_value_must_be_number(self):
        """
        String value for numeric op
        must be rejected (would cause TypeError).
        """
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [{
                    "value": "x",
                    "label": "X",
                    "all_of": [
                        {"question_id": 1, "op": "<=", "value": "abc"},
                    ],
                }],
                "default": {"value": "y", "label": "Y"},
            })

    def test_between_min_max_must_be_numbers(self):
        """String min/max for between op must be rejected."""
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [{
                    "value": "x",
                    "label": "X",
                    "all_of": [
                        {
                            "question_id": 1,
                            "op": "between",
                            "min": "low",
                            "max": "high",
                        },
                    ],
                }],
                "default": {"value": "y", "label": "Y"},
            })

    def test_option_equals_string_value_passes(self):
        """option_equals value is a string — no numeric type check."""
        result = validate_shape({
            "buckets": [{
                "value": "x",
                "label": "X",
                "all_of": [
                    {
                        "question_id": 1,
                        "op": "option_equals",
                        "value": "some_option",
                    },
                ],
            }],
            "default": {"value": "y", "label": "Y"},
        })
        self.assertIsNotNone(result)

    def test_default_required(self):
        with self.assertRaises(ValueError):
            validate_shape({
                "buckets": [{
                    "value": "x",
                    "label": "X",
                    "all_of": [
                        {"question_id": 1, "op": "<=", "value": 5},
                    ],
                }],
            })
