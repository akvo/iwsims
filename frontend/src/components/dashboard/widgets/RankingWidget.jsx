import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Alert, Card, Empty, Skeleton, Table, Typography } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import { buildSiteDetailHref } from "../constants";
import FormulaInfo from "./FormulaInfo";

const { Text } = Typography;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/**
 * Whole days between `value` and `today`, or null when the date is unusable.
 * Negative elapsed (a future-dated inspection) is clamped to 0 rather than
 * rendered as "-3 days ago".
 */
const elapsedDays = (value, today) => {
  const time = toTimestamp(value);
  if (time === null) {
    return null;
  }
  const now = today instanceof Date ? today.getTime() : Date.now();
  return Math.max(0, Math.floor((now - time) / MS_PER_DAY));
};

/**
 * Whole calendar months between `value` and `today`. Counted on the calendar
 * rather than as days/30 so "inspected 20 Jul, today 19 Aug" reads as 0 months
 * rather than 1 — the Needs-monitoring list is about overdue-ness, and rounding
 * up would overstate it.
 */
const elapsedMonths = (value, today) => {
  const time = toTimestamp(value);
  if (time === null) {
    return null;
  }
  const then = new Date(time);
  const now = today instanceof Date ? new Date(today.getTime()) : new Date();
  let months =
    (now.getFullYear() - then.getFullYear()) * 12 +
    (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) {
    months -= 1;
  }
  return Math.max(0, months);
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

  // Mirrors the design's ranking tables: entity · last inspected · elapsed.
  // Division is intentionally omitted — it is already carried in the entity
  // label the backend returns ("FLOW-243250955 - Votua WWTP - Western").
  const inMonths = item.elapsed_unit === "months";
  const columns = useMemo(() => {
    const cols = [
      {
        title: item.entity_label || "Name",
        dataIndex: "label",
        key: "label",
        render: (label, row) => {
          const text = label || row.group;
          const href = buildSiteDetailHref(detailFormId, row.group);
          if (!href) {
            return <Text>{text}</Text>;
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {text}
            </a>
          );
        },
      },
      {
        title: dateLabel || "Last inspected",
        dataIndex: "value",
        key: "value",
        width: 130,
        render: (value) => <Text type="secondary">{formatDate(value)}</Text>,
      },
      {
        title: inMonths ? "Months ago" : "Days ago",
        dataIndex: "value",
        key: "elapsed",
        width: 110,
        align: "right",
        render: (value) => {
          const elapsed = inMonths
            ? elapsedMonths(value, today)
            : elapsedDays(value, today);
          return <Text>{elapsed === null ? "—" : elapsed}</Text>;
        },
      },
    ];
    return cols;
  }, [item.entity_label, dateLabel, inMonths, detailFormId, today]);

  return (
    <Card
      title={
        <>
          {item.label}
          <FormulaInfo info={item.info} title={item.label} />
        </>
      }
      size="small"
      style={{ marginBottom: 0 }}
      data-testid={`ranking-widget-${item.id}`}
      extra={
        item.subtitle ? (
          <Text type="secondary" style={{ fontWeight: "normal" }}>
            {item.subtitle}
          </Text>
        ) : null
      }
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          columns={columns}
          dataSource={rows.map((row, index) => ({
            ...row,
            key: `${row.group ?? row.label}-${index}`,
          }))}
          size="small"
          pagination={false}
        />
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
