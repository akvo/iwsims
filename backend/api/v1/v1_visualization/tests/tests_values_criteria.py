from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesCriteriaTestCases(
    VisualizationValuesTestMixin, APITestCase
):
    """Test multi-criteria (AND) filter on /visualization/values.

    Dataset (monitoring=all):
      mon1a: option=active,   multi=[feature_x, feature_y]
      mon1b: option=active,   multi=[feature_y, feature_z]
      mon2a: option=inactive, multi=[feature_x, feature_z]
      mon2b: option=pending,  multi=[feature_x, feature_y, feature_z]
    """

    def _url(self, suffix):
        return (
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&monitoring=all{suffix}"
        )

    def test_single_option_criterion_narrows_count(self):
        response = self.client.get(self._url(
            f"&criteria=option_equals:{self.q_option.id}:active"
        ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"][0]["value"], 2
        )

    def test_multiple_option_contains_match(self):
        response = self.client.get(self._url(
            f"&criteria=option_contains:{self.q_multi.id}"
            ":feature_x"
        ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"][0]["value"], 3
        )

    def test_option_equals_on_multiple_option_also_works(self):
        """option_equals on multiple_option uses array containment."""
        response = self.client.get(self._url(
            f"&criteria=option_equals:{self.q_multi.id}"
            ":feature_x"
        ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"][0]["value"], 3
        )

    def test_two_criteria_and(self):
        """AND across questions: active AND has feature_x."""
        response = self.client.get(self._url(
            f"&criteria=option_equals:{self.q_option.id}:active,"
            f"option_contains:{self.q_multi.id}:feature_x"
        ))
        self.assertEqual(response.status_code, 200)
        # mon1a matches both; mon1b active but no feature_x
        self.assertEqual(
            response.json()["data"][0]["value"], 1
        )

    def test_option_in_multiple_values(self):
        """OR within a question via option_in."""
        response = self.client.get(self._url(
            f"&criteria=option_in:{self.q_option.id}"
            ":active|inactive"
        ))
        self.assertEqual(response.status_code, 200)
        # mon1a, mon1b, mon2a
        self.assertEqual(
            response.json()["data"][0]["value"], 3
        )

    def test_threshold_gt(self):
        """Numeric threshold criterion."""
        response = self.client.get(self._url(
            f"&criteria=threshold_gt:{self.q_number.id}:20"
        ))
        self.assertEqual(response.status_code, 200)
        # mon2a=30, mon2b=40 → 2
        self.assertEqual(
            response.json()["data"][0]["value"], 2
        )

    def test_criteria_and_date_and_admin_stack(self):
        """criteria composes with from_date/to_date and admin."""
        response = self.client.get(self._url(
            f"&criteria=option_equals:{self.q_option.id}:active"
            "&from_date=2025-03-01"
        ))
        self.assertEqual(response.status_code, 200)
        # Only mon1b (active + Mar)
        self.assertEqual(
            response.json()["data"][0]["value"], 1
        )

    def test_malformed_criteria_returns_400(self):
        response = self.client.get(self._url(
            "&criteria=not_a_type:1:2"
        ))
        self.assertEqual(response.status_code, 400)

    def test_criteria_missing_parts_returns_400(self):
        response = self.client.get(self._url(
            f"&criteria=option_equals:{self.q_option.id}"
        ))
        self.assertEqual(response.status_code, 400)

    def test_criteria_with_wrong_form_qid_returns_400(self):
        response = self.client.get(self._url(
            "&criteria=option_equals:999999:active"
        ))
        self.assertEqual(response.status_code, 400)

    def test_threshold_non_numeric_returns_400(self):
        response = self.client.get(self._url(
            f"&criteria=threshold_gt:{self.q_number.id}:abc"
        ))
        self.assertEqual(response.status_code, 400)

    def test_criteria_narrows_donut(self):
        """Donut (group_by=option) respects criteria."""
        # Restrict to mon2b (pending) via feature_y AND feature_z
        # contain. mon1b has y+z too but option=active.
        response = self.client.get(self._url(
            f"&question_id={self.q_option.id}&group_by=option"
            f"&criteria=option_contains:{self.q_multi.id}:feature_y"
            f",option_contains:{self.q_multi.id}:feature_z"
        ))
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        by_group = {d["group"]: d["value"] for d in data}
        # mon1b=active, mon2b=pending match → active:1, pending:1
        self.assertEqual(by_group.get("active"), 1)
        self.assertEqual(by_group.get("pending"), 1)
        self.assertEqual(by_group.get("inactive"), 0)

    def test_option_value_backcompat_still_works(self):
        """Legacy option_value param unaffected by criteria feature."""
        response = self.client.get(self._url(
            f"&question_id={self.q_option.id}"
            "&option_value=active"
        ))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"][0]["value"], 2
        )

    def test_cross_form_criteria_narrows_monitoring(self):
        """Criteria on registration-form question narrows
        monitoring-form results via parent_criteria auto-split.

        reg1 has reg_option=type_a (added below).
        reg2 has reg_option=type_b.
        Filtering monitoring form by reg_option=type_a
        should return only mon1a/mon1b (reg1's children).
        """
        from api.v1.v1_data.models import Answers
        Answers.objects.create(
            data=self.reg1,
            question=self.q_reg_option,
            options=["type_a"],
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.reg2,
            question=self.q_reg_option,
            options=["type_b"],
            created_by=self.user,
        )
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&monitoring=all"
            f"&criteria=option_equals:{self.q_reg_option.id}:type_a"
        )
        self.assertEqual(response.status_code, 200)
        # Only reg1's 2 monitoring records
        self.assertEqual(
            response.json()["data"][0]["value"], 2
        )

    def test_cross_form_criteria_latest_mode(self):
        """Cross-form criteria in latest mode (default)."""
        from api.v1.v1_data.models import Answers
        Answers.objects.create(
            data=self.reg1,
            question=self.q_reg_option,
            options=["type_a"],
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.reg2,
            question=self.q_reg_option,
            options=["type_b"],
            created_by=self.user,
        )
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&criteria=option_equals:{self.q_reg_option.id}:type_a"
        )
        self.assertEqual(response.status_code, 200)
        # Latest mode: 1 parent → 1 latest monitoring
        self.assertEqual(
            response.json()["data"][0]["value"], 1
        )
