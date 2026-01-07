"""
Tests for Flow Data Seeder administration mapping functionality.

This module tests the administration mapping functionality that was
moved from the flow_data_seeder command to the seeder_data_loader
utility module.
"""

import pandas as pd
from unittest.mock import patch
from django.test import TestCase
from django.test.utils import override_settings

from utils.seeder_config import SeederConfig
from utils.seeder_data_loader import (
    load_administration_mappings,
    load_administration_db_mappings,
    get_administration_id,
)
from api.v1.v1_profile.models import Administration, Levels


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadAdministrationMappingsTestCase(TestCase):
    """Test suite for load_administration_mappings function."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.config = SeederConfig(flow_form_id=123)

    @patch('pandas.read_csv')
    def test_load_administration_mappings_success(self, mock_read_csv):
        """Test successful loading of administration mappings."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': [1, 2, 3],
            'mis_value': ['adm1', 'adm2', 'adm3'],
        })
        mock_read_csv.return_value = csv_data

        result = load_administration_mappings(self.config)

        self.assertEqual(len(result), 3)
        self.assertEqual(result[1], 'adm1')
        self.assertEqual(result[2], 'adm2')
        self.assertEqual(result[3], 'adm3')

    @patch('pandas.read_csv')
    def test_load_administration_mappings_filters_empty_values(
        self, mock_read_csv
    ):
        """Test that empty and null mis_value are filtered out."""
        csv_data = pd.DataFrame({
            'flow_datapoint_id': [1, 2, 3, 4],
            'mis_value': ['adm1', '', None, 'adm3'],
        })
        mock_read_csv.return_value = csv_data

        result = load_administration_mappings(self.config)

        self.assertEqual(len(result), 2)
        self.assertIn(1, result)
        self.assertIn(4, result)
        self.assertNotIn(2, result)
        self.assertNotIn(3, result)

    @patch('pandas.read_csv')
    def test_load_administration_mappings_file_not_found(
        self, mock_read_csv
    ):
        """Test handling when file is not found."""
        mock_read_csv.side_effect = FileNotFoundError("File not found")

        result = load_administration_mappings(self.config)

        self.assertEqual(result, {})

    @patch('pandas.read_csv')
    def test_load_administration_mappings_empty_file(self, mock_read_csv):
        """Test handling when file is empty."""
        mock_read_csv.side_effect = pd.errors.EmptyDataError("Empty file")

        result = load_administration_mappings(self.config)

        self.assertEqual(result, {})


@override_settings(USE_TZ=False, TEST_ENV=True)
class LoadAdministrationDbMappingsTestCase(TestCase):
    """Test suite for load_administration_db_mappings function."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.level1 = Levels.objects.create(name="Country", level=1)
        self.level2 = Levels.objects.create(name="Region", level=2)
        self.country = Administration.objects.create(
            name="Test Country",
            level=self.level1
        )
        self.region1 = Administration.objects.create(
            name="Region 1",
            level=self.level2,
            parent=self.country
        )
        self.region2 = Administration.objects.create(
            name="Region 2",
            level=self.level2,
            parent=self.country
        )

    def test_load_administration_db_mappings_success(self):
        """Test successful loading of administration DB mappings."""
        result = load_administration_db_mappings()

        self.assertEqual(len(result), 2)
        self.assertIn("Region 1", result)
        self.assertIn("Region 2", result)
        # Country should not be included as it has no parent
        self.assertNotIn("Test Country", result)

    def test_load_administration_db_mappings_returns_ids_as_strings(self):
        """Test that administration IDs are returned as strings."""
        result = load_administration_db_mappings()

        for value in result.values():
            self.assertIsInstance(value, str)


@override_settings(USE_TZ=False, TEST_ENV=True)
class GetAdministrationIdTestCase(TestCase):
    """Test suite for get_administration_id function."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.level1 = Levels.objects.create(name="Country", level=1)
        self.level2 = Levels.objects.create(name="Region", level=2)
        self.country = Administration.objects.create(
            name="Test Country",
            level=self.level1
        )
        self.region1 = Administration.objects.create(
            name="Region 1",
            level=self.level2,
            parent=self.country
        )
        self.adm_mappings = {1: "100", 2: "200"}
        self.adm_db_mappings = {"Region 1": str(self.region1.id)}

    def test_get_administration_id_from_flow_mapping(self):
        """Test getting administration ID from flow datapoint mapping."""
        row = pd.Series({
            'datapoint_id': 1,
            'administration': 'Some Admin'
        })
        result = get_administration_id(
            row=row,
            adm_mappings=self.adm_mappings,
            adm_db_mappings=self.adm_db_mappings
        )
        self.assertEqual(result, 100)

    def test_get_administration_id_from_db_mapping(self):
        """Test getting administration ID from DB mapping fallback."""
        row = pd.Series({
            'datapoint_id': 999,  # Not in adm_mappings
            'administration': 'Region 1'
        })
        result = get_administration_id(
            row=row,
            adm_mappings=self.adm_mappings,
            adm_db_mappings=self.adm_db_mappings
        )
        self.assertEqual(result, self.region1.id)

    def test_get_administration_id_not_found(self):
        """Test getting administration ID when not found."""
        row = pd.Series({
            'datapoint_id': 999,
            'administration': 'Unknown Region'
        })
        result = get_administration_id(
            row=row,
            adm_mappings=self.adm_mappings,
            adm_db_mappings=self.adm_db_mappings
        )
        self.assertIsNone(result)

    def test_get_administration_id_flow_mapping_priority(self):
        """Test that flow mapping has priority over DB mapping."""
        row = pd.Series({
            'datapoint_id': 1,  # In adm_mappings as "100"
            'administration': 'Region 1'  # In adm_db_mappings
        })
        result = get_administration_id(
            row=row,
            adm_mappings=self.adm_mappings,
            adm_db_mappings=self.adm_db_mappings
        )
        # Should return flow mapping value (100), not DB mapping
        self.assertEqual(result, 100)
