"""
Tests for repeat-index support in the Flow Data Seeder.

A data CSV column named "<question_id>-<n>" holds the n-th repeat instance
of a question in a repeatable question group. Validates that:
1. parse_question_column splits plain, float-like and indexed columns
2. prepare_answer_data emits one record per column with its index
3. bulk_create_answers creates and updates answers per (question, index)
4. Plain columns keep index 0 (no regression for existing CSV files)
"""

import pandas as pd
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Forms, Questions
from api.v1.v1_users.models import SystemUser
from api.v1.v1_profile.models import Administration

from utils.seeder_answer_processor import AnswerProcessor
from utils.seeder_config import parse_question_column
from utils.seeder_data_loader import load_questions
from utils.seeder_data_processor import (
    bulk_create_answers,
    prepare_answer_data,
)

# Form 4 test fixture: repeatable group "Testimonials" -> text question 661
REPEATABLE_QUESTION_ID = 661


class ParseQuestionColumnTestCase(TestCase):
    """parse_question_column is the single source of truth for columns."""

    def test_plain_and_float_like_columns(self):
        self.assertEqual(parse_question_column("661"), (661, 0))
        self.assertEqual(parse_question_column("661.0"), (661, 0))

    def test_indexed_column(self):
        self.assertEqual(parse_question_column("661-2"), (661, 2))

    def test_metadata_and_junk_columns(self):
        self.assertIsNone(parse_question_column("datapoint_id"))
        self.assertIsNone(parse_question_column("success"))
        self.assertIsNone(parse_question_column("abc"))
        self.assertIsNone(parse_question_column("661-x"))


@override_settings(USE_TZ=False, TEST_ENV=True)
class RepeatIndexSeederTestCase(TestCase):
    """End-to-end: indexed CSV columns become indexed Answers rows."""

    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test", 4)
        self.user = SystemUser.objects.create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            password="testpass123",
        )
        self.form = Forms.objects.get(pk=4)
        self.question = Questions.objects.get(pk=REPEATABLE_QUESTION_ID)
        self.assertTrue(self.question.question_group.repeatable)
        self.admin = Administration.objects.filter(name="Kramat Jati").first()
        self.form_data = FormData.objects.create(
            form=self.form,
            name="Test Data",
            administration=self.admin,
            created_by=self.user,
        )
        self.row = pd.Series({
            "datapoint_id": "dp-1",
            "661": "first testimonial",
            "661-1": "second testimonial",
            "661-2": "third testimonial",
        })

    def test_load_questions_accepts_indexed_columns(self):
        df = pd.DataFrame([self.row])
        questions = load_questions(df)
        self.assertEqual(set(questions), {REPEATABLE_QUESTION_ID})

    def test_prepare_answer_data_carries_index(self):
        questions = {REPEATABLE_QUESTION_ID: self.question}
        records, invalid = prepare_answer_data(
            row=self.row,
            questions=questions,
            administration_id=self.admin.id,
            answer_processor=AnswerProcessor(),
        )
        self.assertEqual(invalid, [])
        self.assertEqual(
            [(r["question_id"], r["index"], r["name"]) for r in records],
            [
                (REPEATABLE_QUESTION_ID, 0, "first testimonial"),
                (REPEATABLE_QUESTION_ID, 1, "second testimonial"),
                (REPEATABLE_QUESTION_ID, 2, "third testimonial"),
            ],
        )

    def test_bulk_create_and_update_per_index(self):
        questions = {REPEATABLE_QUESTION_ID: self.question}
        records, _ = prepare_answer_data(
            row=self.row,
            questions=questions,
            administration_id=self.admin.id,
            answer_processor=AnswerProcessor(),
        )
        bulk_create_answers(self.form_data, records, self.user)

        answers = Answers.objects.filter(
            data=self.form_data, question=self.question
        ).order_by("index")
        self.assertEqual(
            [(a.index, a.name) for a in answers],
            [
                (0, "first testimonial"),
                (1, "second testimonial"),
                (2, "third testimonial"),
            ],
        )

        # Re-seeding updates in place instead of duplicating rows
        self.row["661-1"] = "second testimonial (edited)"
        records, _ = prepare_answer_data(
            row=self.row,
            questions=questions,
            administration_id=self.admin.id,
            answer_processor=AnswerProcessor(),
        )
        bulk_create_answers(self.form_data, records, self.user)
        answers = Answers.objects.filter(
            data=self.form_data, question=self.question
        ).order_by("index")
        self.assertEqual(answers.count(), 3)
        self.assertEqual(answers[1].name, "second testimonial (edited)")

    def test_record_without_index_defaults_to_zero(self):
        bulk_create_answers(
            self.form_data,
            [{
                "question_id": REPEATABLE_QUESTION_ID,
                "name": "legacy record",
                "value": None,
                "options": None,
            }],
            self.user,
        )
        answer = Answers.objects.get(
            data=self.form_data, question=self.question
        )
        self.assertEqual(answer.index, 0)
