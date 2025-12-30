import pandas as pd
from unittest.mock import patch
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from django.core.management.base import CommandError
from io import StringIO

from api.v1.v1_data.models import FormData
from api.v1.v1_data.management.commands.flow_data_seeder import Command
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

    def test_argument_parser_with_valid_form_id_and_email(self):
        """Test argument parsing with valid form ID and email."""
        out = StringIO()
        with patch.object(Command, '_load_question_mappings') as mock_load:
            with patch.object(Command, '_load_data_file') as mock_data:
                mock_load.return_value = {}
                mock_data.return_value = pd.DataFrame()

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

    def test_argument_parser_with_revert_flag(self):
        """Test argument parsing with --revert flag."""
        out = StringIO()
        with patch('pandas.read_csv') as mock_read_csv:
            # Mock seeded data CSV
            seeded_data = pd.DataFrame({
                'mis_data_id': [1, 2, 3],
                'flow_data_id': ['dp1', 'dp2', 'dp3']
            })
            mock_read_csv.return_value = seeded_data

            call_command(
                "flow_data_seeder",
                "-f", "123",
                "--revert",
                True,
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
                    "--email", "test@example.com",
                    "--limit", "10",
                    stdout=out,
                    stderr=StringIO()
                )

        output = out.getvalue()
        self.assertIn("Starting Flow Data Seeding", output)
        self.assertIn("Limited to first 10 records", output)

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

    def test_email_argument_with_valid_existing_user(self):
        """Test command with valid email of existing user."""
        out = StringIO()
        with patch.object(Command, '_load_question_mappings') as mock_load:
            with patch.object(Command, '_load_data_file') as mock_data:
                mock_load.return_value = {}
                mock_data.return_value = pd.DataFrame()

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
        with patch.object(Command, '_load_question_mappings') as mock_load:
            with patch.object(Command, '_load_data_file') as mock_data:
                mock_load.return_value = {}
                mock_data.return_value = pd.DataFrame()

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

    @patch('pandas.read_csv')
    def test_revert_deletes_records(self, mock_read_csv):
        """Test that revert deletes seeded records."""
        # Create test FormData records
        fd1 = FormData.objects.create(
            name="Test 1",
            administration=self.admin,
            geo=[1.0, 2.0],
            submitter="submitter@example.com",
            uuid="uuid-1",
            form=self.form,
            created_by=self.test_user
        )
        fd2 = FormData.objects.create(
            name="Test 2",
            administration=self.admin,
            geo=[1.0, 2.0],
            submitter="submitter@example.com",
            uuid="uuid-2",
            form=self.form,
            created_by=self.test_user
        )

        # Mock seeded data CSV
        seeded_data = pd.DataFrame({
            'mis_data_id': [fd1.pk, fd2.pk],
            'flow_data_id': ['dp1', 'dp2']
        })
        mock_read_csv.return_value = seeded_data

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--revert", "True",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Successfully reverted 2 records", output)

        # Verify records were deleted
        form_data_count = FormData.objects.count()
        self.assertEqual(form_data_count, 0)

    @patch('pandas.read_csv')
    def test_revert_with_nan_values(self, mock_read_csv):
        """Test revert with NaN values in CSV."""
        # Create test FormData record
        fd1 = FormData.objects.create(
            name="Test 1",
            administration=self.admin,
            geo=[1.0, 2.0],
            submitter="submitter@example.com",
            uuid="uuid-1",
            form=self.form,
            created_by=self.test_user
        )

        # Mock seeded data CSV with NaN
        seeded_data = pd.DataFrame({
            'mis_data_id': [fd1.pk, None],
            'flow_data_id': ['dp1', 'dp2']
        })
        mock_read_csv.return_value = seeded_data

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--revert", "True",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Successfully reverted 1 records", output)

    @patch('pandas.read_csv')
    def test_revert_file_not_found(self, mock_read_csv):
        """Test revert when seeded file not found."""
        mock_read_csv.side_effect = FileNotFoundError("File not found")

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--revert", "True",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Seeded data file not found", output)

    @patch('pandas.read_csv')
    def test_revert_with_exception(self, mock_read_csv):
        """Test revert with general exception."""
        mock_read_csv.side_effect = Exception("Unexpected error")

        out = StringIO()
        call_command(
            "flow_data_seeder",
            "-f", "123",
            "--revert", "True",
            stdout=out,
            stderr=StringIO()
        )

        output = out.getvalue()
        self.assertIn("Error during revert", output)
