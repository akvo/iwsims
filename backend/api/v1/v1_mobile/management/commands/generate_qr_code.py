import qrcode
from pathlib import Path

from django.core.management import BaseCommand
from mis.settings import STORAGE_PATH, WEBDOMAIN


class Command(BaseCommand):
    help = "Generate QR code for the mobile app download link"

    def add_arguments(self, parser):
        parser.add_argument(
            "--url",
            type=str,
            default=None,
            help="URL to encode in the QR code (default: WEBDOMAIN/app)",
        )

    def handle(self, *args, **options):
        url = options.get("url") or f"{WEBDOMAIN}/app"

        images_dir = Path(f"{STORAGE_PATH}/images")
        images_dir.mkdir(parents=True, exist_ok=True)

        output_path = images_dir / "download-app.png"

        img = qrcode.make(url)
        img.save(str(output_path))

        self.stdout.write(
            self.style.SUCCESS(
                f"QR code generated: {output_path}"
            )
        )
