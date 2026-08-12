from django.db import migrations


# The four dashboard materialized views exclude pending and draft submissions
# but not deleted ones, so every soft-deleted datapoint keeps feeding the
# dashboards. `data` carries a `deleted_at` timestamp
# (utils.soft_deletes_model) which the default `FormData.objects` manager
# filters on — so a datapoint deleted in the UI disappears everywhere except
# the visualizations built on these views.
#
# That overstates counts and compliance denominators, and through
# mv_latest_monitoring it can make a site's "latest" answers come from a
# submission somebody deleted.
#
# Both variants below are generated from one source so they cannot drift: the
# only difference is the deleted_at predicates, and `reverse` restores the
# 0002 definitions exactly.


def _sql(exclude_deleted):
    """Build the four view definitions, with or without the deleted filter."""
    # Applied to a monitoring row and to its parent registration: deleting a
    # site must retire its monitoring history from the dashboards too.
    mon = "\n        AND d.deleted_at IS NULL" if exclude_deleted else ""
    par = "\n        AND parent.deleted_at IS NULL" if exclude_deleted else ""
    # mv_parent_aggregates and mv_answer_denormalized did not join the parent
    # at all; they only need it to see whether the parent is deleted.
    agg_join = (
        "\n    INNER JOIN data parent ON parent.id = d.parent_id"
        if exclude_deleted
        else ""
    )
    ans_join = (
        "\nLEFT JOIN data parent ON parent.id = d.parent_id"
        if exclude_deleted
        else ""
    )
    ans_where = (
        "\n    AND d.deleted_at IS NULL"
        "\n    AND (d.parent_id IS NULL OR parent.deleted_at IS NULL)"
        if exclude_deleted
        else ""
    )

    return f"""
CREATE MATERIALIZED VIEW mv_latest_monitoring AS
SELECT DISTINCT ON (d.parent_id, d.form_id)
    d.id AS latest_data_id,
    d.parent_id,
    d.form_id,
    f.name AS form_name,
    d.administration_id,
    d.created,
    d.name AS data_name,
    parent.name AS parent_name,
    parent.administration_id AS parent_administration_id
FROM data d
INNER JOIN data parent ON parent.id = d.parent_id
INNER JOIN form f ON f.id = d.form_id
WHERE d.parent_id IS NOT NULL
    AND d.is_pending = FALSE AND d.is_draft = FALSE
    AND parent.is_pending = FALSE AND parent.is_draft = FALSE{mon}{par}
ORDER BY d.parent_id, d.form_id, d.created DESC;

CREATE UNIQUE INDEX idx_mv_latest_pk
    ON mv_latest_monitoring (parent_id, form_id);
CREATE INDEX idx_mv_latest_form
    ON mv_latest_monitoring (form_id);
CREATE INDEX idx_mv_latest_admin
    ON mv_latest_monitoring (administration_id);
CREATE INDEX idx_mv_latest_parent_admin
    ON mv_latest_monitoring (parent_administration_id);

CREATE MATERIALIZED VIEW mv_answer_denormalized AS
SELECT
    a.id AS answer_id,
    a.data_id,
    a.question_id,
    q.name AS question_name,
    q.type AS question_type,
    a.name AS answer_name,
    a.value AS answer_value,
    a.options AS answer_options,
    a.index AS answer_index,
    d.form_id,
    d.parent_id,
    d.administration_id,
    d.created AS data_created
FROM answer a
INNER JOIN data d ON d.id = a.data_id
INNER JOIN question q ON q.id = a.question_id{ans_join}
WHERE d.is_pending = FALSE AND d.is_draft = FALSE{ans_where};

CREATE UNIQUE INDEX idx_mv_answer_pk
    ON mv_answer_denormalized (answer_id);
CREATE INDEX idx_mv_answer_data
    ON mv_answer_denormalized (data_id);
CREATE INDEX idx_mv_answer_question
    ON mv_answer_denormalized (question_id);
CREATE INDEX idx_mv_answer_form_question
    ON mv_answer_denormalized (form_id, question_id);
CREATE INDEX idx_mv_answer_parent
    ON mv_answer_denormalized (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_mv_answer_question_name
    ON mv_answer_denormalized (question_name);
CREATE INDEX idx_mv_answer_options
    ON mv_answer_denormalized USING GIN (answer_options);

CREATE MATERIALIZED VIEW mv_cross_form_latest AS
WITH all_monitoring AS (
    SELECT
        d.id AS data_id,
        d.parent_id,
        parent.form_id AS parent_form_id,
        d.form_id,
        d.administration_id,
        d.created
    FROM data d
    INNER JOIN data parent ON parent.id = d.parent_id
    WHERE d.parent_id IS NOT NULL
        AND d.is_pending = FALSE
        AND d.is_draft = FALSE
        AND parent.is_pending = FALSE
        AND parent.is_draft = FALSE{mon}{par}
),
answers_with_meta AS (
    SELECT
        m.parent_id,
        m.parent_form_id,
        m.administration_id,
        m.created AS data_created,
        a.question_id,
        q.name AS question_name,
        q.type AS question_type,
        a.name AS answer_name,
        a.value AS answer_value,
        a.options AS answer_options,
        ROW_NUMBER() OVER (
            PARTITION BY m.parent_id, q.name
            ORDER BY m.created DESC,
                     COALESCE(a.updated, m.created) DESC,
                     m.data_id DESC, a.id DESC
        ) AS rn
    FROM all_monitoring m
    INNER JOIN answer a ON a.data_id = m.data_id
    INNER JOIN question q ON q.id = a.question_id
)
SELECT
    row_number() OVER () AS id,
    parent_id,
    parent_form_id,
    administration_id,
    question_name,
    question_type,
    answer_name AS latest_text_value,
    answer_value AS latest_numeric_value,
    answer_options AS latest_option_values,
    data_created AS latest_created
FROM answers_with_meta
WHERE rn = 1;

CREATE UNIQUE INDEX idx_mv_cross_form_pk
    ON mv_cross_form_latest (id);
CREATE INDEX idx_mv_cross_form_parent_qname
    ON mv_cross_form_latest (parent_id, question_name);
CREATE INDEX idx_mv_cross_form_parent_form_qname
    ON mv_cross_form_latest (parent_form_id, question_name);
CREATE INDEX idx_mv_cross_form_qname
    ON mv_cross_form_latest (question_name);
CREATE INDEX idx_mv_cross_form_admin
    ON mv_cross_form_latest (administration_id);

CREATE MATERIALIZED VIEW mv_parent_aggregates AS
WITH latest AS (
    SELECT DISTINCT ON (d.parent_id, d.form_id)
        d.id AS data_id,
        d.parent_id,
        d.form_id,
        d.administration_id
    FROM data d{agg_join}
    WHERE d.parent_id IS NOT NULL
        AND d.is_pending = FALSE
        AND d.is_draft = FALSE{mon}{par}
    ORDER BY d.parent_id, d.form_id, d.created DESC
)
SELECT
    row_number() OVER () AS id,
    l.parent_id,
    l.form_id,
    l.administration_id,
    a.question_id,
    q.name AS question_name,
    q.type AS question_type,
    CASE WHEN q.type IN (5, 6) THEN
        jsonb_agg(DISTINCT opt.value) FILTER (WHERE opt.value IS NOT NULL)
    END AS option_values,
    CASE WHEN q.type = 4 THEN AVG(a.value) END AS avg_value,
    CASE WHEN q.type = 4 THEN SUM(a.value) END AS sum_value,
    CASE WHEN q.type = 4 THEN MAX(a.value) END AS max_value,
    CASE WHEN q.type = 4 THEN MIN(a.value) END AS min_value,
    COUNT(*) AS answer_count
FROM latest l
INNER JOIN answer a ON a.data_id = l.data_id
INNER JOIN question q ON q.id = a.question_id
LEFT JOIN LATERAL jsonb_array_elements_text(a.options) AS opt(value)
    ON q.type IN (5, 6)
GROUP BY l.parent_id, l.form_id, l.administration_id,
         a.question_id, q.name, q.type;

CREATE UNIQUE INDEX idx_mv_parent_agg_pk
    ON mv_parent_aggregates (id);
CREATE INDEX idx_mv_parent_agg_form_question
    ON mv_parent_aggregates (form_id, question_id);
CREATE INDEX idx_mv_parent_agg_parent
    ON mv_parent_aggregates (parent_id);
CREATE INDEX idx_mv_parent_agg_admin
    ON mv_parent_aggregates (administration_id);
CREATE INDEX idx_mv_parent_agg_question_name
    ON mv_parent_aggregates (question_name);
"""


DROP_ALL = """
DROP MATERIALIZED VIEW IF EXISTS mv_latest_monitoring CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_answer_denormalized CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_cross_form_latest CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_parent_aggregates CASCADE;
"""


class Migration(migrations.Migration):

    dependencies = [
        ('v1_visualization', '0002_add_optimized_materialized_views'),
    ]

    operations = [
        migrations.RunSQL(
            sql=DROP_ALL + _sql(exclude_deleted=True),
            reverse_sql=DROP_ALL + _sql(exclude_deleted=False),
        ),
    ]
