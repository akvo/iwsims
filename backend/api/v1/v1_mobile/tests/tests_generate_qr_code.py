import shutil
import tempfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

COMMAND_MODULE = (
    "api.v1.v1_mobile.management.commands.generate_qr_code.STORAGE_PATH"
)


class GenerateQrCodeCommandTest(TestCase):
    """Run the command against a throwaway storage directory.

    STORAGE_PATH/images is the live image store: on a dev machine it is
    bind-mounted straight into the frontend container as /app/public/images.
    test_generate_qr_code_creates_images_directory deletes that directory to
    prove the command recreates it, which against the real path wipes every
    downloaded datapoint photo.
    """

    def setUp(self):
        self.storage = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.storage, True)
        patcher = patch(COMMAND_MODULE, self.storage)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.images_dir = Path(self.storage) / "images"
        self.output_file = self.images_dir / "download-app.png"

    def test_generate_qr_code_default_url(self):
        out = StringIO()
        call_command("generate_qr_code", stdout=out)

        self.assertTrue(self.output_file.exists())
        self.assertGreater(self.output_file.stat().st_size, 0)
        self.assertIn("QR code generated", out.getvalue())

    def test_generate_qr_code_with_png_header(self):
        call_command("generate_qr_code")

        with open(self.output_file, "rb") as f:
            header = f.read(8)
        # PNG magic bytes
        self.assertEqual(
            header, b"\x89PNG\r\n\x1a\n"
        )

    def test_generate_qr_code_custom_url(self):
        out = StringIO()
        call_command(
            "generate_qr_code",
            "--url", "https://example.com/app",
            stdout=out,
        )

        self.assertTrue(self.output_file.exists())
        self.assertGreater(self.output_file.stat().st_size, 0)

    def test_generate_qr_code_creates_images_directory(self):
        # Remove images dir if it exists
        if self.images_dir.exists():
            shutil.rmtree(self.images_dir)

        call_command("generate_qr_code")

        self.assertTrue(self.images_dir.exists())
        self.assertTrue(self.output_file.exists())

    def test_generate_qr_code_overwrites_existing_file(self):
        call_command("generate_qr_code")
        first_size = self.output_file.stat().st_size

        call_command(
            "generate_qr_code",
            "--url", "https://different-url.com/app",
        )
        second_size = self.output_file.stat().st_size
        self.assertNotEqual(first_size, second_size)

        self.assertTrue(self.output_file.exists())
        self.assertGreater(second_size, 0)
