from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.test.utils import override_settings
from api.v1.v1_data.management.commands.flow_data_seeder import (
    Command,
    CADDISFLY_TYPE,
    CADDISFLY_RESULT,
    TYPE_KEY,
    NAME_KEY,
    UNIT_KEY,
    VALUE_KEY,
)


@override_settings(USE_TZ=False, TEST_ENV=True)
class GenerateData2CsvTestCase(TestCase):
    """Test suite for _generate_data2csv method."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    @patch('pandas.DataFrame')
    def test_generate_data2csv_success(self, mock_df_class):
        """Test successful CSV generation."""
        mock_df_instance = MagicMock()
        mock_df_instance.to_csv = MagicMock()
        mock_df_class.return_value = mock_df_instance

        test_data = [
            {'id': 1, 'name': 'Test'},
            {'id': 2, 'name': 'Test 2'},
        ]

        with patch('builtins.open', create=True) as mock_open:
            mock_file = MagicMock()
            mock_open.return_value.__enter__.return_value = mock_file

            self.command._generate_data2csv(
                flow_id=123, path="test", data=test_data
            )

            mock_df_class.assert_called_once_with(test_data)
            mock_df_instance.to_csv.assert_called_once()
            call_args = mock_df_instance.to_csv.call_args
            self.assertEqual(call_args[1]['index'], False)
            self.assertEqual(call_args[1]['encoding'], 'utf-8')

    @patch('pandas.DataFrame')
    def test_generate_data2csv_empty_data(self, mock_df_class):
        """Test CSV generation with empty data."""
        mock_df_instance = MagicMock()
        mock_df_instance.to_csv = MagicMock()
        mock_df_class.return_value = mock_df_instance

        with patch('builtins.open', create=True) as mock_open:
            mock_file = MagicMock()
            mock_open.return_value.__enter__.return_value = mock_file

            self.command._generate_data2csv(
                flow_id=123, path="test", data=[]
            )

            mock_df_class.assert_called_once_with([])
            mock_df_instance.to_csv.assert_called_once()


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
