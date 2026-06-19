from django.test.utils import override_settings
from rest_framework.test import APITestCase

from api.v1.v1_data.models import Answers
from api.v1.v1_forms.models import (
    Questions,
    QuestionOptions,
    QuestionTypes,
)
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

    def test_multiple_option_group_by_option_combo_by_question_name(self):
        """question_name path supports mutually exclusive combo buckets."""
        response = self.client.get(
            f"{self.BASE_URL}?question_name=features"
            "&group_by=option_combo"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {
            d["group"]: d["value"]
            for d in response.json()["data"]
        }
        self.assertEqual(by_group["feature_x"], 0)
        self.assertEqual(by_group["feature_y"], 0)
        self.assertEqual(by_group["feature_z"], 0)
        self.assertEqual(by_group["feature_y|feature_z"], 1)
        self.assertEqual(
            by_group["feature_x|feature_y|feature_z"], 1
        )

    def test_two_option_combo_includes_both_bucket_by_question_name(self):
        """Two-option combo mode exposes a stable Both bucket."""
        question = Questions.objects.create(
            form=self.monitoring,
            question_group=self.q_multi.question_group,
            name="sample_method",
            label="Sample Method",
            type=QuestionTypes.multiple_option,
            order=99,
        )
        QuestionOptions.objects.create(
            question=question,
            value="lab_test",
            label="Lab Test",
            order=1,
        )
        QuestionOptions.objects.create(
            question=question,
            value="cbt_bag_test",
            label="CBT Bag Test",
            order=2,
        )
        Answers.objects.create(
            data=self.mon1b,
            question=question,
            options=["lab_test", "cbt_bag_test"],
            created_by=self.user,
        )
        Answers.objects.create(
            data=self.mon2b,
            question=question,
            options=["lab_test"],
            created_by=self.user,
        )
        refresh_all_mvs()

        response = self.client.get(
            f"{self.BASE_URL}?question_name=sample_method"
            "&group_by=option_combo"
            f"&parent_form_id={self.registration.id}"
        )
        self.assertEqual(response.status_code, 200)
        by_group = {
            d["group"]: d
            for d in response.json()["data"]
        }
        self.assertEqual(by_group["lab_test|cbt_bag_test"]["label"], "Both")
        self.assertEqual(by_group["lab_test|cbt_bag_test"]["value"], 1)

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
