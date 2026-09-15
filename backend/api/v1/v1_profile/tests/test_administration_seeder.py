from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_profile.management.commands import administration_seeder
from api.v1.v1_profile.models import Levels, Administration
from api.v1.v1_users.serializers import ListAdministrationChildrenSerializer


@override_settings(USE_TZ=False, TEST_ENV=True)
class AdministrationSeederTestCase(TestCase):
    def test_administration_seeder_production(self):
        administration_seeder.seed_administration_prod()
        administrator_level = (
            Administration.objects.order_by("-level")
            .values_list("level", flat=True)
            .distinct()
        )
        level_ids = Levels.objects.order_by("-id").values_list("id", flat=True)
        self.assertTrue(set(administrator_level).issubset(set(level_ids)))
        children = Administration.objects.filter(level__level=1).all()
        children = ListAdministrationChildrenSerializer(
            instance=children.order_by("name"), many=True
        )
        national = Administration.objects.filter(level__level=0).first()
        response = self.client.get(
            f"/api/v1/administration/{national.pk}", follow=True
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {
                "id": national.pk,
                "level": 0,
                "level_name": "National",
                "name": national.name,
                "parent": None,
                "children": list(children.data),
                "children_level_name": "Division",
                "full_name": national.full_name,
                "path": None,
            },
            response.json(),
        )

    def test_administration_seeder_test(self):
        administration_seeder.seed_administration_test()
        administrator_level = (
            Administration.objects.order_by("-level")
            .values_list("level", flat=True)
            .distinct()
        )
        level_ids = Levels.objects.order_by("-id").values_list("id", flat=True)
        self.assertEqual(list(administrator_level), list(level_ids))
        national = Administration.objects.filter(level__level=0).first()
        response = self.client.get(
            f"/api/v1/administration/{national.pk}", follow=True
        )
        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(
            list(response.json()),
            [
                "id",
                "level",
                "level_name",
                "name",
                "parent",
                "children",
                "children_level_name",
                "full_name",
                "path"
            ]
        )

        # Test max_level
        response = self.client.get(
            f"/api/v1/administration/{national.pk}?max_level=0", follow=True
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], national.pk)
        self.assertEqual(len(response.json()["children"]), 0)

        # tests filter
        first_child = Administration.objects.filter(parent=national).first()
        response = self.client.get(
            f"/api/v1/administration/{national.pk}?filter={first_child.pk}",
            follow=True
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["children"]), 1)

    def test_same_name_at_different_levels(self):
        """A name repeated down the chain gets a row per level.

        Rotuma is both a province and the tikina beneath it. Keying the
        upsert on name alone collapsed the two into one row, so the path
        Eastern|Rotuma|Rotuma could never resolve.
        """
        administration_seeder.seed_administration_test(rows=[{
            "id": 1,
            "code_0": "FJ",
            "National_0": "Fiji",
            "code_1": "FJ-E",
            "Province_1": "Eastern",
            "code_2": "FJ-E-R",
            "District_2": "Rotuma",
            "code_3": "FJ-E-R-R",
            "Subdistrict_3": "Rotuma",
            "code_4": "FJ-E-R-R-L",
            "Village_4": "Lopta",
        }])

        rotumas = Administration.objects.filter(name="Rotuma")
        self.assertEqual(rotumas.count(), 2)

        province = rotumas.get(level__level=2)
        tikina = rotumas.get(level__level=3)
        self.assertEqual(province.parent.name, "Eastern")
        self.assertEqual(tikina.parent_id, province.pk)
        self.assertEqual(tikina.full_path_name, "Fiji|Eastern|Rotuma|Rotuma")

    def test_same_name_under_different_parents(self):
        """Duplicate names on one level stay attached to their own parent."""
        shared = {
            "id": 1,
            "code_0": "FJ",
            "National_0": "Fiji",
            "code_3": "FJ-X",
            "Subdistrict_3": "Somewhere",
            "code_4": "FJ-X-N",
            "Village_4": "Nasau",
        }
        administration_seeder.seed_administration_test(rows=[
            {**shared, "Province_1": "Eastern", "District_2": "Lau"},
            {**shared, "Province_1": "Northern", "District_2": "Bua"},
        ])

        villages = Administration.objects.filter(
            name="Nasau", level__level=4
        )
        self.assertEqual(villages.count(), 2)
        self.assertCountEqual(
            [v.full_path_name for v in villages],
            [
                "Fiji|Eastern|Lau|Somewhere|Nasau",
                "Fiji|Northern|Bua|Somewhere|Nasau",
            ],
        )
