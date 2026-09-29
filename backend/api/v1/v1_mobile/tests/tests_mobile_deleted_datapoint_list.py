from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Forms
from api.v1.v1_mobile.models import MobileAssignment
from api.v1.v1_profile.models import Administration
from api.v1.v1_profile.tests.mixins import ProfileTestHelperMixin


class MobileDeletedDatapointListTestCase(TestCase, ProfileTestHelperMixin):
    def setUp(self):
        call_command("administration_seeder", "--test")
        call_command("form_seeder", "--test")
        call_command("default_roles_seeder", "--test", 1)

        self.root = Administration.objects.filter(
            parent__isnull=True
        ).first()
        self.forms = Forms.objects.filter(parent__isnull=True).all()
        self.form = self.forms[0]
        self.user = self.create_user(
            email="test@test.org",
            role_level=self.IS_ADMIN,
            administration=self.root,
        )
        self.passcode = "passcode1234"
        MobileAssignment.objects.create_assignment(
            user=self.user, name="test", passcode=self.passcode
        )
        self.assignment = MobileAssignment.objects.get(user=self.user)
        # Scope = the root's children; rows on the root itself are out of scope
        self.in_scope = self.root.parent_administration.first()
        self.assignment.administrations.add(self.in_scope)
        self.assignment.forms.add(*self.forms)

        response = self.client.post(
            "/api/v1/device/auth",
            {"code": self.passcode},
            content_type="application/json",
        )
        self.token = response.data["syncToken"]

    def _create(self, uuid, administration=None, **kwargs):
        return FormData.objects.create(
            name=uuid,
            form=kwargs.pop("form", self.form),
            administration=administration or self.in_scope,
            created_by=self.user,
            uuid=uuid,
            **kwargs,
        )

    def _get(self, form_id):
        return self.client.get(
            f"/api/v1/device/deleted-datapoints?form_id={form_id}",
            **{"HTTP_AUTHORIZATION": f"Bearer {self.token}"},
        )

    def test_returns_deleted_rows_in_scope_only(self):
        self._create("live")
        self._create("deleted").delete()
        self._create("deleted-pending", is_pending=True).delete()
        self._create("deleted-draft", is_draft=True).delete()
        self._create("out-of-scope", administration=self.root).delete()
        self._create("other-form", form=self.forms[1]).delete()

        response = self._get(self.form.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            sorted(response.json()["uuids"]), ["deleted", "deleted-pending"]
        )

    def test_uuid_with_a_live_row_is_not_reported(self):
        self._create("same-uuid").delete()
        self._create("same-uuid")

        response = self._get(self.form.id)

        self.assertEqual(response.json()["uuids"], [])

    def test_last_synced_at_is_the_cut_off_and_is_not_changed(self):
        old = self._create("deleted-before-sync")
        old.delete()
        FormData.objects_deleted.filter(pk=old.pk).update(
            deleted_at=timezone.now() - timedelta(days=1)
        )
        self._create("deleted-after-sync").delete()
        synced_at = timezone.now() - timedelta(hours=1)
        self.assignment.last_synced_at = synced_at
        self.assignment.save()

        response = self._get(self.form.id)

        self.assertEqual(response.json()["uuids"], ["deleted-after-sync"])
        self.assignment.refresh_from_db()
        self.assertEqual(self.assignment.last_synced_at, synced_at)

    def test_unknown_or_missing_form_is_404(self):
        child = Forms.objects.filter(parent__isnull=False).first()
        for form_id in ["", "abc", "999999", child.id if child else ""]:
            response = self._get(form_id)
            self.assertEqual(
                response.status_code, status.HTTP_404_NOT_FOUND, form_id
            )
