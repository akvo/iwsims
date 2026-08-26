from django.core.management import call_command
from django.test import TestCase, override_settings

from api.v1.v1_data.models import Answers, FormData
from api.v1.v1_forms.constants import QuestionTypes
from api.v1.v1_forms.models import Questions
from api.v1.v1_jobs.seed_data import (
    collect_answers,
    get_administration,
    get_geo_value,
)
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin
from api.v1.v1_users.models import SystemUser

TEST_FORM_ID = 1


@override_settings(USE_TZ=False, TEST_ENV=True)
class CollectAnswersTestCase(TestCase, ProfileTestHelperMixin):
    """Per-question-type branches of the bulk-upload answer builder.

    collect_answers takes a plain dict, so these exercise the type handling
    directly instead of round-tripping an .xlsx fixture.

    Questions are resolved by QuestionTypes rather than by hard-coded id:
    the ids in source/forms/example-1.json are fixture detail, the types are
    what collect_answers actually branches on.
    """

    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        self.user = SystemUser.objects.create_superuser(
            email="collect@akvo.org", password="Test105*"
        )
        self.administration = Administration.objects.filter(
            parent__isnull=False
        ).first()
        self.questions = {
            q.id: q for q in Questions.objects.filter(form_id=TEST_FORM_ID)
        }

        self.q_option = self._question(QuestionTypes.option)
        self.q_multi = self._question(
            QuestionTypes.multiple_option, meta=False
        )
        self.q_multi_meta = self._question(
            QuestionTypes.multiple_option, meta=True
        )
        self.q_geo = self._question(QuestionTypes.geo)
        self.q_date = self._question(QuestionTypes.date)
        self.q_number = self._question(QuestionTypes.number, meta=False)
        self.q_number_meta = self._question(QuestionTypes.number, meta=True)
        self.q_admin = self._question(QuestionTypes.administration)
        self.q_input = self._question(QuestionTypes.input, meta=True)
        self.q_autofield = self._question(QuestionTypes.autofield)
        self.q_photo = self._question(QuestionTypes.photo)

    def _question(self, question_type, meta=None):
        """One question of a given type from the test form.

        Asserts rather than returning None, so a fixture that loses a type
        fails here instead of silently skipping the branch under test.
        """
        found = [
            q for q in self.questions.values()
            if q.type == question_type and (meta is None or q.meta == meta)
        ]
        label = QuestionTypes.FieldStr.get(question_type, question_type)
        self.assertTrue(
            found,
            f"test form has no {label} question with meta={meta}",
        )
        return found[0]

    def _collect(self, answers, data_id=None, geolocation=None):
        dp = {
            "data_id": float("nan"),
            "administration": self.administration.id,
            "geolocation": geolocation,
        }
        dp.update(answers)
        return collect_answers(
            user=self.user, dp=dp, qs=self.questions, data_id=data_id
        )

    def _answer_for(self, result, question):
        for a in result["answerlist"]:
            if a.question_id == question.id:
                return a
        return None

    # ---- option ---------------------------------------------------------
    def test_option_stores_a_single_element_list(self):
        res = self._collect({self.q_option.id: "male"})
        self.assertEqual(
            self._answer_for(res, self.q_option).options, ["male"]
        )

    def test_option_with_a_blank_cell_is_skipped(self):
        """An empty cell must not persist options=NULL.

        Every reader of an option answer assumes a list; a NULL there is what
        crashed the data download.
        doc/claude/download-fails-on-question-type-change.md
        """
        res = self._collect({self.q_option.id: ""})
        self.assertIsNone(self._answer_for(res, self.q_option))

    # ---- multiple_option ------------------------------------------------
    def test_multiple_option_splits_a_pipe_delimited_string(self):
        res = self._collect({self.q_multi.id: "cat|dog"})
        self.assertEqual(
            self._answer_for(res, self.q_multi).options, ["cat", "dog"]
        )

    def test_multiple_option_keeps_a_list_as_is(self):
        res = self._collect({self.q_multi.id: ["cat", "dog"]})
        self.assertEqual(
            self._answer_for(res, self.q_multi).options, ["cat", "dog"]
        )

    def test_multiple_option_coerces_a_numeric_code_to_a_list(self):
        """pandas reads a numeric option code as int/float.

        Storing the bare number makes every `for v in options` raise.
        """
        res = self._collect({self.q_multi.id: 12})
        self.assertEqual(self._answer_for(res, self.q_multi).options, ["12"])

    def test_multiple_option_with_no_value_is_skipped(self):
        res = self._collect({self.q_multi.id: None})
        self.assertIsNone(self._answer_for(res, self.q_multi))

    def test_multiple_option_meta_contributes_to_the_datapoint_name(self):
        res = self._collect({self.q_multi_meta.id: "parent|child"})
        self.assertIn("parent-child", res["name"])

    def test_multiple_option_meta_from_a_list(self):
        res = self._collect({self.q_multi_meta.id: ["parent", "child"]})
        self.assertIn("parent-child", res["name"])

    def test_multiple_option_meta_from_a_numeric_code(self):
        res = self._collect({self.q_multi_meta.id: 7})
        self.assertIn("7", res["name"])

    # ---- geo / date / number -------------------------------------------
    def test_geo_parses_a_delimited_string(self):
        res = self._collect({self.q_geo.id: "6.1|106.8"})
        self.assertEqual(
            self._answer_for(res, self.q_geo).options, [6.1, 106.8]
        )

    def test_geo_with_no_value_is_skipped(self):
        res = self._collect({self.q_geo.id: None})
        self.assertIsNone(self._answer_for(res, self.q_geo))

    def test_date_with_no_value_is_skipped(self):
        res = self._collect({self.q_date.id: None})
        self.assertIsNone(self._answer_for(res, self.q_date))

    def test_number_that_will_not_parse_is_skipped(self):
        res = self._collect({self.q_number.id: "not-a-number"})
        self.assertIsNone(self._answer_for(res, self.q_number))

    def test_number_meta_contributes_to_the_datapoint_name(self):
        res = self._collect({self.q_number_meta.id: 62812345})
        self.assertEqual(
            self._answer_for(res, self.q_number_meta).value, 62812345
        )
        self.assertIn("62812345", res["name"])

    # ---- administration -------------------------------------------------
    def test_administration_from_an_id(self):
        res = self._collect({self.q_admin.id: self.administration.id})
        answer = self._answer_for(res, self.q_admin)
        self.assertEqual(answer.value, self.administration.id)
        self.assertEqual(res["administration"], self.administration.id)
        self.assertIn(self.administration.name, res["name"])

    def test_administration_from_a_pipe_delimited_path(self):
        adm = Administration.objects.filter(parent__isnull=False).last()
        res = self._collect({self.q_admin.id: adm.full_path_name})
        self.assertEqual(res["administration"], adm.id)

    # ---- free text / media ----------------------------------------------
    def test_input_meta_contributes_to_the_datapoint_name(self):
        res = self._collect({self.q_input.id: "Jane Doe"})
        self.assertIn("Jane Doe", res["name"])

    def test_autofield_and_photo_are_stored_by_name(self):
        res = self._collect({
            self.q_autofield.id: "computed",
            self.q_photo.id: "photo.jpg",
        })
        self.assertEqual(
            self._answer_for(res, self.q_autofield).name, "computed"
        )
        self.assertEqual(
            self._answer_for(res, self.q_photo).name, "photo.jpg"
        )

    # ---- NaN cells ------------------------------------------------------
    def test_nan_cells_are_ignored(self):
        res = self._collect({self.q_input.id: float("nan")})
        self.assertIsNone(self._answer_for(res, self.q_input))

    def test_columns_that_are_not_questions_are_ignored(self):
        res = self._collect({999999: "orphan column"})
        self.assertEqual([a.question_id for a in res["answerlist"]], [])

    # ---- re-upload against an existing datapoint ------------------------
    def _existing_datapoint(self):
        return FormData.objects.create(
            name="Existing",
            form_id=TEST_FORM_ID,
            administration=self.administration,
            geo=[6.1, 106.8],
            created_by=self.user,
        )

    def test_a_question_with_no_previous_answer_is_added(self):
        data = self._existing_datapoint()
        res = self._collect({self.q_input.id: "Jane Doe"}, data_id=data.id)
        self.assertEqual(self._answer_for(res, self.q_input).name, "Jane Doe")
        self.assertEqual(res["answer_history_list"], [])

    def test_an_unchanged_answer_is_not_re_added(self):
        data = self._existing_datapoint()
        Answers.objects.create(
            data=data,
            question=self.q_input,
            name="Jane Doe",
            created_by=self.user,
        )
        res = self._collect({self.q_input.id: "Jane Doe"}, data_id=data.id)
        self.assertIsNone(self._answer_for(res, self.q_input))

    def test_a_changed_answer_is_moved_to_history_for_a_superadmin(self):
        data = self._existing_datapoint()
        Answers.objects.create(
            data=data,
            question=self.q_input,
            name="Old Name",
            created_by=self.user,
        )
        res = self._collect({self.q_input.id: "New Name"}, data_id=data.id)
        self.assertEqual(self._answer_for(res, self.q_input).name, "New Name")
        self.assertEqual(len(res["answer_history_list"]), 1)
        self.assertEqual(res["answer_history_list"][0].name, "Old Name")
        self.assertFalse(
            Answers.objects.filter(
                data=data, question=self.q_input
            ).exists()
        )

    def test_the_uuid_of_the_existing_datapoint_is_reused(self):
        data = self._existing_datapoint()
        res = self._collect({self.q_input.id: "Jane Doe"}, data_id=data.id)
        self.assertEqual(str(res["uuid"]), str(data.uuid))


@override_settings(USE_TZ=False, TEST_ENV=True)
class SeedDataHelperTestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")

    def test_get_geo_value_accepts_both_delimiters(self):
        self.assertEqual(get_geo_value("6.1,106.8"), [6.1, 106.8])
        self.assertEqual(get_geo_value("6.1|106.8"), [6.1, 106.8])

    def test_get_geo_value_passes_a_list_through(self):
        self.assertEqual(get_geo_value([6.1, 106.8]), [6.1, 106.8])

    def test_get_administration_resolves_the_deepest_match(self):
        adm = Administration.objects.filter(parent__isnull=False).first()
        self.assertEqual(get_administration(adm.full_path_name), adm)

    def test_get_administration_with_an_unknown_name(self):
        """Documents current behaviour, which is wrong.

        The loop variable shadows the return value, so when nothing matches
        the function returns the last *string* it looked at rather than None.
        Callers do `if adm: administration = adm.id`, so an unknown
        administration in an uploaded sheet raises AttributeError instead of
        being reported as a validation error. Not changed here - a logic fix
        belongs in its own commit.
        """
        self.assertEqual(get_administration("Nowhere|Not Here"), "Not Here")
