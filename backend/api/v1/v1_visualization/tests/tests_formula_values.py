"""View-level tests for /api/v1/visualization/values/formula.

The endpoint is cross-form: it is scoped by ``parent_form_id`` (the
registration form) and, per registration datapoint, evaluates the
formula against the latest answer per question_name taken across ALL of
the family's monitoring forms (mv_cross_form_latest), falling back to the
registration datapoint's own answer for questions that only exist on the
registration form.
"""
import json
from urllib.parse import quote

from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_data.models import Answers, FormData
from api.v1.v1_forms.models import Questions, QuestionTypes
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
    refresh_all_mvs,
)


def _encode(formula_dict):
    """URL-encode a formula JSON object for query string usage."""
    return quote(json.dumps(formula_dict, separators=(",", ":")))


@override_settings(USE_TZ=False, TEST_ENV=True)
class FormulaValuesViewTests(
    VisualizationValuesTestMixin, APITestCase
):
    """Mixin pre-creates two registrations and four monitoring children
    on form 6002 with answers on q_number (600202). The endpoint is
    scoped by the registration form id (6001)."""

    BASE_URL = "/api/v1/visualization/values/formula"

    def _url(self, formula, extra=""):
        return (
            f"{self.BASE_URL}"
            f"?parent_form_id={self.REGISTRATION_FORM_ID}"
            f"&group_by=parent_id"
            f"&formula={_encode(formula)}"
            f"{extra}"
        )

    def _formula(self):
        # reg1 latest monitoring numeric=20.0 (passes <= 25)
        # reg2 latest monitoring numeric=40.0 (fails <= 25)
        return {
            "buckets": [{
                "value": "low",
                "label": "Low",
                "all_of": [{
                    "question_name": self.q_number.name,
                    "op": "<=",
                    "value": 25,
                }],
            }],
            "default": {"value": "high", "label": "High"},
        }

    def test_groups_by_parent_id(self):
        response = self.client.get(self._url(self._formula()))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        rows = {row["group"]: row["label"] for row in body["data"]}
        self.assertEqual(rows[self.reg1.id], "low")
        self.assertEqual(rows[self.reg2.id], "high")

    def test_between_inclusive_bounds(self):
        # Salinity-style range: 6.5 <= value <= 25.0
        formula = {
            "buckets": [{
                "value": "in_range",
                "label": "In",
                "all_of": [{
                    "question_name": self.q_number.name,
                    "op": "between",
                    "min": 6.5,
                    "max": 25.0,
                }],
            }],
            "default": {"value": "out", "label": "Out"},
        }
        response = self.client.get(self._url(formula))
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        # reg1 latest=20.0 (in), reg2 latest=40.0 (out)
        self.assertEqual(rows[self.reg1.id], "in_range")
        self.assertEqual(rows[self.reg2.id], "out")

    def test_latest_repeat_used(self):
        # mv_cross_form_latest collapses each repeatable question to its
        # latest answer. On reg1's latest monitoring the repeatable
        # number question is 4.0; on reg2's it is 35.0.
        formula = {
            "buckets": [{
                "value": "small",
                "label": "Small",
                "all_of": [{
                    "question_name": self.q_number_repeat.name,
                    "op": "<=",
                    "value": 5,
                }],
            }],
            "default": {"value": "big", "label": "Big"},
        }
        response = self.client.get(self._url(formula))
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        self.assertEqual(rows[self.reg1.id], "small")
        self.assertEqual(rows[self.reg2.id], "big")

    def test_parent_with_no_monitoring_falls_back(self):
        # Hard-delete reg1's monitoring children (bypass soft-delete).
        # reg1 still appears via its registration answers, but with no
        # monitoring measurement_value it can only hit the default bucket.
        FormData.objects.filter(parent=self.reg1).delete(hard=True)
        refresh_all_mvs()
        response = self.client.get(self._url(self._formula()))
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        self.assertIn(self.reg1.id, rows)
        self.assertEqual(rows[self.reg1.id], "high")
        self.assertEqual(rows[self.reg2.id], "high")

    def test_default_when_no_match(self):
        # A formula no datapoint can satisfy → everyone is the default.
        formula = {
            "buckets": [{
                "value": "impossible",
                "label": "Never",
                "all_of": [{
                    "question_name": self.q_number.name,
                    "op": ">", "value": 9999,
                }],
            }],
            "default": {"value": "fallback", "label": "FB"},
        }
        response = self.client.get(self._url(formula))
        self.assertEqual(response.status_code, 200)
        labels = {row["label"] for row in response.json()["data"]}
        self.assertEqual(labels, {"fallback"})

    def test_pending_monitoring_excluded(self):
        # Make reg1's monitoring children pending. mv_cross_form_latest
        # drops them, so reg1 loses its monitoring measurement_value and
        # reverts to the default bucket (registration fallback only).
        FormData.objects.filter(parent=self.reg1).update(is_pending=True)
        refresh_all_mvs()
        response = self.client.get(self._url(self._formula()))
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        self.assertEqual(rows[self.reg1.id], "high")
        self.assertEqual(rows[self.reg2.id], "high")

    def test_date_filter_narrows_latest(self):
        # to_date before reg2's latest (Mar 15) but after its Jan record
        # makes the Jan monitoring (numeric=30.0) the latest for reg2.
        # reg1's Jan record (numeric=10.0) likewise becomes its latest.
        response = self.client.get(
            self._url(self._formula(), extra="&to_date=2025-02-01")
        )
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        # reg1 Jan=10.0 (<=25 → low), reg2 Jan=30.0 (>25 → high)
        self.assertEqual(rows[self.reg1.id], "low")
        self.assertEqual(rows[self.reg2.id], "high")

    def test_missing_required_param(self):
        # Missing parent_form_id → 400
        url = (
            f"{self.BASE_URL}"
            f"?group_by=parent_id"
            f"&formula={_encode(self._formula())}"
        )
        response = self.client.get(url)
        self.assertEqual(response.status_code, 400)

    def test_numeric_question_name_in_formula_rejected(self):
        """A numeric question_name in a condition is a 400 (Part A guard)."""
        formula = {
            "buckets": [{
                "value": "x",
                "label": "X",
                "all_of": [{
                    "question_name": str(self.Q_NUMBER_ID),
                    "op": "<=", "value": 25,
                }],
            }],
            "default": {"value": "y", "label": "Y"},
        }
        response = self.client.get(self._url(formula))
        self.assertEqual(response.status_code, 400)

    def test_malformed_formula_rejected(self):
        url = (
            f"{self.BASE_URL}"
            f"?parent_form_id={self.REGISTRATION_FORM_ID}"
            f"&group_by=parent_id"
            f"&formula={quote('not json')}"
        )
        response = self.client.get(url)
        self.assertEqual(response.status_code, 400)


@override_settings(USE_TZ=False, TEST_ENV=True)
class FormulaValuesRegistrationFallbackTests(
    VisualizationValuesTestMixin, APITestCase
):
    """Cross-form scope with registration-fallback behaviour.

    Exercises the two layers the endpoint composes: the registration
    datapoint's own answers, overlaid by the latest cross-form
    monitoring answers. ``group`` is always the registration datapoint
    id so the frontend's byParent[point.id] lookup matches.
    """

    BASE_URL = "/api/v1/visualization/values/formula"

    def setUp(self):
        super().setUp()
        # Registration-only option question (site_type, Q_REG_OPTION_ID):
        # reg1 = yes, reg2 = no. This name exists on no monitoring form,
        # so only the registration fallback can supply it.
        Answers.objects.create(
            data=self.reg1,
            question=self.q_reg_option,
            options=["yes"],
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.reg2,
            question=self.q_reg_option,
            options=["no"],
            created_by=self.user,
        )
        refresh_all_mvs()

    def _url(self, formula):
        return (
            f"{self.BASE_URL}"
            f"?parent_form_id={self.REGISTRATION_FORM_ID}"
            f"&group_by=parent_id"
            f"&formula={_encode(formula)}"
        )

    def _site_type_formula(self):
        return {
            "buckets": [{
                "value": "yes",
                "label": "Yes",
                "all_of": [{
                    "question_name": self.q_reg_option.name,
                    "op": "option_equals",
                    "value": "yes",
                }],
            }],
            "default": {"value": "no", "label": "No"},
        }

    def test_registration_only_question_uses_fallback(self):
        """A registration-only question resolves from the fallback layer,
        grouped by the registration datapoint's own id."""
        response = self.client.get(self._url(self._site_type_formula()))
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        self.assertEqual(rows[self.reg1.id], "yes")
        self.assertEqual(rows[self.reg2.id], "no")

    def test_registration_fallback_excludes_pending(self):
        """A pending registration datapoint drops out entirely: it is
        excluded from the fallback layer and its monitoring children are
        excluded from the cross-form layer (parent must be non-pending)."""
        FormData.objects.filter(id=self.reg1.id).update(is_pending=True)
        refresh_all_mvs()
        response = self.client.get(self._url(self._site_type_formula()))
        self.assertEqual(response.status_code, 200)
        groups = [row["group"] for row in response.json()["data"]]
        self.assertNotIn(self.reg1.id, groups)
        self.assertIn(self.reg2.id, groups)

    def test_monitoring_overlays_registration(self):
        """When the same question_name exists on both the registration and
        a monitoring form, the latest monitoring answer wins."""
        # Add a registration-side question sharing the monitoring
        # question name "operational_status". reg1's registration answer
        # is 'inactive'; its latest monitoring answer is 'active'.
        shared = Questions.objects.create(
            form=self.registration,
            question_group=self.q_reg_option.question_group,
            name=self.q_option.name,
            label="Operational status (registration)",
            type=QuestionTypes.option,
            order=99,
        )
        Answers.objects.create(
            data=self.reg1,
            question=shared,
            options=["inactive"],
            created_by=self.user,
        )
        refresh_all_mvs()
        formula = {
            "buckets": [{
                "value": "active",
                "label": "Active",
                "all_of": [{
                    "question_name": self.q_option.name,
                    "op": "option_equals",
                    "value": "active",
                }],
            }],
            "default": {"value": "other", "label": "Other"},
        }
        response = self.client.get(self._url(formula))
        self.assertEqual(response.status_code, 200)
        rows = {
            row["group"]: row["label"]
            for row in response.json()["data"]
        }
        # Monitoring 'active' overlays registration 'inactive'.
        self.assertEqual(rows[self.reg1.id], "active")
