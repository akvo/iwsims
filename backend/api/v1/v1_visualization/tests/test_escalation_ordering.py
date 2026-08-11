from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_visualization.escalation_functions import (
    apply_escalation_ordering,
)


class DummyQuerySet:
    """Records what apply_escalation_ordering asks of a queryset.

    The ordering helper is pure query construction — it annotates and orders
    but never evaluates — so a recorder is enough to pin its decisions without
    standing up form data and refreshing materialized views.
    """

    def __init__(self):
        self.annotated = None
        self.ordering = None

    def annotate(self, **kwargs):
        self.annotated = kwargs
        return self

    def order_by(self, *args):
        self.ordering = args
        return self


DATE_COL = {
    "key": "last_inspected",
    "source": "latest_date",
    "question_name": "inspection_date",
}
NAME_COL = {"key": "name", "source": "parent_name"}


@override_settings(USE_TZ=True)
class EscalationOrderingTestCase(TestCase):
    def test_falls_back_to_id_when_no_order_requested(self):
        qs = DummyQuerySet()
        apply_escalation_ordering(qs, [DATE_COL], None, "desc")
        self.assertEqual(qs.ordering, ("id",))
        self.assertIsNone(qs.annotated)

    def test_falls_back_to_id_for_an_unknown_column_key(self):
        # A stale config must degrade quietly rather than 500.
        qs = DummyQuerySet()
        apply_escalation_ordering(qs, [DATE_COL], "nope", "desc")
        self.assertEqual(qs.ordering, ("id",))

    def test_falls_back_to_id_for_a_non_date_column(self):
        # Only latest_date columns carry something sortable.
        qs = DummyQuerySet()
        apply_escalation_ordering(qs, [NAME_COL], "name", "desc")
        self.assertEqual(qs.ordering, ("id",))

    def test_orders_descending_by_the_date_answer(self):
        qs = DummyQuerySet()
        apply_escalation_ordering(qs, [DATE_COL], "last_inspected", "desc")
        self.assertIn("_order_key", qs.annotated)
        expression, tiebreak = qs.ordering
        self.assertTrue(expression.descending)
        self.assertEqual(expression.nulls_last, True)
        self.assertEqual(tiebreak, "id")

    def test_orders_ascending_when_asked(self):
        qs = DummyQuerySet()
        apply_escalation_ordering(qs, [DATE_COL], "last_inspected", "asc")
        expression, _ = qs.ordering
        self.assertFalse(expression.descending)
        self.assertEqual(expression.nulls_last, True)

    def test_defaults_to_descending_for_an_unrecognised_direction(self):
        qs = DummyQuerySet()
        apply_escalation_ordering(qs, [DATE_COL], "last_inspected", None)
        expression, _ = qs.ordering
        self.assertTrue(expression.descending)


class EscalationEmptyCriteriaTestCase(TestCase):
    """Empty criteria must mean "no filter", not "no rows".

    The two escalation paths diverge here without an explicit guard: the
    pinned-form filter starts from Q() and matches everything, while the
    cross-form one accumulates a set and would match nothing. Both are
    branched on `if criteria:` in the handlers, which also skips materialising
    every parent id — the reason an unfiltered listing used to cost O(fleet)
    per page.
    """

    def test_pinned_filter_from_empty_criteria_matches_everything(self):
        from django.db.models import Q
        from api.v1.v1_visualization.escalation_functions import (
            build_escalation_criteria_filter,
        )

        self.assertEqual(build_escalation_criteria_filter([], []), Q())

    def test_cross_form_filter_from_empty_criteria_matches_nothing(self):
        # Documents WHY the handler needs the branch: relying on this
        # function's empty-criteria result would silently return no rows.
        from api.v1.v1_visualization.escalation_functions import (
            build_cross_form_escalation_filter,
        )

        self.assertEqual(
            build_cross_form_escalation_filter([], [1, 2, 3], 999), set()
        )

    def test_serializer_accepts_missing_and_blank_criteria(self):
        from api.v1.v1_visualization.dashboard_serializers import (
            EscalationFilterSerializer,
        )

        for params in (
            {"columns": "name:parent_name"},
            {"columns": "name:parent_name", "criteria": ""},
            {"columns": "name:parent_name", "criteria": "   "},
        ):
            serializer = EscalationFilterSerializer(data=params)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            self.assertEqual(
                serializer.validated_data.get("criteria") or [], []
            )

    def test_serializer_still_rejects_malformed_criteria(self):
        from api.v1.v1_visualization.dashboard_serializers import (
            EscalationFilterSerializer,
        )

        serializer = EscalationFilterSerializer(
            data={"columns": "name:parent_name", "criteria": "nonsense"}
        )
        self.assertFalse(serializer.is_valid())
