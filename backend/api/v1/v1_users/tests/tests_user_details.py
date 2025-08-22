from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings

from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin
from api.v1.v1_profile.models import Levels, Administration
from api.v1.v1_forms.models import Forms


@override_settings(USE_TZ=False, TEST_ENV=True)
class UserDetailsTestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test", 1)
        call_command("fake_organisation_seeder", "--repeat", 2)
        # Create a superuser for testing
        self.superuser = self.create_user(
            email="super@akvo.org",
            role_level=self.IS_SUPER_ADMIN,
        )
        self.token = self.get_auth_token(self.superuser.email)

        self.form = Forms.objects.get(pk=1)
        level = Levels.objects.filter(level=2).order_by("?").first()
        self.administration = Administration.objects.filter(
            level=level
        ).order_by("?").first()

    def test_get_user_detail(self):
        user = self.create_user(
            email="user1@test.com",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        response = self.client.get(
            f"/api/v1/user/{user.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check if user data contains the required fields
        self.assertEqual(
            list(user_data),
            [
                "first_name",
                "last_name",
                "email",
                "roles",
                "organisation",
                "trained",
                "phone_number",
                "forms",
                "pending_approval",
                "data",
                "pending_batch",
                "is_superuser",
            ],
        )

        # Check user data matches the user
        self.assertEqual(user_data["email"], user.email)

    def test_get_user_detail_by_non_superuser_same_adm_level(self):
        user = self.create_user(
            email="admin.level2@test.com",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        user.set_password("password")
        user.save()

        # Add another user with same administration level
        another_user = self.create_user(
            email="other.admin.level2@test",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )

        token = self.get_auth_token(user.email, "password")
        response = self.client.get(
            f"/api/v1/user/{another_user.id}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()

        # Check roles
        self.assertEqual(
            user_data["roles"][0]["administration"],
            self.administration.id
        )

    def test_get_user_detail_by_non_superuser_lower_adm_level(self):
        user = self.create_user(
            email="admin.level2@test.com",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        user.set_password("password")
        user.save()

        # Add another user with lower administration level
        child_adm = self.administration.parent_administration\
            .order_by("?").first()
        another_user = self.create_user(
            email="other.admin.level3@test",
            role_level=self.IS_ADMIN,
            administration=child_adm,
            form=self.form,
        )

        token = self.get_auth_token(user.email, "password")
        response = self.client.get(
            f"/api/v1/user/{another_user.id}",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()

        # Check roles
        self.assertEqual(
            user_data["roles"][0]["administration"],
            child_adm.id
        )
        # adm_path should be the parent's path
        self.assertCountEqual(
            user_data["roles"][0]["adm_path"],
            [
                a.id
                for a in child_adm.ancestors
            ] + [child_adm.id]
        )

    def test_get_user_detail_unauthenticated(self):
        user = self.create_user(
            email="user1@test.com",
            role_level=self.IS_ADMIN,
            administration=self.administration,
            form=self.form,
        )
        response = self.client.get(
            f"/api/v1/users/{user.id}", content_type="application/json"
        )
        self.assertEqual(response.status_code, 401)
        self.assertIn("detail", response.json())
        self.assertEqual(
            response.json()["detail"],
            "Authentication credentials were not provided."
        )
