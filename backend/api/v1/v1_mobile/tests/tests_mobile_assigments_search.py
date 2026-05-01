import typing
from django.core.management import call_command
from django.http import HttpResponse
from django.test import TestCase, override_settings
from api.v1.v1_mobile.models import MobileAssignment
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False)
class MobileAssignmentSearchTestCase(TestCase, ProfileTestHelperMixin):

    def setUp(self):
        super().setUp()
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)

        self.user = self.create_user("search.admin@akvo.org", self.IS_ADMIN)
        self.token = self.get_auth_token(self.user.email)

        adm = Administration.objects.first()

        self.alpha = MobileAssignment.objects.create_assignment(
            user=self.user, name="Alpha Device"
        )
        self.alpha.administrations.add(adm)

        self.beta = MobileAssignment.objects.create_assignment(
            user=self.user, name="Beta Device"
        )
        self.beta.administrations.add(adm)

        other_user = self.create_user("other.user@beta.org", self.IS_ADMIN)
        self.other = MobileAssignment.objects.create_assignment(
            user=other_user, name="Other Device"
        )
        self.other.administrations.add(adm)

    def _get(self, search=None):
        url = "/api/v1/mobile-assignments"
        if search is not None:
            url += f"?search={search}"
        return typing.cast(
            HttpResponse,
            self.client.get(
                url,
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {self.token}",
            ),
        )

    def test_search_by_name_returns_matching(self):
        response = self._get(search="Alpha")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        ids = [d["id"] for d in data]
        self.assertIn(self.alpha.id, ids)
        self.assertNotIn(self.beta.id, ids)

    def test_search_by_name_case_insensitive(self):
        response = self._get(search="alpha")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["id"], self.alpha.id)

    def test_search_by_partial_name_matches_multiple(self):
        response = self._get(search="Device")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        ids = [d["id"] for d in data]
        self.assertIn(self.alpha.id, ids)
        self.assertIn(self.beta.id, ids)

    def test_search_by_user_email(self):
        response = self._get(search="search.admin")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        ids = [d["id"] for d in data]
        self.assertIn(self.alpha.id, ids)
        self.assertIn(self.beta.id, ids)

    def test_search_by_email_case_insensitive(self):
        response = self._get(search="SEARCH.ADMIN")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        ids = [d["id"] for d in data]
        self.assertIn(self.alpha.id, ids)
        self.assertIn(self.beta.id, ids)

    def test_search_no_match_returns_empty(self):
        response = self._get(search="zzz-no-match")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(len(data), 0)

    def test_search_does_not_expose_other_users_assignments(self):
        response = self._get(search="Other")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        ids = [d["id"] for d in data]
        self.assertNotIn(self.other.id, ids)

    def test_no_search_returns_all_visible(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        ids = [d["id"] for d in data]
        self.assertIn(self.alpha.id, ids)
        self.assertIn(self.beta.id, ids)
        self.assertNotIn(self.other.id, ids)
