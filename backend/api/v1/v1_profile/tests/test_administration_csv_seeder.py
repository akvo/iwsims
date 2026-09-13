"""Tests for the additive administration_csv_seeder command."""
import os
import tempfile
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_profile.models import Administration


@override_settings(USE_TZ=False, TEST_ENV=True, COUNTRY_NAME="indonesia")
class AdministrationCsvSeederTestCase(TestCase):
    """Test data: Indonesia > Jakarta > East Jakarta > Kramat Jati > Cawang."""

    def setUp(self):
        call_command("administration_seeder", "--test")
        self.csv = os.path.join(tempfile.mkdtemp(), "adm.csv")
        with open(self.csv, "w") as f:
            f.write(
                "Province,District,Subdistrict,Village\n"
                "Jakarta,East Jakarta,Kramat Jati,Cawang\n"   # exists
                "Jakarta,East Jakarta,Kramat Jati,Cililitan\n"  # new village
                "Jakarta,East Jakarta,Makasar,Cawang\n"   # new subdistrict,
                "Bali,Badung,Kuta,Legian\n"                # same village name
            )

    def run_seeder(self, *extra):
        out = StringIO()
        call_command(
            "administration_csv_seeder", f"--file={self.csv}", *extra,
            stdout=out,
        )
        return out.getvalue()

    def test_creates_only_missing_nodes_and_keeps_ids(self):
        before = dict(Administration.objects.values_list("id", "name"))
        parent_before = dict(
            Administration.objects.values_list("id", "parent_id")
        )

        output = self.run_seeder()

        self.assertIn("Created 1 Province", output)
        self.assertIn("Created 1 District", output)
        self.assertIn("Created 2 Subdistrict", output)
        self.assertIn("Created 3 Village", output)
        # existing rows untouched
        for pk, name in before.items():
            adm = Administration.objects.get(pk=pk)
            self.assertEqual(adm.name, name)
            self.assertEqual(adm.parent_id, parent_before[pk])
        # same village name under two parents are distinct rows
        cawang = Administration.objects.filter(name="Cawang")
        self.assertEqual(cawang.count(), 2)
        self.assertEqual(
            sorted(c.parent.name for c in cawang),
            ["Kramat Jati", "Makasar"],
        )
        # path is populated for new nodes
        legian = Administration.objects.get(name="Legian")
        self.assertEqual(legian.ancestors.count(), 4)

    def test_rerun_is_idempotent(self):
        self.run_seeder()
        count = Administration.objects.count()
        output = self.run_seeder()
        self.assertEqual(Administration.objects.count(), count)
        self.assertIn("Created 0 Village", output)

    def test_dry_run_writes_nothing(self):
        count = Administration.objects.count()
        output = self.run_seeder("--dry-run")
        self.assertIn("Would create 3 Village", output)
        self.assertEqual(Administration.objects.count(), count)
