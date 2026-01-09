"""
Tests for Flow Data Seeder question processing functionality.

This module tests the question processing functionality that was
moved from the flow_data_seeder command to the seeder_data_loader
utility module.
"""

import pandas as pd
from unittest.mock import patch
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_forms.models import (
    Forms,
    Questions,
    QuestionTypes,
    QuestionGroup,
)
from api.v1.v1_profile.models import Administration, Levels

from utils.seeder_config import (
    CsvColumns,
    NON_QUESTION_COLUMNS,
    SeederConfig,
)
from utils.seeder_data_loader import load_questions, load_data_file


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadQuestionsTestCase(TestCase):
    """Test suite for load_questions function."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.level = Levels.objects.create(name="Test Level", level=1)
        self.admin = Administration.objects.create(
            name="Test Administration",
            level=self.level
        )
        self.form = Forms.objects.create(name="Test Form")
        self.question_group = QuestionGroup.objects.create(
            form=self.form,
            name="Test Group"
        )
        self.question1 = Questions.objects.create(
            form=self.form,
            question_group=self.question_group,
            name="Question 1",
            type=QuestionTypes.text,
            order=1
        )
        self.question2 = Questions.objects.create(
            form=self.form,
            question_group=self.question_group,
            name="Question 2",
            type=QuestionTypes.number,
            order=2
        )

    def test_load_questions_from_dataframe(self):
        """Test loading questions from dataframe columns."""
        # Create a DataFrame with question IDs as columns
        df = pd.DataFrame({
            'datapoint_id': [1, 2],
            'name': ['Name 1', 'Name 2'],
            str(self.question1.pk): ['Answer 1', 'Answer 2'],
            str(self.question2.pk): [42, 43],
        })

        result = load_questions(df)

        self.assertEqual(len(result), 2)
        self.assertIn(self.question1.pk, result)
        self.assertIn(self.question2.pk, result)
        self.assertEqual(result[self.question1.pk].pk, self.question1.pk)
        self.assertEqual(result[self.question2.pk].pk, self.question2.pk)

    def test_load_questions_filters_non_question_columns(self):
        """Test that non-question columns are filtered out."""
        df = pd.DataFrame({
            'datapoint_id': [1],
            'name': ['Name'],
            'identifier': ['id1'],
            'created_at': ['2023-01-01'],
            'form_id': [1],
            'administration': ['Admin'],
            'geo': ['1.0|2.0'],
        })

        result = load_questions(df)

        self.assertEqual(len(result), 0)

    def test_load_questions_with_empty_dataframe(self):
        """Test loading questions from empty dataframe."""
        df = pd.DataFrame()

        result = load_questions(df)

        self.assertEqual(result, {})

    def test_load_questions_with_none_dataframe(self):
        """Test loading questions from None dataframe."""
        result = load_questions(None)

        self.assertEqual(result, {})

    def test_load_questions_only_uses_valid_question_ids(self):
        """Test that only valid question IDs are used."""
        df = pd.DataFrame({
            'datapoint_id': [1],
            str(self.question1.pk): ['Answer 1'],
            '99999': ['Invalid Answer'],  # Non-existent question ID
        })

        result = load_questions(df)

        self.assertEqual(len(result), 1)
        self.assertIn(self.question1.pk, result)
        self.assertNotIn(99999, result)


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadDataFileTestCase(TestCase):
    """Test suite for load_data_file function."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.config = SeederConfig(flow_form_id=123)

    @patch('pandas.read_csv')
    def test_load_data_file_parent_success(self, mock_read_csv):
        """Test successful loading of parent data file."""
        mock_read_csv.return_value = pd.DataFrame({
            'datapoint_id': [1, 2],
            'name': ['Name 1', 'Name 2'],
        })

        result = load_data_file(
            flow_id=123,
            is_parent=True,
            config=self.config
        )

        self.assertIsNotNone(result)
        self.assertEqual(len(result), 2)

    @patch('pandas.read_csv')
    def test_load_data_file_child_success(self, mock_read_csv):
        """Test successful loading of child data file."""
        mock_read_csv.return_value = pd.DataFrame({
            'datapoint_id': [1, 2],
            'name': ['Name 1', 'Name 2'],
        })

        result = load_data_file(
            flow_id=123,
            is_parent=False,
            config=self.config
        )

        self.assertIsNotNone(result)
        self.assertEqual(len(result), 2)

    @patch('pandas.read_csv')
    def test_load_data_file_not_found(self, mock_read_csv):
        """Test loading data file when file not found."""
        mock_read_csv.side_effect = FileNotFoundError("File not found")

        result = load_data_file(
            flow_id=123,
            is_parent=True,
            config=self.config
        )

        self.assertIsNone(result)

    @patch('pandas.read_csv')
    def test_load_data_file_empty_file(self, mock_read_csv):
        """Test loading data file when file is empty."""
        mock_read_csv.side_effect = pd.errors.EmptyDataError("Empty file")

        result = load_data_file(
            flow_id=123,
            is_parent=True,
            config=self.config
        )

        self.assertIsNone(result)


@override_settings(USE_TZ=False, TEST_ENV=True)
class CsvColumnsTestCase(TestCase):
    """Test suite for CsvColumns constants."""

    def test_datapoint_id_constant(self):
        """Test DATAPOINT_ID constant."""
        self.assertEqual(CsvColumns.DATAPOINT_ID, "datapoint_id")

    def test_name_constant(self):
        """Test NAME constant."""
        self.assertEqual(CsvColumns.NAME, "name")

    def test_submitter_constant(self):
        """Test SUBMITTER constant."""
        self.assertEqual(CsvColumns.SUBMITTER, "submitter")

    def test_identifier_constant(self):
        """Test IDENTIFIER constant."""
        self.assertEqual(CsvColumns.IDENTIFIER, "identifier")

    def test_created_at_constant(self):
        """Test CREATED_AT constant."""
        self.assertEqual(CsvColumns.CREATED_AT, "created_at")

    def test_form_id_constant(self):
        """Test FORM_ID constant."""
        self.assertEqual(CsvColumns.FORM_ID, "form_id")

    def test_administration_constant(self):
        """Test ADMINISTRATION constant."""
        self.assertEqual(CsvColumns.ADMINISTRATION, "administration")

    def test_geo_constant(self):
        """Test GEO constant."""
        self.assertEqual(CsvColumns.GEO, "geo")

    def test_parent_constant(self):
        """Test PARENT constant."""
        self.assertEqual(CsvColumns.PARENT, "parent")


@override_settings(USE_TZ=False, TEST_ENV=True)
class NonQuestionColumnsTestCase(TestCase):
    """Test suite for NON_QUESTION_COLUMNS list."""

    def test_non_question_columns_contains_all_columns(self):
        """Test that NON_QUESTION_COLUMNS contains all expected columns."""
        expected_columns = [
            CsvColumns.FORM_ID,
            CsvColumns.IDENTIFIER,
            CsvColumns.CREATED_AT,
            CsvColumns.DATAPOINT_ID,
            CsvColumns.SUBMITTER,
            CsvColumns.NAME,
            CsvColumns.ADMINISTRATION,
            CsvColumns.GEO,
            CsvColumns.PARENT,
        ]

        for col in expected_columns:
            self.assertIn(col, NON_QUESTION_COLUMNS)

    def test_non_question_columns_count(self):
        """Test the count of non-question columns."""
        # Should contain 9 columns
        self.assertEqual(len(NON_QUESTION_COLUMNS), 9)
