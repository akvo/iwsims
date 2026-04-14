from django.db import migrations


class Migration(migrations.Migration):
    """Indexes that accelerate the visualization dashboards.

    1. idx_data_latest_monitoring — partial index covering the filter
       used by `latest_monitoring_subquery` (one lookup per parent
       row), making it an index-only scan.

    2. idx_answer_data_question — composite index for the
       (data_id, question_id) filter used by every escalation column
       lookup, progress formula read, and value aggregation.
    """

    atomic = False  # CREATE INDEX CONCURRENTLY can't run in a txn

    dependencies = [
        ("v1_data", "0002_formdata_is_draft"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
                "idx_data_latest_monitoring "
                "ON data (form_id, parent_id, created DESC) "
                "WHERE is_pending = FALSE AND is_draft = FALSE;"
            ),
            reverse_sql=(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "idx_data_latest_monitoring;"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
                "idx_answer_data_question "
                "ON answer (data_id, question_id);"
            ),
            reverse_sql=(
                "DROP INDEX CONCURRENTLY IF EXISTS "
                "idx_answer_data_question;"
            ),
        ),
    ]
