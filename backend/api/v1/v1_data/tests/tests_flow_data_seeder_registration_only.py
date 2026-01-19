"""
Tests for Flow Data Seeder --registration flag functionality.

This module tests the --registration flag that restricts seeding to
registration (parent) data only, excluding all monitoring (child) data.

Uses the same simple mocking pattern as tests_flow_data_seeder_command.py.
"""

import os
import tempfile
import shutil
import pandas as pd
from unittest.mock import patch
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from io import StringIO

from api.v1.v1_forms.models import Forms
from api.v1.v1_users.models import SystemUser


@override_settings(USE_TZ=False, TEST_ENV=True)
class RegistrationFlagTestCase(TestCase):
    """Test suite for --registration flag functionality."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.test_user = SystemUser.objects.create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            password="testpass123"
        )

    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.refresh_materialized_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.load_and_prepare_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.get_form_by_flow_id'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.validate_and_prepare_config'
    )
    def test_registration_flag_shows_mode_message(
        self, mock_validate, mock_get_form, mock_load_data, mock_refresh
    ):
        """Test that --registration flag shows mode message in output."""
        from utils.seeder_config import SeederConfig

        temp_dir = tempfile.mkdtemp()
        output_dir = os.path.join(temp_dir, "data")
        os.makedirs(output_dir, exist_ok=True)

        try:
            mock_form = Forms.objects.create(name="Mock Form")
            mock_get_form.return_value = mock_form
            mock_load_data.return_value = (pd.DataFrame(), {})
            mock_validate.return_value = SeederConfig(
                flow_form_id=123, user=self.test_user, source_dir=temp_dir
            )

            out = StringIO()
            call_command(
                "flow_data_seeder",
                "-f", "123",
                "--email", "test@example.com",
                "--registration",
                stdout=out,
                stderr=StringIO()
            )

            output = out.getvalue()
            self.assertIn("Mode: Registration only", output)
            self.assertIn("monitoring data will be skipped", output)
        finally:
            shutil.rmtree(temp_dir)

    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.refresh_materialized_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.load_and_prepare_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.get_form_by_flow_id'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.validate_and_prepare_config'
    )
    def test_registration_flag_shows_zero_monitoring(
        self, mock_validate, mock_get_form, mock_load_data, mock_refresh
    ):
        """Test that --registration shows zero monitoring records."""
        from utils.seeder_config import SeederConfig

        temp_dir = tempfile.mkdtemp()
        output_dir = os.path.join(temp_dir, "data")
        os.makedirs(output_dir, exist_ok=True)

        try:
            mock_form = Forms.objects.create(name="Mock Form")
            mock_get_form.return_value = mock_form
            mock_load_data.return_value = (pd.DataFrame(), {})
            mock_validate.return_value = SeederConfig(
                flow_form_id=123, user=self.test_user, source_dir=temp_dir
            )

            out = StringIO()
            call_command(
                "flow_data_seeder",
                "-f", "123",
                "--email", "test@example.com",
                "--registration",
                stdout=out,
                stderr=StringIO()
            )

            output = out.getvalue()
            self.assertIn("Total new monitoring: 0", output)
        finally:
            shutil.rmtree(temp_dir)

    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.refresh_materialized_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.load_and_prepare_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.get_form_by_flow_id'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.validate_and_prepare_config'
    )
    def test_without_registration_flag_no_mode_message(
        self, mock_validate, mock_get_form, mock_load_data, mock_refresh
    ):
        """Test that without --registration, mode message is not shown."""
        from utils.seeder_config import SeederConfig

        temp_dir = tempfile.mkdtemp()
        output_dir = os.path.join(temp_dir, "data")
        os.makedirs(output_dir, exist_ok=True)

        try:
            mock_form = Forms.objects.create(name="Mock Form")
            mock_get_form.return_value = mock_form
            mock_load_data.return_value = (pd.DataFrame(), {})
            mock_validate.return_value = SeederConfig(
                flow_form_id=123, user=self.test_user, source_dir=temp_dir
            )

            out = StringIO()
            call_command(
                "flow_data_seeder",
                "-f", "123",
                "--email", "test@example.com",
                stdout=out,
                stderr=StringIO()
            )

            output = out.getvalue()
            self.assertNotIn("Mode: Registration only", output)
        finally:
            shutil.rmtree(temp_dir)

    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.refresh_materialized_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.load_and_prepare_data'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.get_form_by_flow_id'
    )
    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.validate_and_prepare_config'
    )
    def test_registration_flag_with_limit(
        self, mock_validate, mock_get_form, mock_load_data, mock_refresh
    ):
        """Test that --registration works with --limit option."""
        from utils.seeder_config import SeederConfig

        temp_dir = tempfile.mkdtemp()
        output_dir = os.path.join(temp_dir, "data")
        os.makedirs(output_dir, exist_ok=True)

        try:
            mock_form = Forms.objects.create(name="Mock Form")
            mock_get_form.return_value = mock_form
            mock_load_data.return_value = (pd.DataFrame(), {})
            mock_validate.return_value = SeederConfig(
                flow_form_id=123, limit=5, user=self.test_user,
                source_dir=temp_dir
            )

            out = StringIO()
            call_command(
                "flow_data_seeder",
                "-f", "123",
                "--email", "test@example.com",
                "--registration",
                "--limit", "5",
                stdout=out,
                stderr=StringIO()
            )

            output = out.getvalue()
            self.assertIn("Mode: Registration only", output)
            self.assertIn("Total new monitoring: 0", output)
        finally:
            shutil.rmtree(temp_dir)
