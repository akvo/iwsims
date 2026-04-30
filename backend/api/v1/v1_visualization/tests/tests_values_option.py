from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ValuesOptionTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test option/multiple_option handling for /visualization/values.

    Test data (from mixin setUp):
    - reg1:
        - mon1a (Jan): option=active, multi=[feature_x, feature_y]
        - mon1b (Mar, latest): option=active, multi=[feature_y, feature_z]
    - reg2:
        - mon2a (Jan): option=inactive, multi=[feature_x, feature_z]
        - mon2b (Mar, latest): option=pending,
          multi=[feature_x, feature_y, feature_z]
    """

    def test_option_group_by_option_all(self):
        """Option question group_by=option, monitoring=all.

        All 4 monitoring: active(2), inactive(1), pending(1).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 3)

        values_by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(values_by_group["active"]["value"], 2)
        self.assertEqual(values_by_group["active"]["color"], "#64A73B")
        self.assertEqual(values_by_group["inactive"]["value"], 1)
        self.assertEqual(values_by_group["inactive"]["color"], "#e41a1c")
        self.assertEqual(values_by_group["pending"]["value"], 1)
        self.assertEqual(values_by_group["pending"]["color"], "#ff7f00")

    def test_option_group_by_option_latest(self):
        """Option question group_by=option, monitoring=latest.

        Latest: reg1→active, reg2→pending.
        Expected: active(1), pending(1), inactive(0) — all options
        present so pie/doughnut charts have stable legends and colors.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        values_by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(values_by_group["active"]["value"], 1)
        self.assertEqual(values_by_group["pending"]["value"], 1)
        # Zero-count options MUST be present for chart stability
        self.assertIn("inactive", values_by_group)
        self.assertEqual(values_by_group["inactive"]["value"], 0)
        self.assertEqual(
            values_by_group["inactive"]["color"], "#e41a1c"
        )

    def test_option_group_by_option_all_options_in_labels(self):
        """All defined options must appear in data and labels array.

        Even with monitoring=latest where "inactive" has 0 records,
        the labels array must list all 3 options so the frontend
        pie chart renders a complete legend.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["data"]), 3)
        groups = {d["group"] for d in data["data"]}
        self.assertEqual(groups, {"active", "inactive", "pending"})
        labels = set(data["labels"])
        self.assertEqual(labels, {"Active", "Inactive", "Pending"})

    def test_option_group_by_option_empty_dataset(self):
        """No matching records — still return all options with value=0.

        Filter by a date range with no monitoring records. All 3
        operational_status options must appear with value=0 so the
        frontend can render an empty-but-labeled pie chart.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=all"
            "&from_date=2020-01-01&to_date=2020-12-31"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 3)
        for row in data["data"]:
            self.assertEqual(row["value"], 0)
        groups = {d["group"] for d in data["data"]}
        self.assertEqual(groups, {"active", "inactive", "pending"})

    def test_option_group_by_option_percentage_zero_count(self):
        """Percentage mode must include zero-count options as 0.0.

        Latest monitoring: active=50%, pending=50%, inactive=0%.
        All 3 must be in the response.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_group = {
            d["group"]: d["value"] for d in data["data"]
        }
        self.assertEqual(len(data["data"]), 3)
        self.assertEqual(values_by_group["active"], 50.0)
        self.assertEqual(values_by_group["pending"], 50.0)
        self.assertEqual(values_by_group["inactive"], 0.0)

    def test_option_group_by_option_percentage_sums_to_100(self):
        """Percentages must sum to 100 across options (pie semantics).

        monitoring=all: active(2), inactive(1), pending(1). Sum=4.
        Expected: active=50%, inactive=25%, pending=25%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=all"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_group = {
            d["group"]: d["value"] for d in data["data"]
        }
        self.assertEqual(values_by_group["active"], 50.0)
        self.assertEqual(values_by_group["inactive"], 25.0)
        self.assertEqual(values_by_group["pending"], 25.0)
        self.assertEqual(
            sum(values_by_group.values()), 100.0
        )

    def test_multiple_option_group_by_option_percentage(self):
        """Multiple_option percentage = share-of-selections.

        feature_x=3, feature_y=3, feature_z=3. Sum=9.
        Each ≈ 33.33%. Sum ≈ 100 (rounding).
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_multi.id}"
            "&group_by=option&monitoring=all"
            "&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        values_by_group = {
            d["group"]: d["value"] for d in data["data"]
        }
        self.assertEqual(values_by_group["feature_x"], 33.33)
        self.assertEqual(values_by_group["feature_y"], 33.33)
        self.assertEqual(values_by_group["feature_z"], 33.33)

    def test_multiple_option_group_by_option(self):
        """Multiple option question group_by=option, monitoring=all.

        All 4 monitoring multi selections:
        - mon1a: [feature_x, feature_y]
        - mon1b: [feature_y, feature_z]
        - mon2a: [feature_x, feature_z]
        - mon2b: [feature_x, feature_y, feature_z]
        Counts: feature_x=3, feature_y=3, feature_z=3
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_multi.id}"
            "&group_by=option&monitoring=all"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 3)

        values_by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(values_by_group["feature_x"]["value"], 3)
        self.assertEqual(values_by_group["feature_y"]["value"], 3)
        self.assertEqual(values_by_group["feature_z"]["value"], 3)

    def test_option_value_count(self):
        """Filter by option_value with sum_by=parent_id.

        option_value=active, monitoring=latest.
        Latest: reg1→active, reg2→pending.
        Count of parents with active: 1.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=active&sum_by=parent_id&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["value"], 1)

    def test_option_value_group_by_month_with_date_qid(self):
        """option_value + group_by=month buckets by date_question_id.

        Latest monitoring (after option_value='active' filter):
        - mon1b: inspection_date 2025-03-10 → bucket "2025-03"
        Expected: one bucket "2025-03" with value=1.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=active&monitoring=latest"
            f"&group_by=month&date_question_id={self.q_date.id}"
            "&sum_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["group"], "2025-03")
        self.assertEqual(data["data"][0]["value"], 1)
        self.assertEqual(data["data"][0]["label"], "Mar 2025")

    def test_option_value_group_by_month_gap_fill(self):
        """Gap-fill produces zero buckets across the from/to range.

        With from_date=2025-01-01 to_date=2025-04-30 we expect 4
        monthly buckets; only 2025-03 has a count, the others are 0.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=active&monitoring=latest"
            f"&group_by=month&date_question_id={self.q_date.id}"
            "&sum_by=parent_id"
            "&from_date=2025-01-01&to_date=2025-04-30"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        groups = [d["group"] for d in data["data"]]
        self.assertEqual(
            groups,
            ["2025-01", "2025-02", "2025-03", "2025-04"],
        )
        values = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(values["2025-01"], 0)
        self.assertEqual(values["2025-02"], 0)
        self.assertEqual(values["2025-03"], 1)
        self.assertEqual(values["2025-04"], 0)

    def test_option_value_group_by_month_no_match(self):
        """No record matches option_value → empty data list."""
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=does_not_exist&monitoring=latest"
            f"&group_by=month&date_question_id={self.q_date.id}"
            "&sum_by=parent_id"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["data"], [])

    def test_option_value_percentage(self):
        """Filter by option_value with value_type=percentage.

        option_value=active, monitoring=latest, value_type=percentage.
        1 out of 2 parents = 50%.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&option_value=active&sum_by=parent_id"
            "&monitoring=latest&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["value"], 50.0)

    # -- include_unanswered tests --

    def test_include_unanswered_appends_no_info_row(self):
        """include_unanswered=true appends _no_info for unmonitored parents.

        Mixin has 2 parents, both monitored (latest: reg1=active,
        reg2=pending). Create 3 more registrations without monitoring.
        Expected: active=1, inactive=0, pending=1, _no_info=3.
        """
        for i in range(3):
            self.reg_extra = self._create_registration(
                name=f"Extra Site {i}",
                administration=self.adm_parent,
            )

        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        by_group = {d["group"]: d for d in data["data"]}
        self.assertEqual(by_group["active"]["value"], 1)
        self.assertEqual(by_group["pending"]["value"], 1)
        self.assertIn("_no_info", by_group)
        self.assertEqual(by_group["_no_info"]["value"], 3)
        self.assertEqual(by_group["_no_info"]["color"], "#bfbfbf")
        self.assertEqual(
            by_group["_no_info"]["label"], "No information available"
        )
        # _no_info must be the last row
        self.assertEqual(data["data"][-1]["group"], "_no_info")

    def test_include_unanswered_default_false_unchanged(self):
        """Without the flag the response is identical to the baseline.

        The baseline (test_option_group_by_option_latest) returns
        active=1, pending=1, inactive=0. No _no_info row.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        groups = {d["group"] for d in data["data"]}
        self.assertNotIn("_no_info", groups)
        self.assertEqual(len(data["data"]), 3)

    def test_include_unanswered_multiple_option_distinct_parents(self):
        """Multi-choice: _no_info uses distinct-parent count, not subtraction.

        Mixin: 2 parents, both have latest monitoring with multi answers.
        Add 1 extra registration without monitoring.
        _no_info = 1 (not 3 - sum of multi selections).
        """
        self._create_registration(
            name="Unmonitored Multi",
            administration=self.adm_parent,
        )
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_multi.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        by_group = {d["group"]: d for d in data["data"]}
        self.assertIn("_no_info", by_group)
        self.assertEqual(by_group["_no_info"]["value"], 1)

    def test_include_unanswered_percentage_sums_100_single_choice(self):
        """Percentage with include_unanswered: single-choice sums to 100%.

        Mixin has 2 parents monitored (active=1, pending=1).
        Add 2 extra registrations without monitoring.
        Total parents = 4. active=1, pending=1, _no_info=2.
        Percentages: active=25%, inactive=0%, pending=25%, _no_info=50%.
        Sum of all = 100%.
        """
        for i in range(2):
            self._create_registration(
                name=f"Pct Extra {i}",
                administration=self.adm_parent,
            )
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertEqual(by_group["active"], 25.0)
        self.assertEqual(by_group["inactive"], 0.0)
        self.assertEqual(by_group["pending"], 25.0)
        self.assertEqual(by_group["_no_info"], 50.0)
        self.assertAlmostEqual(sum(by_group.values()), 100.0, places=1)

    def test_include_unanswered_respects_administration_filter(self):
        """Administration filter narrows the bucket to the filtered universe.

        adm_parent (level 0) has reg1. adm_child (level 1) has reg2.
        When filtering to adm_child, only 1 parent is in scope.
        Latest for adm_child: reg2 = pending → 0 unanswered.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        by_group = {d["group"]: d for d in data["data"]}
        # reg2 (child) has pending answer → qualifying_parents = {reg2}
        # total in admin_child scope = 1 → bucket = 0 → no _no_info row
        self.assertNotIn("_no_info", by_group)
        self.assertEqual(by_group["pending"]["value"], 1)

    def test_include_unanswered_zero_bucket_emits_no_row(self):
        """When all parents are monitored, _no_info row is not appended.

        Mixin: both registrations have monitoring. Bucket = 0.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        groups = {d["group"] for d in data["data"]}
        self.assertNotIn("_no_info", groups)
        self.assertEqual(len(data["data"]), 3)

    def test_include_unanswered_excludes_soft_deleted_parents(self):
        """Soft-deleted parents are not counted in the bucket.

        Add 2 extra registrations, soft-delete one. Bucket = 1.
        """
        extra1 = self._create_registration(
            name="SoftDelete Site",
            administration=self.adm_parent,
        )
        self._create_registration(
            name="Normal Site",
            administration=self.adm_parent,
        )
        # Soft-delete extra1 via the SoftDeletes mixin
        extra1.delete()

        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_option.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        by_group = {d["group"]: d for d in data["data"]}
        self.assertIn("_no_info", by_group)
        # Only 1 non-deleted extra registration is unmonitored
        self.assertEqual(by_group["_no_info"]["value"], 1)

    def test_include_unanswered_ignored_on_registration_form(self):
        """Flag is silently ignored for registration-form questions (FR-7).

        The registration form has no parent, so _count_no_info_parents
        returns 0 and the bucket is never appended.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.registration.id}"
            f"&question_id={self.q_reg_option.id}"
            "&group_by=option"
            "&include_unanswered=true"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        groups = {d["group"] for d in data["data"]}
        self.assertNotIn("_no_info", groups)

    def test_include_unanswered_ignored_on_count_mode(self):
        """Flag is silently ignored when no question_id (count mode, FR-7).

        No per-option breakdown → no bucket makes sense.
        """
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            "&include_unanswered=true"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        groups = {d.get("group") for d in data["data"]}
        self.assertNotIn("_no_info", groups)

    def test_include_unanswered_percentage_multi_choice_denominator(self):
        """Multi-choice percentage uses distinct-parent denominator.

        Mixin: 2 parents monitored (both have multi answers for feature_*).
        Add 2 extra registrations without monitoring.
        Total parents = 4, qualifying = 2, bucket = 2.
        feature_y latest: reg1(mon1b)=[feature_y,feature_z],
                          reg2(mon2b)=[feature_x,feature_y,feature_z]
        feature_y tally = 2, denom = 2 qualifying + 2 bucket = 4.
        feature_y % = 2/4*100 = 50%.
        """
        for i in range(2):
            self._create_registration(
                name=f"Multi Pct Extra {i}",
                administration=self.adm_parent,
            )
        response = self.client.get(
            f"{self.BASE_URL}?form_id={self.monitoring.id}"
            f"&question_id={self.q_multi.id}"
            "&group_by=option&monitoring=latest"
            "&include_unanswered=true&value_type=percentage"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        by_group = {d["group"]: d["value"] for d in data["data"]}
        self.assertIn("_no_info", by_group)
        self.assertEqual(by_group["_no_info"], 50.0)
        # feature_y appears in both latest submissions; 2/4 = 50%
        self.assertEqual(by_group["feature_y"], 50.0)

    # -- Helper for tests that need additional registrations --

    def _create_registration(self, name, administration):
        """Create a registration FormData without any monitoring."""
        from api.v1.v1_data.models import FormData as _FD
        return _FD.objects.create(
            name=name,
            form=self.registration,
            administration=administration,
            created_by=self.user,
        )
