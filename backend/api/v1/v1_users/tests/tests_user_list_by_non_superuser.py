from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from django.db.models import Q, Count
from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import (
    Administration,
    UserRole,
)
from api.v1.v1_users.models import Organisation
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


@override_settings(USE_TZ=False, TEST_ENV=True)
class UserListByNonSuperUserTestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        call_command("administration_seeder", "--test", 1)
        call_command("default_roles_seeder", "--test", 1)
        call_command("fake_organisation_seeder")
        call_command("form_seeder", "--test")

        self.adm = Administration.objects.filter(
            level__level=3
        ).order_by("id").first()
        self.form = Forms.objects.get(pk=1)
        self.org = Organisation.objects.first()

        self.user = self.create_user(
            email="nonsuper@akvo.org",
            role_level=self.IS_ADMIN,
            administration=self.adm,
            form=self.form,
        )

        self.user.set_password("password")
        self.user.save()

        self.token = self.get_auth_token(self.user.email, "password")

        # seed subordinate users
        for child_adm in self.adm.parent_administration.all():
            self.create_user(
                email=f"child_{child_adm.id}@test.com",
                role_level=self.IS_ADMIN,
                administration=child_adm,
                form=self.form,
            )
        # seed users with same admin level
        self.create_user(
            email="same_admin@test.com",
            role_level=self.IS_ADMIN,
            administration=self.adm,
            form=self.form,
        )

    def test_valid_user_list_by_non_superuser(self):
        response = self.client.get(
            "/api/v1/users",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check pagination structure
        self.assertIn("current", user_data)
        self.assertIn("total", user_data)
        self.assertIn("total_page", user_data)
        self.assertIn("data", user_data)

        total_adm_children = self.adm.parent_administration.count()

        self.assertEqual(
            user_data["total"], total_adm_children + 2
        )

    def test_user_list_by_non_superuser_not_includes_superuser(self):
        # Create a superuser
        superuser = self.create_user(
            email="super@akvo.org",
            role_level=self.IS_SUPER_ADMIN,
        )

        response = self.client.get(
            "/api/v1/users",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check that the superuser is not in the list
        self.assertNotIn(
            superuser.email,
            [user['email'] for user in user_data['data']]
        )

    def test_user_list_by_non_superuser_filter_by_lower_adm_level(self):
        child_adm = self.adm.parent_administration.first()
        response = self.client.get(
            f"/api/v1/users?administration={child_adm.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check that only users from the child administration are returned
        users = child_adm.user_role_administration.all()
        self.assertEqual(user_data["total"], users.count())
        for user in user_data['data']:
            self.assertIn(user['email'], [u.user.email for u in users])

    def test_user_list_by_non_superuser_filter_by_same_adm_level(self):
        same_adm = self.adm
        response = self.client.get(
            f"/api/v1/users?administration={same_adm.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check that only users from the same administration are returned
        users = same_adm.user_role_administration.all()
        total_adm_children = same_adm.parent_administration.count()
        self.assertEqual(
            user_data["total"],
            users.count() + total_adm_children
        )

    def test_user_list_by_non_superuser_filter_by_higher_and_diff_path(self):
        parent_adm = self.adm.ancestors.last()
        higher_adm = Administration.objects.filter(
            level=parent_adm.level,
        ).exclude(
            pk=parent_adm.id
        ).first()
        response = self.client.get(
            f"/api/v1/users?administration={higher_adm.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        self.assertEqual(user_data["total"], 0)
        self.assertEqual(user_data["data"], [])

    def test_user_list_by_non_superuser_filtered_adm_by_default(self):
        # Create a user with different administration
        parent_adm = self.adm.ancestors.last()
        higher_adm = Administration.objects.filter(
            level=parent_adm.level,
        ).exclude(
            pk=parent_adm.id
        ).first()

        other_users = []
        child_u = self.create_user(
            email="high.adm@test.com",
            role_level=self.IS_ADMIN,
            administration=higher_adm,
            form=self.form,
        )
        other_users.append(child_u)

        for child_adm in higher_adm.parent_administration.all():
            child_u = self.create_user(
                email=f"other.{child_adm.id}@test.com",
                role_level=self.IS_ADMIN,
                administration=child_adm,
                form=self.form,
            )
            other_users.append(child_u)

        # Test that the default administration is used
        # when no filter is applied
        response = self.client.get(
            "/api/v1/users",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check that the total matches
        # the number of users in the default administration
        adms = Administration.objects.filter(
            Q(id=self.adm.id) |
            Q(path__startswith=f"{self.adm.path}{self.adm.id}.")
        )
        total_users = adms.aggregate(
            total=Count('user_role_administration')
        )['total']
        self.assertEqual(user_data["total"], total_users)
        # Make sure the other users are not included
        for user in user_data['data']:
            self.assertNotIn(
                user['email'],
                [u.email for u in other_users]
            )

    def test_user_list_by_multiple_user_roles(self):
        [adm_1, adm_2] = Administration.objects.filter(
            level__level=1
        ).order_by("?").all()[:2]
        # Create a new administration level 1
        adm_3 = Administration.objects.create(
            name="Jawa Tengah",
            code="ID-JTG",
            level=adm_1.level,
            path=f"{adm_1.path}",
        )
        adm_3_child = Administration.objects.create(
            parent=adm_3,
            name="Semarang",
            code="ID-JTG-SMG",
            level_id=adm_3.level.id + 1,
            path=f"{adm_3.path}{adm_3.id}.",
        )
        # Create a user with multiple roles
        multi_role_user = self.create_user(
            email="multi.role@test.com",
            role_level=self.IS_ADMIN,
            administration=adm_1,
            form=self.form,
        )
        multi_role_user.set_password("password")
        multi_role_user.save()

        # Assign the user to multiple roles
        role = multi_role_user.user_user_role.first().role
        UserRole.objects.create(
            user=multi_role_user,
            role=role,
            administration=adm_2
        )

        token = self.get_auth_token(
            multi_role_user.email, "password"
        )

        # Create a user outside of user roles's administration
        user_adm_child_3 = self.create_user(
            email="user.semarang@test.com",
            role_level=self.IS_ADMIN,
            administration=adm_3_child,
            form=self.form,
        )

        response = self.client.get(
            "/api/v1/users",
            HTTP_AUTHORIZATION=f"Bearer {token}",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        user_data = response.json()
        # Check that the user with multiple roles is included
        self.assertIn(
            multi_role_user.email,
            [user['email'] for user in user_data['data']]
        )
        # Check that the total matches the number of
        # users in the administrations
        total_users = UserRole.objects.filter(
            Q(administration=adm_1) |
            Q(administration=adm_2) |
            Q(administration__path__startswith=f"{adm_1.path}{adm_1.id}.") |
            Q(administration__path__startswith=f"{adm_2.path}{adm_2.id}.")
        ).values('user').distinct().count()

        self.assertEqual(user_data["total"], total_users)

        # Check that the user outside of user roles's
        # administration is not included
        self.assertNotIn(
            user_adm_child_3.email,
            [user['email'] for user in user_data['data']]
        )
