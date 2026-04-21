from django.conf import settings
from django.core.cache import cache
from django.db.models.signals import post_delete, post_save


from api.v1.v1_forms.models import (
    Forms,
    QuestionGroup,
    QuestionOptions,
    Questions,
)


# Cache keys for /api/v1/form/web/{id}/ and /api/v1/form/{id}/ are populated
# lazily by views in v1_forms.views. When the underlying form structure
# mutates we must evict those entries or readers will serve stale schemas
# until the date-prefixed key naturally rolls over at midnight.
#
# All users of the default cache today are form-related (get_cache/create_cache
# in v1_data.functions), so clearing the cache is scoped in practice. Revisit
# if unrelated callers start sharing the default cache.
def _invalidate_form_cache(sender, instance, **kwargs):
    if getattr(settings, "TEST_ENV", False):
        return
    cache.clear()


def register() -> None:
    """
    Connect cache-invalidation receivers.
    Called from V1FormsConfig.ready.
    """
    for model in (Forms, QuestionGroup, Questions, QuestionOptions):
        post_save.connect(_invalidate_form_cache, sender=model)
        post_delete.connect(_invalidate_form_cache, sender=model)
