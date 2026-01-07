import pandas as pd
from unittest.mock import patch
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from django.core.management.base import CommandError
from io import StringIO

from api.v1.v1_forms.models import Forms
from api.v1.v1_users.models import SystemUser
from api.v1.v1_profile.models import Administration, Levels


@override_settings(USE_TZ=False, TEST_ENV=True)
class FlowDataSeederCommandTestCase(TestCase):
    """Test suite for flow_data_seeder management command."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.test_user = SystemUser.objects.create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            password="testpass123"
        )

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

    def test_argument_parser_required_email_flag(self):
        """Test that --email flag is required when not reverting."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        # Email is required when not reverting
        self.assertIn("Email argument is required", output)

    @patch('utils.seeder_config.validate_configuration')
    @patch('utils.seeder_data_loader.load_and_prepare_data')
    def test_argument_parser_with_valid_form_id_and_email(
        self, mock_load_data, mock_validate
    ):
        """Test argument parsing with valid form ID and email."""
        mock_validate.return_value = None
        mock_load_data.return_value = (pd.DataFrame(), pd.DataFrame())

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "test@example.com",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Starting Flow Data Seeding", output)
        self.assertIn("Form ID: 123", output)

    @patch(
        'api.v1.v1_data.management.commands'
        '.flow_data_seeder.revert_seeded_data'
    )
    def test_argument_parser_with_revert_flag(self, mock_revert):
        """Test argument parsing with --revert flag."""
        mock_revert.return_value = None

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--revert",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Reverting Flow Data Seeding", output)
        self.assertIn("Form ID: 123", output)

    @patch('utils.seeder_config.validate_configuration')
    @patch('utils.seeder_data_loader.load_and_prepare_data')
    def test_argument_parser_with_limit_flag(
        self, mock_load_data, mock_validate
    ):
        """Test argument parsing with --limit flag."""
        mock_validate.return_value = None
        mock_load_data.return_value = (pd.DataFrame(), pd.DataFrame())

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "test@example.com",
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
            "--email", "test@example.com",
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
            "--email", "test@example.com",
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
            "--email", "test@example.com",
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
            "--email", "test@example.com",
            "--limit", "-5",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Limit must be a positive integer", output)


@override_settings(USE_TZ=False, TEST_ENV=True)
class EmailArgumentValidationTestCase(TestCase):
    """Test suite for email argument validation."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.test_user = SystemUser.objects.create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            password="testpass123"
        )

    @patch('utils.seeder_config.validate_configuration')
    @patch('utils.seeder_data_loader.load_and_prepare_data')
    def test_email_argument_with_valid_existing_user(
        self, mock_load_data, mock_validate
    ):
        """Test command with valid email of existing user."""
        mock_validate.return_value = None
        mock_load_data.return_value = (pd.DataFrame(), pd.DataFrame())

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "test@example.com",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Starting Flow Data Seeding", output)
        self.assertNotIn("not found", output)

    def test_email_argument_with_nonexistent_user(self):
        """Test command with email of non-existent user."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "nonexistent@example.com",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn(
            "User with email nonexistent@example.com not found", output
        )

    def test_email_argument_with_empty_string(self):
        """Test command with empty email string."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        # Empty email should trigger required email error
        self.assertIn("Email argument is required", output)

    def test_email_argument_with_whitespace_only(self):
        """Test command with whitespace-only email."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "   ",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        # Whitespace-only email should fail user lookup
        self.assertIn("not found", output.lower())

    def test_email_argument_with_invalid_format(self):
        """Test command with invalid email format."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "invalid-email-format",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        expected_msg = "User with email invalid-email-format not found"
        self.assertIn(expected_msg, output)

    def test_email_argument_with_multiple_at_symbols(self):
        """Test command with email containing multiple @ symbols."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "test@@example.com",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("User with email test@@example.com not found", output)

    def test_email_argument_with_no_domain(self):
        """Test command with email without domain."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "test@",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("User with email test@ not found", output)

    def test_email_argument_with_no_local_part(self):
        """Test command with email without local part."""
        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "@example.com",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("User with email @example.com not found", output)

    def test_email_argument_case_sensitivity(self):
        """Test that email lookup is case-sensitive."""
        # Create user with lowercase email
        SystemUser.objects.create_user(
            email="casesensitive@example.com",
            first_name="Case",
            last_name="Sensitive",
            password="testpass123"
        )

        out = StringIO()
        # Try with uppercase - should NOT find user
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--email", "CASESENSITIVE@EXAMPLE.COM",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        # Should NOT find user due to case-sensitive lookup
        self.assertIn("not found", output.lower())


@override_settings(USE_TZ=False, TEST_ENV=True)
class RevertFunctionalityTestCase(TestCase):
    """Test suite for revert functionality."""

    def setUp(self):
        """Set up test environment."""
        super().setUp()
        self.level = Levels.objects.create(name="Test Level", level=1)
        self.admin = Administration.objects.create(
            name="Test Administration",
            level=self.level
        )
        self.form = Forms.objects.create(name="Test Form")
        self.test_user = SystemUser.objects.create_user(
            email="test@example.com",
            first_name="Test",
            last_name="User",
            password="testpass123"
        )

    @patch(
        'api.v1.v1_data.management.commands.'
        'flow_data_seeder.revert_seeded_data'
    )
    def test_revert_calls_revert_function(self, mock_revert):
        """Test that revert calls the revert_seeded_data function."""
        mock_revert.return_value = None

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--revert",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Reverting Flow Data Seeding", output)
        mock_revert.assert_called_once_with(123)
