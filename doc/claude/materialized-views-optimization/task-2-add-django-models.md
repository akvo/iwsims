# Task 2: Add Django Models for Materialized Views

## Overview

Add unmanaged Django models that map to the materialized views created in Task 1. These models allow Django ORM queries against the MVs.

## File to Modify

**Path**: `backend/api/v1/v1_visualization/models.py`

## Current State

The file currently has only `ViewDataOptions` model.

## Changes

Append the following 4 model classes to the end of `models.py`:

```python
class MVLatestMonitoring(models.Model):
    """Pre-computed latest monitoring submission per parent/form.

    Eliminates the expensive correlated subquery in latest_monitoring_subquery().
    Use instead of annotating with Subquery for latest monitoring lookups.
    """
    latest_data_id = models.BigIntegerField(primary_key=True)
    parent_id = models.BigIntegerField()
    form_id = models.BigIntegerField()
    form_name = models.TextField()
    administration_id = models.BigIntegerField()
    parent_administration_id = models.BigIntegerField()
    created = models.DateTimeField()
    data_name = models.TextField()
    parent_name = models.TextField()

    class Meta:
        managed = False
        db_table = 'mv_latest_monitoring'


class MVAnswerDenormalized(models.Model):
    """Pre-joined answers with data and question metadata.

    Includes question_name for cross-form queries by column identifier.
    """
    answer_id = models.BigIntegerField(primary_key=True)
    data_id = models.BigIntegerField()
    question_id = models.BigIntegerField()
    question_name = models.TextField()
    question_type = models.IntegerField()
    answer_name = models.TextField(null=True)
    answer_value = models.FloatField(null=True)
    answer_options = models.JSONField(null=True)
    answer_index = models.IntegerField(default=0)
    form_id = models.BigIntegerField()
    parent_id = models.BigIntegerField(null=True)
    administration_id = models.BigIntegerField()
    data_created = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'mv_answer_denormalized'


class MVCrossFormLatest(models.Model):
    """Cross-form latest values aggregated by question_name.

    Key feature: Returns the latest value for each (parent_id, question_name)
    across ALL monitoring forms. Enables queries like "latest pH" without
    knowing which specific form contains the answer.

    Example: If parent_id=100 has Quick Monitoring (ph=7.2, June 1) and
    Comprehensive Monitoring (ph=7.5, June 10), querying question_name='ph'
    returns 7.5 (the most recent).
    """
    id = models.BigIntegerField(primary_key=True)
    parent_id = models.BigIntegerField()
    administration_id = models.BigIntegerField()
    question_name = models.TextField()
    question_type = models.IntegerField()
    latest_text_value = models.TextField(null=True)
    latest_numeric_value = models.FloatField(null=True)
    latest_option_values = models.JSONField(null=True)
    latest_created = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'mv_cross_form_latest'


class MVParentAggregates(models.Model):
    """Pre-aggregated answer data per parent/form/question.

    For option questions (type 5, 6): option_values contains all selected values.
    For number questions (type 4): avg/sum/max/min_value contain aggregates.

    Used by _stack_option_by_parent() to avoid N+1 queries.
    """
    id = models.BigIntegerField(primary_key=True)
    parent_id = models.BigIntegerField()
    form_id = models.BigIntegerField()
    administration_id = models.BigIntegerField()
    question_id = models.BigIntegerField()
    question_name = models.TextField()
    question_type = models.IntegerField()
    option_values = models.JSONField(null=True)
    avg_value = models.FloatField(null=True)
    sum_value = models.FloatField(null=True)
    max_value = models.FloatField(null=True)
    min_value = models.FloatField(null=True)
    answer_count = models.IntegerField()

    class Meta:
        managed = False
        db_table = 'mv_parent_aggregates'
```

## Full Updated File

After adding the models, `models.py` should look like:

```python
from django.db import models

from api.v1.v1_forms.models import Forms
from api.v1.v1_data.models import FormData
from api.v1.v1_profile.models import Administration


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


class MVLatestMonitoring(models.Model):
    """Pre-computed latest monitoring submission per parent/form."""
    latest_data_id = models.BigIntegerField(primary_key=True)
    parent_id = models.BigIntegerField()
    form_id = models.BigIntegerField()
    form_name = models.TextField()
    administration_id = models.BigIntegerField()
    parent_administration_id = models.BigIntegerField()
    created = models.DateTimeField()
    data_name = models.TextField()
    parent_name = models.TextField()

    class Meta:
        managed = False
        db_table = 'mv_latest_monitoring'


class MVAnswerDenormalized(models.Model):
    """Pre-joined answers with data and question metadata."""
    answer_id = models.BigIntegerField(primary_key=True)
    data_id = models.BigIntegerField()
    question_id = models.BigIntegerField()
    question_name = models.TextField()
    question_type = models.IntegerField()
    answer_name = models.TextField(null=True)
    answer_value = models.FloatField(null=True)
    answer_options = models.JSONField(null=True)
    answer_index = models.IntegerField(default=0)
    form_id = models.BigIntegerField()
    parent_id = models.BigIntegerField(null=True)
    administration_id = models.BigIntegerField()
    data_created = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'mv_answer_denormalized'


class MVCrossFormLatest(models.Model):
    """Cross-form latest values aggregated by question_name."""
    id = models.BigIntegerField(primary_key=True)
    parent_id = models.BigIntegerField()
    administration_id = models.BigIntegerField()
    question_name = models.TextField()
    question_type = models.IntegerField()
    latest_text_value = models.TextField(null=True)
    latest_numeric_value = models.FloatField(null=True)
    latest_option_values = models.JSONField(null=True)
    latest_created = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'mv_cross_form_latest'


class MVParentAggregates(models.Model):
    """Pre-aggregated answer data per parent/form/question."""
    id = models.BigIntegerField(primary_key=True)
    parent_id = models.BigIntegerField()
    form_id = models.BigIntegerField()
    administration_id = models.BigIntegerField()
    question_id = models.BigIntegerField()
    question_name = models.TextField()
    question_type = models.IntegerField()
    option_values = models.JSONField(null=True)
    avg_value = models.FloatField(null=True)
    sum_value = models.FloatField(null=True)
    max_value = models.FloatField(null=True)
    min_value = models.FloatField(null=True)
    answer_count = models.IntegerField()

    class Meta:
        managed = False
        db_table = 'mv_parent_aggregates'
```

## Key Points

1. **`managed = False`**: Django won't create/alter these tables - they're managed by the migration SQL
2. **Primary keys**: Each model has a suitable primary key field for ORM operations
3. **No ForeignKey relations**: These are read-only views; we use raw integer IDs instead of FK relationships to avoid join overhead
4. **Nullable fields**: Match the SQL view's NULL-ability

## Verification

```bash
# Check models are valid
./dc.sh exec backend python manage.py check

# Test ORM access (after running Task 1 migration)
./dc.sh exec backend python manage.py shell
```

```python
from api.v1.v1_visualization.models import (
    MVLatestMonitoring,
    MVAnswerDenormalized,
    MVCrossFormLatest,
    MVParentAggregates,
)

# Should return counts
print(MVLatestMonitoring.objects.count())
print(MVAnswerDenormalized.objects.count())
print(MVCrossFormLatest.objects.count())
print(MVParentAggregates.objects.count())
```

## Dependencies

- Requires Task 1 (migration) to be completed first
