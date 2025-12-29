import pandas as pd
from unittest.mock import patch, MagicMock
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from django.core.management.base import CommandError
from io import StringIO

from api.v1.v1_data.models import FormData
from api.v1.v1_data.management.commands.flow_data_seeder import (
    Command,
    DATAPOINT_ID_COL,
    DISPLAY_NAME_COL,
    SUBMITTER_COL,
    IDENTIFIER_COL,
    CREATED_AT_COL,
    CADDISFLY_TYPE,
    CADDISFLY_RESULT,
    FILENAME_KEY,
    IMAGE_KEY,
    TEXT_KEY,
    TYPE_KEY,
    NAME_KEY,
    UNIT_KEY,
    VALUE_KEY,
)
from api.v1.v1_forms.models import Forms, Questions


@override_settings(USE_TZ=False, TEST_ENV=True)
class FlowDataSeederCommandTestCase(TestCase):
    """Test suite for flow_data_seeder management command."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()

    def test_argument_parser_required_form_flag(self):
        """Test that -f/--form flag is required."""
        out = StringIO()
        with self.assertRaises(CommandError) as cm:
            call_command(
                "flow_data_seeder",
                stdout=out,
                stderr=StringIO()
            )
        self.assertIn("following arguments are required", str(cm.exception))

    def test_argument_parser_with_valid_form_id(self):
        """Test argument parsing with valid form ID."""
        out = StringIO()
        with patch.object(Command, '_load_question_mappings') as mock_load:
            with patch.object(Command, '_load_data_file') as mock_data:
                mock_load.return_value = {}
                mock_data.return_value = pd.DataFrame()

                call_command(
                    "flow_data_seeder",
                    "-f", "123",
                    stdout=out,
                    stderr=StringIO()
                )

        output = out.getvalue()
        self.assertIn("Starting Flow Data Seeding", output)
        self.assertIn("Form ID: 123", output)

    def test_argument_parser_with_revert_flag(self):
        """Test argument parsing with --revert flag."""
        out = StringIO()
        with patch.object(FormData.objects, 'filter') as mock_filter:
            mock_qs = MagicMock()
            mock_qs.delete.return_value = (5, {})
            mock_filter.return_value = mock_qs

            call_command(
                "flow_data_seeder",
                "-f", "123",
                "--revert",
                "True",
                stdout=out,
                stderr=StringIO()
            )

        output = out.getvalue()
        self.assertIn("Reverting Flow Data Seeding", output)
        self.assertIn("Form ID: 123", output)

    def test_argument_parser_with_limit_flag(self):
        """Test argument parsing with --limit flag."""
        out = StringIO()
        with patch.object(Command, '_load_question_mappings') as mock_load:
            with patch.object(Command, '_load_data_file') as mock_data:
                mock_load.return_value = {}
                mock_data.return_value = pd.DataFrame()

                call_command(
                    "flow_data_seeder",
                    "-f", "123",
                    "--limit", "10",
                    stdout=out,
                    stderr=StringIO()
                )

        output = out.getvalue()
        self.assertIn("Starting Flow Data Seeding", output)

    def test_input_validation_invalid_form_id_zero(self):
        """Test input validation rejects zero form ID."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "0",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Form ID must be a positive integer", output)

    def test_input_validation_invalid_form_id_negative(self):
        """Test input validation rejects negative form ID."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "-1",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Form ID must be a positive integer", output)

    def test_input_validation_invalid_limit_zero(self):
        """Test input validation rejects zero limit."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--limit", "0",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Limit must be a positive integer", output)

    def test_input_validation_invalid_limit_negative(self):
        """Test input validation rejects negative limit."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--limit", "-5",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Limit must be a positive integer", output)


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadAdministrationMappingsTestCase(TestCase):
    """Test suite for _load_administration_mappings method."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()

    @patch('pandas.read_csv')
    def test_load_administration_mappings_success(self, mock_read_csv):
        """Test successful loading of administration mappings."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': ['1', '2', '3'],
            'mis_value': ['adm1', 'adm2', 'adm3'],
        })
        mock_read_csv.return_value = csv_data

        command = Command()
        result = command._load_administration_mappings()

        self.assertEqual(len(result), 3)
        self.assertEqual(result['1'], 'adm1')
        self.assertEqual(result['2'], 'adm2')
        self.assertEqual(result['3'], 'adm3')

    @patch('pandas.read_csv')
    def test_load_administration_mappings_filters_empty_values(
        self, mock_read_csv
    ):
        """Test that empty and null mis_value are filtered out."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': ['1', '2', '3'],
            'mis_value': ['adm1', '', 'adm3'],
        })
        mock_read_csv.return_value = csv_data

        command = Command()
        result = command._load_administration_mappings()

        self.assertEqual(len(result), 2)
        self.assertIn('1', result)
        self.assertIn('3', result)
        self.assertNotIn('2', result)

    @patch('pandas.read_csv')
    def test_load_administration_mappings_file_not_found(self, mock_read_csv):
        """Test handling when file is not found."""
        mock_read_csv.side_effect = FileNotFoundError("File not found")

        command = Command()
        result = command._load_administration_mappings()

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_administration_mappings_empty_file(self, mock_read_csv):
        """Test handling when file is empty."""
        mock_read_csv.side_effect = pd.errors.EmptyDataError("Empty file")

        command = Command()
        result = command._load_administration_mappings()

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_administration_mappings_missing_columns(self, mock_read_csv):
        """Test handling when CSV has missing columns."""
        mock_read_csv.side_effect = KeyError("Missing columns")

        command = Command()
        result = command._load_administration_mappings()

        self.assertEqual(result, {})


@override_settings(USE_TZ=False, TEST_ENV=True)
class CreateAnswerRecordTestCase(TestCase):
    """Test suite for _create_answer_record method."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    def test_create_answer_record_with_value_only(self):
        """Test creating answer record with only value."""
        result = self.command._create_answer_record(
            question_id=101,
            value="test_value"
        )

        expected = {
            "question_id": 101,
            "value": "test_value",
            "options": None,
            "name": None,
        }
        self.assertEqual(result, expected)

    def test_create_answer_record_with_options_only(self):
        """Test creating answer record with only options."""
        result = self.command._create_answer_record(
            question_id=102,
            options=["opt1", "opt2"]
        )

        expected = {
            "question_id": 102,
            "value": None,
            "options": ["opt1", "opt2"],
            "name": None,
        }
        self.assertEqual(result, expected)

    def test_create_answer_record_with_name_only(self):
        """Test creating answer record with only name."""
        result = self.command._create_answer_record(
            question_id=103,
            name="test_name"
        )

        expected = {
            "question_id": 103,
            "value": None,
            "options": None,
            "name": "test_name",
        }
        self.assertEqual(result, expected)

    def test_create_answer_record_with_all_fields(self):
        """Test creating answer record with all fields."""
        result = self.command._create_answer_record(
            question_id=104,
            value=123.45,
            options=["opt1", "opt2"],
            name="test_name"
        )

        expected = {
            "question_id": 104,
            "value": 123.45,
            "options": ["opt1", "opt2"],
            "name": "test_name",
        }
        self.assertEqual(result, expected)

    def test_create_answer_record_with_none_values(self):
        """Test creating answer record with all None values."""
        result = self.command._create_answer_record(
            question_id=105,
            value=None,
            options=None,
            name=None
        )

        expected = {
            "question_id": 105,
            "value": None,
            "options": None,
            "name": None,
        }
        self.assertEqual(result, expected)


@override_settings(USE_TZ=False, TEST_ENV=True)
class DataProcessingWithConstantsTestCase(TestCase):
    """Test suite for constant usage during data processing."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    def test_data_point_id_col_constant_usage(self):
        """Test correct usage of DATAPOINT_ID_COL constant."""
        mock_row = {
            DATAPOINT_ID_COL: "dp_123",
            DISPLAY_NAME_COL: "Test Name",
            SUBMITTER_COL: "submitter@example.com",
            IDENTIFIER_COL: "uuid-123",
            CREATED_AT_COL: "2025-01-01T00:00:00Z",
        }

        datapoint_id = mock_row.get(DATAPOINT_ID_COL, "unknown_0")
        self.assertEqual(datapoint_id, "dp_123")

    def test_display_name_col_constant_usage(self):
        """Test correct usage of DISPLAY_NAME_COL constant."""
        mock_row = {
            DATAPOINT_ID_COL: "dp_123",
            DISPLAY_NAME_COL: "Test Name",
        }

        datapoint_name = mock_row.get(DISPLAY_NAME_COL, "")
        self.assertEqual(datapoint_name, "Test Name")

    def test_submitter_col_constant_usage(self):
        """Test correct usage of SUBMITTER_COL constant."""
        mock_row = {
            DATAPOINT_ID_COL: "dp_123",
            SUBMITTER_COL: "submitter@example.com",
        }

        submitter = mock_row.get(SUBMITTER_COL, "")
        self.assertEqual(submitter, "submitter@example.com")

    def test_identifier_col_constant_usage(self):
        """Test correct usage of IDENTIFIER_COL constant."""
        mock_row = {
            DATAPOINT_ID_COL: "dp_123",
            IDENTIFIER_COL: "uuid-123",
        }

        uuid = mock_row.get(IDENTIFIER_COL, "")
        self.assertEqual(uuid, "uuid-123")

    def test_created_at_col_constant_usage(self):
        """Test correct usage of CREATED_AT_COL constant."""
        mock_row = {
            DATAPOINT_ID_COL: "dp_123",
            CREATED_AT_COL: "2025-01-01T00:00:00Z",
        }

        created_at = mock_row.get(CREATED_AT_COL, None)
        self.assertEqual(created_at, "2025-01-01T00:00:00Z")


@override_settings(USE_TZ=False, TEST_ENV=True)
class AdministrationMappingIntegrationTestCase(TestCase):
    """Test suite for administration mapping integration."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        self.form = Forms.objects.get(pk=1)

    @patch('pandas.read_csv')
    def test_administration_mapping_for_administration_question_type(
        self, mock_read_csv
    ):
        """Test admin mapping integration."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': ['1', '2'],
            'mis_value': ['adm1', 'adm2'],
        })
        mock_read_csv.return_value = csv_data

        command = Command()
        adm_mappings = command._load_administration_mappings()

        self.assertEqual(len(adm_mappings), 2)
        self.assertEqual(adm_mappings['1'], 'adm1')
        self.assertEqual(adm_mappings['2'], 'adm2')

    @patch('pandas.read_csv')
    def test_administration_mapping_lookup_during_processing(
        self, mock_read_csv
    ):
        """Test that admin mappings are correctly looked up."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': ['dp_1', 'dp_2', 'dp_3'],
            'mis_value': ['adm_value_1', 'adm_value_2', 'adm_value_3'],
        })
        mock_read_csv.return_value = csv_data

        command = Command()
        adm_mappings = command._load_administration_mappings()

        datapoint_id = "dp_2"
        adm_value = adm_mappings.get(datapoint_id, None)

        self.assertEqual(adm_value, 'adm_value_2')

        non_existent_value = adm_mappings.get('dp_999', None)
        self.assertIsNone(non_existent_value)


@override_settings(USE_TZ=False, TEST_ENV=True)
class CaddisflyDataProcessingTestCase(TestCase):
    """Test suite for caddisfly data processing."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    def test_caddisfly_type_constant_usage(self):
        """Test correct usage of CADDISFLY_TYPE constant."""
        caddisfly_data = {
            TYPE_KEY: CADDISFLY_TYPE,
            CADDISFLY_RESULT: [
                {NAME_KEY: "pH", UNIT_KEY: "pH units", VALUE_KEY: 7.5},
                {NAME_KEY: "Turbidity", UNIT_KEY: "NTU", VALUE_KEY: 12.3},
            ]
        }

        self.assertEqual(caddisfly_data[TYPE_KEY], "caddisfly")

    def test_caddisfly_result_constant_usage(self):
        """Test correct usage of CADDISFLY_RESULT constant."""
        caddisfly_data = {
            TYPE_KEY: CADDISFLY_TYPE,
            CADDISFLY_RESULT: [
                {NAME_KEY: "pH", UNIT_KEY: "pH units", VALUE_KEY: 7.5},
            ]
        }

        self.assertIn(CADDISFLY_RESULT, caddisfly_data)

    def test_caddisfly_value_key_constant_usage(self):
        """Test correct usage of VALUE_KEY constant."""
        caddisfly_data = {
            TYPE_KEY: CADDISFLY_TYPE,
            CADDISFLY_RESULT: [
                {NAME_KEY: "pH", UNIT_KEY: "pH units", VALUE_KEY: 7.5},
            ]
        }

        result_list = caddisfly_data[CADDISFLY_RESULT]
        self.assertEqual(result_list[0][VALUE_KEY], 7.5)

    def test_caddisfly_name_key_constant_usage(self):
        """Test correct usage of NAME_KEY constant."""
        caddisfly_data = {
            TYPE_KEY: CADDISFLY_TYPE,
            CADDISFLY_RESULT: [
                {NAME_KEY: "pH", UNIT_KEY: "pH units", VALUE_KEY: 7.5},
            ]
        }

        result_list = caddisfly_data[CADDISFLY_RESULT]
        self.assertEqual(result_list[0][NAME_KEY], "pH")

    def test_caddisfly_unit_key_constant_usage(self):
        """Test correct usage of UNIT_KEY constant."""
        caddisfly_data = {
            TYPE_KEY: CADDISFLY_TYPE,
            CADDISFLY_RESULT: [
                {NAME_KEY: "pH", UNIT_KEY: "pH units", VALUE_KEY: 7.5},
            ]
        }

        result_list = caddisfly_data[CADDISFLY_RESULT]
        self.assertEqual(result_list[0][UNIT_KEY], "pH units")


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
class FileSystemIsolationTestCase(TestCase):
    """Test suite for file system interaction mocking."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()

    @patch('pandas.read_csv')
    def test_file_system_operations_isolated(self, mock_read_csv):
        """Test that file system operations are properly isolated."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': ['1'],
            'mis_value': ['test_value'],
        })
        mock_read_csv.return_value = csv_data

        command = Command()
        result = command._load_administration_mappings()

        self.assertEqual(len(result), 1)
        mock_read_csv.assert_called_once()

    @patch('os.path.join')
    @patch('pandas.read_csv')
    def test_csv_path_construction(self, mock_read_csv, mock_join):
        """Test correct CSV path construction."""
        mock_read_csv.return_value = pd.DataFrame()
        mock_join.return_value = "mocked_path.csv"

        Command()._load_administration_mappings()

        mock_join.assert_called()
        mock_read_csv.assert_called_once()

    @patch('pandas.DataFrame.to_csv')
    def test_csv_generation_isolated(self, mock_to_csv):
        """Test that CSV generation is properly isolated."""
        test_data = [
            {'id': 1, 'name': 'Test'},
            {'id': 2, 'name': 'Test 2'},
        ]

        command = Command()
        command._generate_data2csv(flow_id=123, path="test", data=test_data)

        mock_to_csv.assert_called_once()
        call_args = mock_to_csv.call_args
        self.assertEqual(call_args[1]['index'], False)
        self.assertEqual(call_args[1]['encoding'], 'utf-8')


@override_settings(USE_TZ=False, TEST_ENV=True)
class DatabaseModelIsolationTestCase(TestCase):
    """Test suite for database model mocking."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()

    @patch.object(FormData.objects, 'create')
    def test_database_operations_isolated(self, mock_create):
        """Test that database operations are properly isolated."""
        mock_form_instance = MagicMock()
        mock_form_instance.pk = 1
        mock_create.return_value = mock_form_instance

        mock_bulk_create = MagicMock()
        mock_form_instance.data_answer.bulk_create = mock_bulk_create

        form_data = FormData.objects.create(
            name="Test",
            administration=1,
            geo=[1.0, 2.0],
            submitter="test@example.com",
            uuid="uuid-123",
        )

        mock_create.assert_called_once()
        self.assertEqual(form_data, mock_form_instance)

    @patch.object(Questions.objects, 'filter')
    def test_questions_query_isolated(self, mock_filter):
        """Test that Questions queries are properly isolated."""
        mock_qs = MagicMock()
        mock_qs.select_related.return_value = mock_qs
        mock_qs.__iter__ = lambda self: iter([])
        mock_filter.return_value = mock_qs

        cmd = Command()
        cmd._prefetch_questions({'flow_qid_1': ['101', '102']})

        mock_filter.assert_called_once()
        mock_qs.select_related.assert_called_with('form')
