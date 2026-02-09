import os
import shutil
from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase

from mis.settings import STORAGE_PATH


class GenerateQrCodeCommandTest(TestCase):
    def setUp(self):
        self.images_dir = Path(f"{STORAGE_PATH}/images")
        self.output_file = self.images_dir / "download-app.png"

    def tearDown(self):
        if self.output_file.exists():
            os.remove(self.output_file)

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
