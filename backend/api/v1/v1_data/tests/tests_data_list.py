from io import StringIO
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_forms.models import Forms
from api.v1.v1_data.functions import add_fake_answers
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False, TEST_ENV=True)
class FormDataListTestCase(TestCase, ProfileTestHelperMixin):
    def call_command(self, *args, **kwargs):
        out = StringIO()
        call_command(
            "fake_complete_data_seeder",
            "--test=true",
            *args,
            stdout=out,
            stderr=StringIO(),
            **kwargs,
        )
        return out.getvalue()

    def setUp(self):
        super().setUp()
        self.maxDiff = None
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        self.call_command(repeat=2, approved=True, draft=False)
        self.form = Forms.objects.get(pk=1)
        self.data = (
            self.form.form_form_data.filter(
                is_pending=False,
                is_draft=False,
            )
            .order_by("?")
            .first()
        )
        # Create a new superuser
        self.user = self.create_user(
            email="super@akvo.org",
            role_level=self.IS_SUPER_ADMIN,
        )

        self.user.set_password("test")
        self.user.save()

        self.token = self.get_auth_token(self.user.email, "test")

        # Create a draft data entry
        draft_data = self.form.form_form_data.create(
            name="Draft Data",
            administration=self.data.administration,
            geo=self.data.geo,
            created_by=self.user,
            updated_by=self.user,
            is_pending=False,
            is_draft=True,
        )
        add_fake_answers(draft_data)
        self.draft_data = draft_data

    def test_form_data_list_exclude_draft(self):
        """Test that the form data list excludes draft data."""
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(data["total"], 0)
        self.assertNotIn(self.draft_data.id, [d["id"] for d in data["data"]])

    def test_form_data_list_filter_by_administration(self):
        """Test that the form data list can be filtered by administration."""
        adm = self.data.administration
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}?administration={adm.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(data["total"], 0)
        self.assertIn(
            " - ".join(adm.full_name.split("-")[1:]),
            [
                item["administration"] for item in data["data"]
            ]
        )

    def test_form_data_list_filter_by_parent(self):
        """Test that the form data list can be filtered by parent."""
        child_form = self.form.children.first()
        response = self.client.get(
            f"/api/v1/form-data/{child_form.id}?parent={self.data.uuid}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(data["total"], 0)

    def test_form_data_list_search_by_name(self):
        """Test that the form data list can be searched by name."""
        # Create a data entry with a specific name for searching
        search_data = self.form.form_form_data.create(
            name="UniqueSearchableName123",
            administration=self.data.administration,
            geo=self.data.geo,
            created_by=self.user,
            updated_by=self.user,
            is_pending=False,
            is_draft=False,
        )
        add_fake_answers(search_data)
        search_data.name = "UniqueSearchable"
        search_data.save()

        # First verify the data exists without search filter
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        all_ids = [d["id"] for d in data["data"]]
        self.assertIn(search_data.id, all_ids)

        # Now test search functionality
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}?search=UniqueSearchable",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["data"][0]["id"], search_data.id)

    def test_form_data_list_search_case_insensitive(self):
        """Test that the search is case-insensitive."""
        search_data = self.form.form_form_data.create(
            name="CaseSensitiveTest",
            administration=self.data.administration,
            geo=self.data.geo,
            created_by=self.user,
            updated_by=self.user,
            is_pending=False,
            is_draft=False,
        )
        add_fake_answers(search_data)
        search_data.name = "CaseSensitiveTest"
        search_data.save()

        # Search with lowercase
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}?search=casesensitivetest",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["data"][0]["id"], search_data.id)

        # Search with uppercase
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}?search=CASESENSITIVETEST",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["data"][0]["id"], search_data.id)

    def test_form_data_list_search_no_results(self):
        """Test that search returns empty results when no match."""
        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}?search=NonExistentName12345",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 0)
        self.assertEqual(data["data"], [])

    def test_form_data_list_search_combined_with_administration(self):
        """Test that search can be combined with administration filter."""
        search_data = self.form.form_form_data.create(
            name="CombinedFilterTest",
            administration=self.data.administration,
            geo=self.data.geo,
            created_by=self.user,
            updated_by=self.user,
            is_pending=False,
            is_draft=False,
        )
        add_fake_answers(search_data)
        search_data.name = "CombinedFilter"
        search_data.save()
        adm = self.data.administration

        response = self.client.get(
            f"/api/v1/form-data/{self.form.id}"
            f"?search=CombinedFilter&administration={adm.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["data"][0]["id"], search_data.id)
