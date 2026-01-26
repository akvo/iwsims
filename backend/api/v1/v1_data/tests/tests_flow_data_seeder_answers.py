"""
Tests for Flow Data Seeder bulk_create_answers function.

This module tests the bulk_create_answers function which handles
creating and updating answer records while preserving manual inputs.

Validates that:
1. Empty answer_records returns early without changes
2. New answers are created when no existing answers
3. Existing answers are updated (value, name, options, created_by)
4. Manual answers (not in seeder data) are preserved
5. Mix of new and existing answers works correctly
"""

import os
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Forms, Questions
from api.v1.v1_users.models import SystemUser
from api.v1.v1_profile.models import Administration

from utils.seeder_data_processor import bulk_create_answers


# =============================================================================
# Test Constants
# =============================================================================

FIXTURES_DIR = os.path.join(
    os.path.dirname(__file__),
    "fixtures"
)


# =============================================================================
# Base Test Class with Common Setup
# =============================================================================


@override_settings(USE_TZ=False, TEST_ENV=True)
class BaseBulkCreateAnswersTest(TestCase):
    """Base test class with common setup for bulk_create_answers tests."""

    def setUp(self):
        """Set up test environment with required data."""
        super().setUp()

        # Create administration data using seeder command
        call_command("administration_seeder", "--test")

        # Create forms (parent ID=4, child ID=40004) using form seeder
        call_command("form_seeder", "--test", 4)

        # Create user
        self.user = SystemUser.objects.create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            password="testpass123"
        )

        # Create another user for testing updated created_by
        self.user2 = SystemUser.objects.create_user(
            email="test2@example.com",
            first_name="Test2",
            last_name="User2",
            password="testpass123"
        )

        # Verify forms were created
        self.parent_form = Forms.objects.filter(id=4).first()
        self.assertIsNotNone(
            self.parent_form, "Parent form (ID=4) should be created"
        )

        # Get administration
        self.admin = Administration.objects.filter(
            name="Kramat Jati").first()
        self.assertIsNotNone(
            self.admin, "Should have Kramat Jati administration"
        )

        # Get questions for the form
        self.questions = Questions.objects.filter(
            form=self.parent_form
        ).order_by('id')
        self.assertGreater(
            self.questions.count(), 0,
            "Form should have questions"
        )

        # Create a FormData instance for testing
        self.form_data = FormData.objects.create(
            form=self.parent_form,
            name="Test Data",
            administration=self.admin,
            created_by=self.user,
        )


# =============================================================================
# Bulk Create Answers Tests
# =============================================================================


class BulkCreateAnswersEmptyRecordsTestCase(BaseBulkCreateAnswersTest):
    """Test suite for bulk_create_answers with empty records."""

    def test_empty_answer_records_returns_early(self):
        """Test that empty answer_records list returns without changes."""
        # Create an existing answer
        question = self.questions.first()
        existing_answer = Answers.objects.create(
            data=self.form_data,
            question=question,
            name="existing value",
            value=None,
            options=None,
            created_by=self.user,
        )

        # Call with empty list
        bulk_create_answers(self.form_data, [], self.user2)

        # Verify existing answer is unchanged
        existing_answer.refresh_from_db()
        self.assertEqual(existing_answer.name, "existing value")
        self.assertEqual(existing_answer.created_by, self.user)

    def test_none_answer_records_handled(self):
        """Test that None or falsy answer_records is handled."""
        # Should not raise an exception
        bulk_create_answers(self.form_data, None, self.user)
        bulk_create_answers(self.form_data, [], self.user)


class BulkCreateAnswersNewRecordsTestCase(BaseBulkCreateAnswersTest):
    """Test suite for bulk_create_answers creating new records."""

    def test_creates_new_answers_when_none_exist(self):
        """Test that new answers are created when no existing answers."""
        # Ensure no answers exist
        self.assertEqual(self.form_data.data_answer.count(), 0)

        questions = list(self.questions[:2])
        answer_records = [
            {
                "question_id": questions[0].pk,
                "name": "Answer 1",
                "value": None,
                "options": None,
            },
            {
                "question_id": questions[1].pk,
                "name": None,
                "value": 42.5,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user)

        # Verify answers were created
        self.assertEqual(self.form_data.data_answer.count(), 2)

        answer1 = self.form_data.data_answer.get(question=questions[0])
        self.assertEqual(answer1.name, "Answer 1")
        self.assertIsNone(answer1.value)
        self.assertEqual(answer1.created_by, self.user)

        answer2 = self.form_data.data_answer.get(question=questions[1])
        self.assertIsNone(answer2.name)
        self.assertEqual(answer2.value, 42.5)

    def test_creates_answer_with_options(self):
        """Test creating answer with options field."""
        question = self.questions.first()
        answer_records = [
            {
                "question_id": question.pk,
                "name": None,
                "value": None,
                "options": ["Option A", "Option B"],
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user)

        answer = self.form_data.data_answer.get(question=question)
        self.assertEqual(answer.options, ["Option A", "Option B"])


class BulkCreateAnswersUpdateRecordsTestCase(BaseBulkCreateAnswersTest):
    """Test suite for bulk_create_answers updating existing records."""

    def test_updates_existing_answer_value(self):
        """Test that existing answer value is updated."""
        question = self.questions.first()

        # Create existing answer
        existing = Answers.objects.create(
            data=self.form_data,
            question=question,
            name="old name",
            value=10.0,
            options=None,
            created_by=self.user,
        )

        # Update with new values
        answer_records = [
            {
                "question_id": question.pk,
                "name": "new name",
                "value": 99.0,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user2)

        # Verify answer was updated
        existing.refresh_from_db()
        self.assertEqual(existing.name, "new name")
        self.assertEqual(existing.value, 99.0)
        self.assertEqual(existing.created_by, self.user2)

    def test_updates_existing_answer_options(self):
        """Test that existing answer options are updated."""
        question = self.questions.first()

        # Create existing answer with options
        existing = Answers.objects.create(
            data=self.form_data,
            question=question,
            name=None,
            value=None,
            options=["Old Option"],
            created_by=self.user,
        )

        # Update with new options
        answer_records = [
            {
                "question_id": question.pk,
                "name": None,
                "value": None,
                "options": ["New Option 1", "New Option 2"],
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user2)

        existing.refresh_from_db()
        self.assertEqual(existing.options, ["New Option 1", "New Option 2"])

    def test_updates_created_by_field(self):
        """Test that created_by field is updated on existing answers."""
        question = self.questions.first()

        existing = Answers.objects.create(
            data=self.form_data,
            question=question,
            name="test",
            value=None,
            options=None,
            created_by=self.user,
        )

        answer_records = [
            {
                "question_id": question.pk,
                "name": "test updated",
                "value": None,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user2)

        existing.refresh_from_db()
        self.assertEqual(existing.created_by, self.user2)


class BulkCreateAnswersPreserveManualTestCase(BaseBulkCreateAnswersTest):
    """Test suite for preserving manual input answers."""

    def test_preserves_manual_answers_not_in_seeder_data(self):
        """Test that manual answers not in seeder data are preserved."""
        questions = list(self.questions[:3])

        # Create manual answer for question 3 (not in seeder data)
        manual_answer = Answers.objects.create(
            data=self.form_data,
            question=questions[2],
            name="Manual Input Value",
            value=None,
            options=None,
            created_by=self.user,
        )

        # Seeder only updates questions 1 and 2
        answer_records = [
            {
                "question_id": questions[0].pk,
                "name": "Seeder Answer 1",
                "value": None,
                "options": None,
            },
            {
                "question_id": questions[1].pk,
                "name": "Seeder Answer 2",
                "value": None,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user2)

        # Verify manual answer is preserved
        manual_answer.refresh_from_db()
        self.assertEqual(manual_answer.name, "Manual Input Value")
        self.assertEqual(manual_answer.created_by, self.user)

        # Verify seeder answers were created
        self.assertEqual(self.form_data.data_answer.count(), 3)

    def test_mixed_create_and_update_preserves_others(self):
        """Test mix of create, update, and preserve operations."""
        questions = list(self.questions[:4])

        # Create existing answers for questions 1 and 3
        existing1 = Answers.objects.create(
            data=self.form_data,
            question=questions[0],
            name="Existing 1",
            value=None,
            options=None,
            created_by=self.user,
        )
        manual3 = Answers.objects.create(
            data=self.form_data,
            question=questions[2],
            name="Manual 3 - Should Preserve",
            value=None,
            options=None,
            created_by=self.user,
        )

        # Seeder updates question 1 and creates question 2
        # Question 3 is not in seeder data (should preserve)
        answer_records = [
            {
                "question_id": questions[0].pk,
                "name": "Updated 1",
                "value": None,
                "options": None,
            },
            {
                "question_id": questions[1].pk,
                "name": "New 2",
                "value": None,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user2)

        # Verify existing1 was updated
        existing1.refresh_from_db()
        self.assertEqual(existing1.name, "Updated 1")
        self.assertEqual(existing1.created_by, self.user2)

        # Verify new answer was created for question 2
        new2 = self.form_data.data_answer.get(question=questions[1])
        self.assertEqual(new2.name, "New 2")
        self.assertEqual(new2.created_by, self.user2)

        # Verify manual3 was preserved (not deleted, not modified)
        manual3.refresh_from_db()
        self.assertEqual(manual3.name, "Manual 3 - Should Preserve")
        self.assertEqual(manual3.created_by, self.user)

        # Total should be 3 answers
        self.assertEqual(self.form_data.data_answer.count(), 3)


class BulkCreateAnswersEdgeCasesTestCase(BaseBulkCreateAnswersTest):
    """Test suite for edge cases in bulk_create_answers."""

    def test_handles_null_values_correctly(self):
        """Test that null values in answer records are handled."""
        question = self.questions.first()

        answer_records = [
            {
                "question_id": question.pk,
                "name": None,
                "value": None,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user)

        answer = self.form_data.data_answer.get(question=question)
        self.assertIsNone(answer.name)
        self.assertIsNone(answer.value)
        self.assertIsNone(answer.options)

    def test_multiple_updates_same_form_data(self):
        """Test running bulk_create_answers multiple times on same data."""
        question = self.questions.first()

        # First run - create
        answer_records = [
            {
                "question_id": question.pk,
                "name": "First",
                "value": 1.0,
                "options": None,
            },
        ]
        bulk_create_answers(self.form_data, answer_records, self.user)

        answer = self.form_data.data_answer.get(question=question)
        self.assertEqual(answer.name, "First")
        self.assertEqual(answer.value, 1.0)

        # Second run - update
        answer_records = [
            {
                "question_id": question.pk,
                "name": "Second",
                "value": 2.0,
                "options": None,
            },
        ]
        bulk_create_answers(self.form_data, answer_records, self.user2)

        answer.refresh_from_db()
        self.assertEqual(answer.name, "Second")
        self.assertEqual(answer.value, 2.0)

        # Should still be only 1 answer (updated, not duplicated)
        self.assertEqual(self.form_data.data_answer.count(), 1)

    def test_answer_count_unchanged_on_update(self):
        """Test that answer count doesn't change when only updating."""
        questions = list(self.questions[:2])

        # Create existing answers
        for q in questions:
            Answers.objects.create(
                data=self.form_data,
                question=q,
                name=f"Original {q.pk}",
                value=None,
                options=None,
                created_by=self.user,
            )

        initial_count = self.form_data.data_answer.count()
        self.assertEqual(initial_count, 2)

        # Update all existing answers
        answer_records = [
            {
                "question_id": questions[0].pk,
                "name": "Updated 0",
                "value": None,
                "options": None,
            },
            {
                "question_id": questions[1].pk,
                "name": "Updated 1",
                "value": None,
                "options": None,
            },
        ]

        bulk_create_answers(self.form_data, answer_records, self.user2)

        # Count should remain the same
        self.assertEqual(self.form_data.data_answer.count(), initial_count)
