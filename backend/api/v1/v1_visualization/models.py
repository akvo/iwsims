from django.db import models

from api.v1.v1_forms.models import Forms
from api.v1.v1_data.models import FormData
from api.v1.v1_profile.models import Administration


def build_admin_full_name_map(admin_ids):
    """Bulk equivalent of ``Administration.full_name`` for many ids.

    The per-instance ``Administration.full_name`` property runs an
    extra query through ``self.ancestors`` per call, which is N+1
    against a queryset of FormData points. This helper does the same
    " - "-joined composition in **two** queries regardless of input
    size and is intended for endpoints that serialise many points at
    once (e.g. the geolocation view).

    Returns ``{admin_id: full_name_string}`` for the requested ids.
    Ids that do not resolve to an Administration row are omitted.
    """
    if not admin_ids:
        return {}
    admins = list(
        Administration.objects.filter(id__in=admin_ids)
        .values("id", "name", "path")
    )
    needed_ids = set(admin_ids)
    for adm in admins:
        if adm["path"]:
            needed_ids.update(
                int(x) for x in adm["path"].split(".") if x
            )
    name_by_id = dict(
        Administration.objects.filter(id__in=needed_ids)
        .values_list("id", "name")
    )
    out = {}
    for adm in admins:
        if adm["path"]:
            ancestor_ids = [
                int(x) for x in adm["path"].split(".") if x
            ]
            ancestor_names = [
                name_by_id[i] for i in ancestor_ids if i in name_by_id
            ]
            out[adm["id"]] = " - ".join(ancestor_names + [adm["name"]])
        else:
            out[adm["id"]] = adm["name"]
    return out


class ViewDataOptions(models.Model):
    id = models.BigIntegerField(primary_key=True)
    parent_data = models.ForeignKey(
        to=FormData,
        on_delete=models.DO_NOTHING,
        related_name="data_view_parent_data_options",
    )
    data = models.ForeignKey(
        to=FormData,
        on_delete=models.DO_NOTHING,
        related_name="data_view_data_options",
    )
    administration = models.ForeignKey(
        to=Administration,
        on_delete=models.PROTECT,
        related_name="administration_view_data_options",
    )
    form = models.ForeignKey(
        to=Forms,
        on_delete=models.DO_NOTHING,
        related_name="form_view_data_options",
    )
    options = models.JSONField(default=None, null=True)

    class Meta:
        managed = False
        db_table = "view_data_options"
