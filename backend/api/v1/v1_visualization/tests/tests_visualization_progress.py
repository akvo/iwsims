from django.test.utils import override_settings
from rest_framework.test import APITestCase
from api.v1.v1_visualization.tests.mixins import (
    VisualizationValuesTestMixin,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class ProgressTestCases(VisualizationValuesTestMixin, APITestCase):
    """Test /visualization/progress/{form_id} endpoint.

    Uses query-param-driven components with formulas.

    Test data (from mixin setUp):
    - reg1 (Site Alpha):
        - mon1b (latest): operational_status=active,
          measurement=20.0, features=[feature_y, feature_z]
    - reg2 (Site Beta):
        - mon2b (latest): operational_status=pending,
          measurement=40.0, features=[feature_x, feature_y, feature_z]

    For progress formulas, we use existing questions creatively:
    - any_yes via option question (600203): active → yes-like
    - completed_binary via option question (600203)
    - ratio via number question (600202): implemented/planned with the
      same QID for both → 100%
    - multi_select_proportion via multi option (600204): count/total
    """

    BASE_PROGRESS_URL = "/api/v1/visualization/progress"

    # -- Error cases --

    def test_missing_monitoring_form_id(self):
        """monitoring_form_id is required — returns 400."""
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            "?components=base:ratio:600202:600202"
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_components(self):
        """components is required — returns 400."""
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_form_id(self):
        """Non-existent form_id — returns 404."""
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/99999"
            f"?monitoring_form_id={self.monitoring.id}"
            "&components=base:ratio:600202"
        )
        self.assertEqual(response.status_code, 404)

    def test_invalid_formula(self):
        """Invalid formula type — returns 400."""
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            "&components=base:invalid_formula:600202"
        )
        self.assertEqual(response.status_code, 400)

    # -- Formula: ratio --

    def test_ratio_formula(self):
        """Ratio formula: (implemented / planned) * 100, clamped to 100.

        Test reuses Q_NUMBER_ID for both implemented and planned, so
        the ratio is 1.0 → 100% for any non-zero value.

        Latest monitoring values:
        - reg1 (mon1b): measurement_value = 20.0 → 20/20 = 100%
        - reg2 (mon2b): measurement_value = 40.0 → 40/40 = 100%
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertIn("histogram", data)
        self.assertIn("details", data)
        self.assertEqual(len(data["details"]), 2)

        details_by_label = {
            d["label"]: d for d in data["details"]
        }
        self.assertEqual(
            details_by_label["Site Alpha"]["components"]["quality"],
            100.0,
        )
        self.assertEqual(
            details_by_label["Site Beta"]["components"]["quality"],
            100.0,
        )
        self.assertEqual(
            details_by_label["Site Alpha"]["overall"], 100.0
        )
        self.assertEqual(
            details_by_label["Site Beta"]["overall"], 100.0
        )

    def test_ratio_requires_two_qids(self):
        """ratio with single QID returns 400."""
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio:{self.Q_NUMBER_ID}"
        )
        self.assertEqual(response.status_code, 400)

    # -- Formula: multi_select_proportion --

    def test_multi_select_proportion_formula(self):
        """Multi-select proportion: selected / total_items * 100.

        Latest monitoring features:
        - reg1 (mon1b): [feature_y, feature_z] → 2/3 = 66.67%
        - reg2 (mon2b): [feature_x, feature_y, feature_z] → 3/3 = 100%

        Component format: key:multi_select_proportion:qid:total_items
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=features:multi_select_proportion"
            f":{self.Q_MULTI_ID}:3"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        details_by_label = {
            d["label"]: d for d in data["details"]
        }
        self.assertAlmostEqual(
            details_by_label["Site Alpha"]["components"]["features"],
            66.67, places=2,
        )
        self.assertEqual(
            details_by_label["Site Beta"]["components"]["features"],
            100.0,
        )

    # -- Multiple components + overall --

    def test_multiple_components_overall(self):
        """Multiple components — overall is average.

        Components:
        - quality: ratio (implemented==planned via same QID)
            reg1=100%, reg2=100%
        - features: multi_select_proportion on features (total=3)
            reg1=66.67%, reg2=100%

        Overall:
        - reg1 = (100 + 66.67) / 2 = 83.3
        - reg2 = (100 + 100) / 2 = 100
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
            f",features:multi_select_proportion:{self.Q_MULTI_ID}:3"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        details_by_label = {
            d["label"]: d for d in data["details"]
        }
        self.assertAlmostEqual(
            details_by_label["Site Alpha"]["overall"],
            83.3, places=1,
        )
        self.assertAlmostEqual(
            details_by_label["Site Beta"]["overall"],
            100.0, places=1,
        )

    # -- Histogram --

    def test_histogram_buckets(self):
        """Histogram distributes overall progress into buckets.

        With ratio (implemented/planned, same QID for both):
        - reg1 = 100% → "91-100%" bucket
        - reg2 = 100% → "91-100%" bucket
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        histogram = data["histogram"]
        self.assertEqual(len(histogram), 10)

        buckets = {h["progress"]: h["count"] for h in histogram}
        self.assertEqual(buckets["91-100%"], 2)
        for key, val in buckets.items():
            if key != "91-100%":
                self.assertEqual(val, 0, f"Bucket {key} should be 0")

    # -- Filter --

    def test_filter_by_option(self):
        """Filter progress to only parents matching an option value.

        filter_question_id=600203, filter_option_value=active.
        Latest: reg1→active, reg2→pending.
        Expected: only reg1 in results.
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
            f"&filter_question_id={self.Q_OPTION_ID}"
            "&filter_option_value=active"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["details"]), 1)
        self.assertEqual(data["details"][0]["label"], "Site Alpha")

    def test_administration_filter(self):
        """Progress filtered by administration.

        reg2 is in adm_child.
        Expected: only reg2 in results.
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
            f"&administration_id={self.adm_child.id}"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data["details"]), 1)
        self.assertEqual(data["details"][0]["label"], "Site Beta")

    # -- Criteria filter --

    def test_criteria_narrows_progress(self):
        """criteria=option_equals narrows latest monitoring records.

        Latest per parent: mon1b (active), mon2b (pending).
        option_equals:Q_OPTION_ID:active → only reg1.
        """
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
            f"&criteria=option_equals:{self.Q_OPTION_ID}:active"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["details"]), 1)
        self.assertEqual(
            data["details"][0]["label"], "Site Alpha"
        )

    def test_criteria_multiple_option_contains(self):
        """option_contains on multiple_option (features)."""
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=features:multi_select_proportion"
            f":{self.Q_MULTI_ID}:3"
            f"&criteria=option_contains:{self.Q_MULTI_ID}"
            ":feature_x"
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # mon2b has feature_x, mon1b does not
        self.assertEqual(len(data["details"]), 1)
        self.assertEqual(data["details"][0]["label"], "Site Beta")

    def test_criteria_malformed_returns_400(self):
        response = self.client.get(
            f"{self.BASE_PROGRESS_URL}/{self.registration.id}"
            f"?monitoring_form_id={self.monitoring.id}"
            f"&components=quality:ratio"
            f":{self.Q_NUMBER_ID}:{self.Q_NUMBER_ID}"
            "&criteria=bogus_type:1:2"
        )
        self.assertEqual(response.status_code, 400)
