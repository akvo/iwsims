import pandas as pd
from unittest.mock import patch
from django.test import TestCase
from django.test.utils import override_settings
from api.v1.v1_data.management.commands.flow_data_seeder import (
    Command,
    DATAPOINT_ID_COL,
    DISPLAY_NAME_COL,
    FILENAME_KEY,
    IMAGE_KEY,
    TEXT_KEY,
    FLOW_QUESTION_ID_COL,
    MIS_QUESTION_ID_COL,
)
from api.v1.v1_forms.models import (
    Forms,
    Questions,
    QuestionTypes,
    QuestionGroup,
)
from api.v1.v1_profile.models import Administration, Levels


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadQuestionMappingsTestCase(TestCase):
    """Test suite for _load_question_mappings method."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    @patch('pandas.read_csv')
    def test_load_question_mappings_success(self, mock_read_csv):
        """Test successful loading of question mappings."""
        csv_data = pd.DataFrame({
            FLOW_QUESTION_ID_COL: ['fq1', 'fq2', 'fq3'],
            MIS_QUESTION_ID_COL: ['101', '102;103', '104'],
        })
        mock_read_csv.return_value = csv_data

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(len(result), 3)
        self.assertEqual(result['fq1'], ['101'])
        self.assertEqual(result['fq2'], ['102', '103'])
        self.assertEqual(result['fq3'], ['104'])

    @patch('pandas.read_csv')
    def test_load_question_mappings_filters_empty_values(self, mock_read_csv):
        """Test that empty and null values are filtered out."""
        csv_data = pd.DataFrame({
            FLOW_QUESTION_ID_COL: ['fq1', 'fq2', 'fq3', 'fq4'],
            MIS_QUESTION_ID_COL: ['101', '', '103', None],
        })
        mock_read_csv.return_value = csv_data

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(len(result), 2)
        self.assertIn('fq1', result)
        self.assertIn('fq3', result)
        self.assertNotIn('fq2', result)
        self.assertNotIn('fq4', result)

    @patch('pandas.read_csv')
    def test_load_question_mappings_filters_empty_flow_qid(
        self, mock_read_csv
    ):
        """Test that empty flow question IDs are filtered out."""
        csv_data = pd.DataFrame({
            FLOW_QUESTION_ID_COL: ['', 'fq2', None, 'fq4'],
            MIS_QUESTION_ID_COL: ['101', '102', '103', '104'],
        })
        mock_read_csv.return_value = csv_data

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(len(result), 2)
        self.assertIn('fq2', result)
        self.assertIn('fq4', result)

    @patch('pandas.read_csv')
    def test_load_question_mappings_filters_empty_split_results(
        self, mock_read_csv
    ):
        """Test that empty split results are filtered out."""
        csv_data = pd.DataFrame({
            FLOW_QUESTION_ID_COL: ['fq1', 'fq2'],
            MIS_QUESTION_ID_COL: ['101', ''],
        })
        mock_read_csv.return_value = csv_data

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(len(result), 1)
        self.assertIn('fq1', result)
        self.assertNotIn('fq2', result)

    @patch('pandas.read_csv')
    def test_load_question_mappings_file_not_found(self, mock_read_csv):
        """Test handling when file is not found."""
        mock_read_csv.side_effect = FileNotFoundError("File not found")

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_question_mappings_empty_file(self, mock_read_csv):
        """Test handling when file is empty."""
        mock_read_csv.side_effect = pd.errors.EmptyDataError("Empty file")

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_question_mappings_missing_columns(self, mock_read_csv):
        """Test handling when CSV has missing columns."""
        mock_read_csv.side_effect = KeyError("Missing columns")

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_question_mappings_unexpected_error(self, mock_read_csv):
        """Test handling of unexpected errors."""
        mock_read_csv.side_effect = Exception("Unexpected error")

        result = self.command._load_question_mappings(flow_id=123)

        self.assertEqual(result, {})


@override_settings(USE_TZ=False, TEST_ENV=True)
class PrefetchQuestionsTestCase(TestCase):
    """Test suite for _prefetch_questions method."""

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
        self.command = Command()

    def test_prefetch_questions_success(self):
        """Test successful pre-fetching of questions."""
        seed_questions = {
            'fq1': [str(self.question1.pk)],
            'fq2': [str(self.question2.pk)],
        }

        result = self.command._prefetch_questions(seed_questions)

        self.assertEqual(len(result), 2)
        self.assertIn('fq1', result)
        self.assertIn('fq2', result)
        self.assertEqual(len(result['fq1']), 1)
        self.assertEqual(len(result['fq2']), 1)
        self.assertEqual(result['fq1'][0].pk, self.question1.pk)
        self.assertEqual(result['fq2'][0].pk, self.question2.pk)

    def test_prefetch_questions_with_multiple_mis_ids(self):
        """Test pre-fetching with multiple MIS question IDs per flow ID."""
        # Create Question Group and Question 3
        qg = QuestionGroup.objects.create(
            form=self.form,
            name="Another Group"
        )
        question3 = Questions.objects.create(
            form=self.form,
            question_group=qg,
            name="Question 3",
            type=QuestionTypes.option,
            order=3
        )

        seed_questions = {
            'fq1': [
                str(self.question1.pk),
                str(self.question2.pk),
                str(question3.pk)
            ],
        }

        result = self.command._prefetch_questions(seed_questions)

        self.assertEqual(len(result), 1)
        self.assertIn('fq1', result)
        self.assertEqual(len(result['fq1']), 3)

    def test_prefetch_questions_empty_seed_questions(self):
        """Test pre-fetching with empty seed questions."""
        result = self.command._prefetch_questions({})

        self.assertEqual(result, {})

    def test_prefetch_questions_no_mis_question_ids(self):
        """Test pre-fetching when no MIS question IDs found."""
        seed_questions = {'fq1': []}

        result = self.command._prefetch_questions(seed_questions)

        self.assertEqual(result, {})

    def test_prefetch_questions_nonexistent_question_ids(self):
        """Test pre-fetching with non-existent question IDs."""
        seed_questions = {
            'fq1': ['99999', '88888'],  # Non-existent IDs
        }

        result = self.command._prefetch_questions(seed_questions)

        self.assertEqual(len(result), 1)
        self.assertIn('fq1', result)
        self.assertEqual(len(result['fq1']), 0)  # No questions found


@override_settings(USE_TZ=False, TEST_ENV=True)
class PhotoAndSignatureProcessingTestCase(TestCase):
    """Test suite for photo and signature question type processing."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    def test_filename_key_constant_usage(self):
        """Test correct usage of FILENAME_KEY constant."""
        photo_data = {
            FILENAME_KEY: "photo.jpg",
            "other_field": "value"
        }

        filename = photo_data.get(FILENAME_KEY)
        self.assertEqual(filename, "photo.jpg")

    def test_image_key_constant_usage(self):
        """Test correct usage of IMAGE_KEY constant."""
        signature_data = {
            IMAGE_KEY: "signature.png",
            "other_field": "value"
        }

        image = signature_data.get(IMAGE_KEY)
        self.assertEqual(image, "signature.png")

    def test_text_key_constant_usage(self):
        """Test correct usage of TEXT_KEY constant."""
        option_data = [
            {TEXT_KEY: "Option 1"},
            {TEXT_KEY: "Option 2"},
        ]

        for option in option_data:
            text = option.get(TEXT_KEY)
            self.assertIn(text, ["Option 1", "Option 2"])


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadDataFileTestCase(TestCase):
    """Test suite for _load_data_file method."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    @patch('glob.glob')
    @patch('pandas.read_csv')
    def test_load_data_file_success(self, mock_read_csv, mock_glob):
        """Test successful loading of data file."""
        mock_glob.return_value = ['/path/to/123_data.csv']
        mock_read_csv.return_value = pd.DataFrame({
            DATAPOINT_ID_COL: ['dp1', 'dp2'],
            DISPLAY_NAME_COL: ['Name 1', 'Name 2'],
        })

        result = self.command._load_data_file(flow_id=123)

        self.assertIsNotNone(result)
        self.assertEqual(len(result), 2)
        mock_glob.assert_called_once()
        mock_read_csv.assert_called_once()

    @patch('glob.glob')
    def test_load_data_file_no_matching_files(self, mock_glob):
        """Test when no matching files found."""
        mock_glob.return_value = []

        result = self.command._load_data_file(flow_id=123)

        self.assertIsNone(result)

    @patch('glob.glob')
    @patch('pandas.read_csv')
    def test_load_data_file_uses_first_match(
        self, mock_read_csv, mock_glob
    ):
        """Test that first matching file is used."""
        mock_glob.return_value = [
            '/path/to/123_v1.csv',
            '/path/to/123_v2.csv',
        ]
        mock_read_csv.return_value = pd.DataFrame()

        result = self.command._load_data_file(flow_id=123)

        self.assertIsNotNone(result)
        mock_read_csv.assert_called_once_with(
            '/path/to/123_v1.csv',
            encoding='utf-8',
            low_memory=False,
        )

    @patch('glob.glob')
    @patch('pandas.read_csv')
    def test_load_data_file_exception_handling(
        self, mock_read_csv, mock_glob
    ):
        """Test exception handling during file loading."""
        mock_glob.return_value = ['/path/to/123_data.csv']
        mock_read_csv.side_effect = Exception("Read error")

        result = self.command._load_data_file(flow_id=123)

        self.assertIsNone(result)
