import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Alert, Card, Empty, Skeleton, Typography } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import { DETAIL_URL_TEMPLATE } from "../constants";

const { Text } = Typography;

/**
 * Build the control-center detail URL for a ranked row. The row's `group`
 * (from group_by:parent_id) is the parent datapoint id used as {data_id};
 * {parent_form_id} comes from the dashboard's parentFormId (or api.form_id).
 * Returns null when either id is missing, so the label stays plain text.
 */
const buildDetailHref = (item, formId, dataId) => {
  if (
    !formId ||
    dataId === null ||
    typeof dataId === "undefined" ||
    dataId === ""
  ) {
    return null;
  }
  const template = item.click_url_template || DETAIL_URL_TEMPLATE;
  return template
    .replace("{parent_form_id}", formId)
    .replace("{data_id}", dataId);
};

const stripRankingFields = (api = {}) => {
  const next = { ...api, group_by: "parent_id" };
  delete next.sort;
  delete next.limit;
  return next;
};

const toTimestamp = (value) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

const formatDate = (value) => {
  const time = toTimestamp(value);
  if (time === null) {
    return "No date";
  }
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(time));
};

/** Humanize a snake_case question_name, e.g. "date_of_inspection" -> "Date of inspection". */
const humanizeQuestionName = (name) =>
  String(name || "")
    .replace(/_/g, " ")
    .replace(/^./, (char) => char.toUpperCase());

/**
 * Label for which date each row shows. Explicit `item.date_label` wins;
 * otherwise derive it from the ranking question_name. Null when neither exists.
 */
const resolveDateLabel = (item) => {
  if (item.date_label) {
    return item.date_label;
  }
  const qname = item.api?.question_name;
  return qname ? humanizeQuestionName(qname) : null;
};

export const rankRows = (rows, sort = "desc", limit = 8) => {
  const direction = String(sort).toLowerCase() === "asc" ? "asc" : "desc";
  const maxRows = Number.isFinite(Number(limit)) ? Number(limit) : 8;
  return [...(rows || [])]
    .map((row) => ({
      ...row,
      timestamp: toTimestamp(row.value),
    }))
    .sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) {
        return String(a.label || "").localeCompare(String(b.label || ""));
      }
      if (a.timestamp === null) {
        return 1;
      }
      if (b.timestamp === null) {
        return -1;
      }
      return direction === "asc"
        ? a.timestamp - b.timestamp
        : b.timestamp - a.timestamp;
    })
    .slice(0, maxRows);
};

const RankingWidget = ({
  item,
  filterState,
  today,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
}) => {
  const apiForFetch = useMemo(
    () => (item.api ? stripRankingFields(item.api) : null),
    [item.api]
  );

  const { data, loading, error } = useDashboardValues(
    apiForFetch,
    filterState,
    {
      today,
      fiscalYearStartMonth,
      customFilterDefs,
      parentFormId,
      enabled: Boolean(apiForFetch),
    }
  );

  const rows = useMemo(
    () => rankRows(data?.data || [], item.api?.sort, item.api?.limit),
    [data, item.api]
  );

  const detailFormId = parentFormId || item.api?.form_id;
  const dateLabel = resolveDateLabel(item);

  return (
    <Card
      title={item.label}
      size="small"
      style={{ marginBottom: 0 }}
      data-testid={`ranking-widget-${item.id}`}
      extra={
        dateLabel ? (
          <Text type="secondary" style={{ fontWeight: "normal" }}>
            {dateLabel}
          </Text>
        ) : null
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {rows.map((row, index) => {
            const label = row.label || row.group;
            const href = buildDetailHref(item, detailFormId, row.group);
            return (
              <li
                key={`${row.label}-${index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr",
                  columnGap: 12,
                  padding: "8px 0",
                  borderBottom:
                    index === rows.length - 1 ? "none" : "1px solid #f0f0f0",
                }}
              >
                <Text strong>{index + 1}</Text>
                <div>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {label}
                    </a>
                  ) : (
                    <Text>{label}</Text>
                  )}
                  <br />
                  <Text type="secondary">{formatDate(row.value)}</Text>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message={error.message || "Failed to load ranking"}
        />
      )}
    </Card>
  );
};

RankingWidget.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  today: PropTypes.instanceOf(Date),
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

export default RankingWidget;
