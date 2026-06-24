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
    parent_form_id = models.BigIntegerField()
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
