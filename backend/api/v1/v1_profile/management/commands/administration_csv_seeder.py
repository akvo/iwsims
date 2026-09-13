"""Additive administration import from a CSV hierarchy.

Each CSV column is one level below National, in order (for Fiji:
Division, Province, Tikina, Village). A node is matched by name, level and
parent; missing nodes are created, existing ones are never modified, so
existing ids stay stable on every environment.

    python manage.py administration_csv_seeder --file=./source/fiji.csv
    python manage.py administration_csv_seeder --file=... --dry-run
"""
import pandas as pd
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.v1.v1_profile.models import Administration, Levels


def load_rows(file_path: str) -> pd.DataFrame:
    df = pd.read_csv(file_path, dtype=str)
    df = df.apply(lambda s: s.str.strip())
    return df.dropna(how="all").drop_duplicates()


class Command(BaseCommand):
    help = "Create missing administrations from a CSV; never edits existing"

    def add_arguments(self, parser):
        parser.add_argument(
            "--file", default=f"./source/{settings.COUNTRY_NAME}.csv",
            help="CSV with one column per level below National",
        )
        parser.add_argument(
            "--dry-run", action="store_true", default=False,
            help="Report what would be created without writing",
        )

    def handle(self, *args, **options):
        df = load_rows(options["file"])
        levels = list(Levels.objects.order_by("level"))
        if len(df.columns) > len(levels) - 1:
            raise CommandError(
                f"CSV has {len(df.columns)} levels but only "
                f"{len(levels) - 1} sub-national levels exist"
            )
        country = Administration.objects.filter(
            level=levels[0], name=settings.COUNTRY_NAME.capitalize()
        ).first()
        if country is None:
            raise CommandError(
                f"National node '{settings.COUNTRY_NAME}' not found"
            )

        created = {col: 0 for col in df.columns}
        planned = set()  # dry-run: paths counted once
        with transaction.atomic():
            for _, row in df.iterrows():
                parent = country
                for depth, col in enumerate(df.columns, start=1):
                    name = row[col]
                    if not isinstance(name, str) or not name:
                        break  # shorter row: stop at the last given level
                    node = Administration.objects.filter(
                        name=name, level=levels[depth], parent=parent
                    ).first()
                    if node is None and options["dry_run"]:
                        # everything below a missing node is missing too
                        below = df.columns[depth - 1:]
                        for i, rest in enumerate(below, depth):
                            if not isinstance(row[rest], str) or not row[rest]:
                                break
                            key = tuple(row[c] for c in df.columns[:i])
                            if key not in planned:
                                planned.add(key)
                                created[rest] += 1
                        break
                    if node is None:
                        created[col] += 1
                        node = Administration.objects.create(
                            name=name, level=levels[depth], parent=parent
                        )
                    parent = node

        mode = "Would create" if options["dry_run"] else "Created"
        for col, count in created.items():
            self.stdout.write(f"{mode} {count} {col}")
