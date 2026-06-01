"""
TDD: Draft detail API — scope-based access control

Feature: supervisors with submit access at the same or higher
administration can GET a draft submission within their scope,
not just the creator.

Scenarios:
  1. Creator can always GET their own draft
  2. Supervisor (level 2) can GET a draft submitted at level 3
  3. User outside scope gets 403
  4. Supervisor can GET a root-level draft via creator's role scope
"""
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from rest_framework import status

from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


def _draft(form, created_by, administration, name="Draft"):
    return FormData.objects.create(
        name=name,
        form=form,
        created_by=created_by,
        administration=administration,
        geo=[7.2088, 126.8456],
        is_pending=False,
        is_draft=True,
    )


@override_settings(USE_TZ=False, TEST_ENV=True)
class DraftDetailScopeTestCase(TestCase, ProfileTestHelperMixin):
    """
    Hierarchy (resolved dynamically):
      level 0: root_adm
        level 1: level1_adm
          level 2: level2_adm  <- supervisor's administration
            level 3: level3_adm  <- submitter's administration
          level 2: sibling_adm   <- outside scope
    """

    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test")

        self.form = Forms.objects.get(pk=1)

        self.level2_adm = (
            Administration.objects
            .filter(level__level=2)
            .filter(parent_administration__level__level=3)
            .order_by("id")
            .first()
        )
        self.level1_adm = self.level2_adm.parent
        self.root_adm = self.level1_adm.parent
        self.level3_adm = (
            Administration.objects
            .filter(level__level=3, parent=self.level2_adm)
            .order_by("id")
            .first()
        )
        self.sibling_adm = (
            Administration.objects
            .filter(level__level=2)
            .exclude(parent=self.level1_adm)
            .order_by("id")
            .first()
        )

        self.submitter = self.create_user(
            email="submitter.detscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level3_adm,
            form=self.form,
        )
        self.submitter.set_password("test")
        self.submitter.save()
        self.submitter_token = self.get_auth_token(
            self.submitter.email, "test"
        )

        self.supervisor = self.create_user(
            email="supervisor.detscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level2_adm,
            form=self.form,
        )
        self.supervisor.set_password("test")
        self.supervisor.save()
        self.supervisor_token = self.get_auth_token(
            self.supervisor.email, "test"
        )

        self.sibling_user = self.create_user(
            email="sibling.detscope@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.sibling_adm,
            form=self.form,
        )
        self.sibling_user.set_password("test")
        self.sibling_user.save()
        self.sibling_token = self.get_auth_token(
            self.sibling_user.email, "test"
        )

        self.draft = _draft(
            self.form, self.submitter, self.level3_adm,
            "In-scope draft"
        )

    def _get(self, token, draft_id):
        return self.client.get(
            f"/api/v1/draft-submission/{draft_id}/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

    # --- Scenario 1: Creator can GET own draft ---

    def test_creator_can_get_own_draft(self):
        response = self._get(self.submitter_token, self.draft.id)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    # --- Scenario 2: Supervisor can GET draft within scope ---

    def test_supervisor_can_get_in_scope_draft(self):
        response = self._get(self.supervisor_token, self.draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_200_OK,
            f"Supervisor should access in-scope draft: {response.json()}"
        )

    # --- Scenario 3: User outside scope gets 404 (draft invisible) ---

    def test_out_of_scope_user_cannot_get_draft(self):
        response = self._get(self.sibling_token, self.draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_404_NOT_FOUND,
            "Draft outside scope should appear not found"
        )

    # --- Scenario 4: Supervisor can GET root-level draft via creator scope ---

    def test_supervisor_can_get_root_draft_via_creator_scope(self):
        root_draft = _draft(
            self.form, self.submitter, self.root_adm,
            "Root-level draft"
        )
        response = self._get(self.supervisor_token, root_draft.id)
        self.assertEqual(
            response.status_code, status.HTTP_200_OK,
            f"Supervisor should access root draft via creator scope: "
            f"{response.json()}"
        )
