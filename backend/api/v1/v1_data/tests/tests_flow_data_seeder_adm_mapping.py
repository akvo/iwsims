import pandas as pd
from unittest.mock import patch
from django.test import TestCase
from django.test.utils import override_settings
from api.v1.v1_data.management.commands.flow_data_seeder import Command


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadAdministrationMappingsTestCase(TestCase):
    """Test suite for _load_administration_mappings method."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.command = Command()

    @patch('pandas.read_csv')
    def test_load_administration_mappings_success(self, mock_read_csv):
        """Test successful loading of administration mappings."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': ['1', '2', '3'],
            'mis_value': ['adm1', 'adm2', 'adm3'],
        })
        mock_read_csv.return_value = csv_data

        result = self.command._load_administration_mappings()

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
            'flow_datapoint_id': ['1', '2', '3', '4'],
            'mis_value': ['adm1', '', None, 'adm3'],
        })
        mock_read_csv.return_value = csv_data

        result = self.command._load_administration_mappings()

        self.assertEqual(len(result), 2)
        self.assertIn('1', result)
        self.assertIn('4', result)
        self.assertNotIn('2', result)
        self.assertNotIn('3', result)

    @patch('pandas.read_csv')
    def test_load_administration_mappings_file_not_found(
        self, mock_read_csv
    ):
        """Test handling when file is not found."""
        mock_read_csv.side_effect = FileNotFoundError("File not found")

        result = self.command._load_administration_mappings()

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_administration_mappings_empty_file(self, mock_read_csv):
        """Test handling when file is empty."""
        mock_read_csv.side_effect = pd.errors.EmptyDataError("Empty file")

        result = self.command._load_administration_mappings()

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_administration_mappings_missing_columns(
        self, mock_read_csv
    ):
        """Test handling when CSV has missing columns."""
        mock_read_csv.side_effect = KeyError("Missing columns")

        result = self.command._load_administration_mappings()

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_administration_mappings_unexpected_error(
        self, mock_read_csv
    ):
        """Test handling of unexpected errors."""
        mock_read_csv.side_effect = Exception("Unexpected error")

        result = self.command._load_administration_mappings()

        self.assertEqual(result, {})
