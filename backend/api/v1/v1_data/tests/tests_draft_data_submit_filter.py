"""
TDD: Draft data list — submit-role scope filter

Feature: users with submit access at the same or higher administration level
can see draft submissions within their scope, in addition to their own drafts.

Scenarios covered:
  1. Submitter with submit role at level 2 sees their OWN drafts
  2. Submitter at level 2 sees drafts from a LOWER (descendant) administration
  3. Submitter at level 2 does NOT see drafts from a SIBLING administration
     (same level, different parent)
  4. Upper submitter (level 1) sees drafts across their entire subtree
  5. A user sees ONLY their own drafts when they have no submit-scope role
  6. Creator always sees their own drafts regardless of administration
"""
from django.core.management import call_command
from django.test import TestCase
from django.test.utils import override_settings
from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Forms
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


def _draft(form, created_by, administration, name="Draft Data"):
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
class DraftDataSubmitFilterTestCase(TestCase, ProfileTestHelperMixin):
    """
    Hierarchy structure (resolved dynamically):
      level 1: level1_adm
        level 2: level2_adm  (supervisor's administration)
          level 3: level3_adm  (submitter's administration)
      level 2: sibling_level2  (different parent — out of subtree)
    """

    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)
        call_command("form_seeder", "--test")

        self.form = Forms.objects.get(pk=1)

        # Pick a level-2 admin that has at least one level-3 child
        self.level2_adm = (
            Administration.objects
            .filter(level__level=2)
            .filter(parent_administration__level__level=3)
            .order_by("id")
            .first()
        )
        self.assertIsNotNone(
            self.level2_adm,
            "Need a level-2 admin with level-3 children"
        )
        self.level1_adm = self.level2_adm.parent
        self.level3_adm = (
            Administration.objects
            .filter(level__level=3, parent=self.level2_adm)
            .order_by("id")
            .first()
        )
        self.sibling_level2 = (
            Administration.objects
            .filter(level__level=2)
            .exclude(parent=self.level1_adm)
            .order_by("id")
            .first()
        )
        self.assertIsNotNone(
            self.sibling_level2,
            "Need a sibling level-2 admin"
        )

        # Submitter at level 3 — creates drafts
        self.submitter = self.create_user(
            email="submitter.draft@test.com",
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

        # Supervisor: submit role at level 2 (scope covers level 3)
        self.supervisor = self.create_user(
            email="supervisor.draft@test.com",
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

        # Upper supervisor: submit role at level 1
        self.upper_supervisor = self.create_user(
            email="upper.supervisor.draft@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.level1_adm,
            form=self.form,
        )
        self.upper_supervisor.set_password("test")
        self.upper_supervisor.save()
        self.upper_supervisor_token = self.get_auth_token(
            self.upper_supervisor.email, "test"
        )

        # Submitter at sibling level-2 — outside scope
        self.sibling_submitter = self.create_user(
            email="sibling.submitter.draft@test.com",
            role_level=self.IS_ADMIN,
            password="test",
            administration=self.sibling_level2,
            form=self.form,
        )
        self.sibling_submitter.set_password("test")
        self.sibling_submitter.save()
        self.sibling_submitter_token = self.get_auth_token(
            self.sibling_submitter.email, "test"
        )

        # Drafts
        self.draft_at_level3 = _draft(
            self.form, self.submitter, self.level3_adm,
            "Draft at level3 (in scope)"
        )
        self.draft_at_sibling = _draft(
            self.form, self.sibling_submitter, self.sibling_level2,
            "Draft at sibling level2 (out of scope)"
        )

    def _get_ids(self, token):
        response = self.client.get(
            f"/api/v1/draft-submissions/{self.form.id}/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(
            response.status_code, 200,
            f"Expected 200, got {response.status_code}: {response.json()}"
        )
        return {item["id"] for item in response.json()["data"]}

    # --- Scenario 1: Submitter sees their OWN drafts ---

    def test_submitter_sees_own_drafts(self):
        ids = self._get_ids(self.submitter_token)
        self.assertIn(
            self.draft_at_level3.id, ids,
            "Submitter should see their own drafts"
        )

    # --- Scenario 2: Supervisor sees drafts at descendant administration ---

    def test_supervisor_sees_drafts_at_descendant_administration(self):
        ids = self._get_ids(self.supervisor_token)
        self.assertIn(
            self.draft_at_level3.id, ids,
            "Supervisor should see drafts from level-3 (descendant) admin"
        )

    # --- Scenario 3: Supervisor does NOT see drafts at sibling admin ---

    def test_supervisor_does_not_see_drafts_at_sibling_administration(self):
        ids = self._get_ids(self.supervisor_token)
        self.assertNotIn(
            self.draft_at_sibling.id, ids,
            "Supervisor should NOT see drafts at a sibling administration"
        )

    # --- Scenario 4: Upper supervisor sees entire subtree ---

    def test_upper_supervisor_sees_drafts_across_own_subtree(self):
        ids = self._get_ids(self.upper_supervisor_token)
        self.assertIn(
            self.draft_at_level3.id, ids,
            "Upper supervisor should see drafts at level-3 grandchild admin"
        )
        self.assertNotIn(
            self.draft_at_sibling.id, ids,
            "Upper supervisor should NOT see drafts outside their subtree"
        )

    # --- Scenario 5: Submitter sees only their own + in-scope drafts ---

    def test_submitter_does_not_see_out_of_scope_others_drafts(self):
        ids = self._get_ids(self.submitter_token)
        self.assertNotIn(
            self.draft_at_sibling.id, ids,
            "Submitter should not see drafts from outside their scope"
        )

    # --- Scenario 6: Creator always sees their own draft ---

    def test_creator_sees_own_draft_regardless_of_level(self):
        own_draft = _draft(
            self.form, self.supervisor, self.sibling_level2,
            "Supervisor own draft outside subtree"
        )
        ids = self._get_ids(self.supervisor_token)
        self.assertIn(
            own_draft.id, ids,
            "Supervisor should always see drafts they created"
        )
