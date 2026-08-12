import React, { useCallback, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Alert, Table, Tag } from "antd";
import { useDashboardEscalation } from "../../util/hooks";
import { uiText, store } from "../../lib";
import {
  daysSince,
  mergeInspectionRows,
  resolveSegmentColumns,
  rollingFromDate,
} from "./compute/mergeInspections";

const EMPTY = "—";

/**
 * One asset's slice of the feed. Renders nothing — it exists so each segment
 * gets its own component instance, and therefore its own hook call, instead of
 * a hook inside a loop.
 */
const SegmentFeed = ({
  item,
  segment,
  filterState,
  customFilterDefs,
  onData,
}) => {
  const dateKeyName = item.date_key || "last_inspected";

  const block = useMemo(
    () => ({
      api: {
        ...segment.api,
        order_by: dateKeyName,
        order_dir: "desc",
        // The window is the table's own, not a filter the user set. A user
        // filter still overrides it inside the hook.
        from_date: rollingFromDate(item.rolling_months),
        date_question_name: segment.questions?.[dateKeyName],
      },
      columns: resolveSegmentColumns(item.columns, segment),
    }),
    [item, segment, dateKeyName]
  );

  const { data, loading, error } = useDashboardEscalation(block, filterState, {
    page: 1,
    pageSize: item.limit || 8,
    customFilterDefs,
  });

  React.useEffect(() => {
    onData(segment.key, {
      segment,
      rows: data?.results || [],
      loading,
      error,
    });
  }, [data, loading, error, onData, segment]);

  return null;
};

SegmentFeed.propTypes = {
  item: PropTypes.object.isRequired,
  segment: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  onData: PropTypes.func.isRequired,
};

/**
 * A chronological inspection feed spanning every asset type.
 *
 * The escalation endpoint is per registration family, so this fans out one
 * request per segment and merges the answers (see `compute/mergeInspections`
 * for why fetching `limit` per segment is exact rather than approximate).
 */
const MergedInspectionsTable = ({ item, filterState, customFilterDefs }) => {
  const [bySegment, setBySegment] = useState({});
  const { active: activeLang } = store.useState((s) => s.language);
  const text = useMemo(() => uiText?.[activeLang] || uiText.en, [activeLang]);

  const onData = useCallback((key, payload) => {
    setBySegment((prev) => {
      const current = prev[key];
      if (
        current &&
        current.loading === payload.loading &&
        current.error === payload.error &&
        current.rows === payload.rows
      ) {
        return prev;
      }
      return { ...prev, [key]: payload };
    });
  }, []);

  const segments = useMemo(() => item.segments || [], [item.segments]);
  const responses = useMemo(
    () => segments.map((s) => bySegment[s.key]).filter(Boolean),
    [segments, bySegment]
  );

  const dateKeyName = item.date_key || "last_inspected";
  const rows = useMemo(
    () => mergeInspectionRows(responses, dateKeyName, item.limit || 8),
    [responses, dateKeyName, item.limit]
  );

  const loading =
    responses.length < segments.length || responses.some((r) => r.loading);
  // One asset failing must not blank the feed — the others are still a valid,
  // if partial, answer. Name the ones that dropped out instead of quietly
  // showing a shorter list.
  const failed = responses
    .filter((r) => r.error)
    .map((r) => r.segment?.label || r.segment?.key);

  const columns = useMemo(
    () =>
      (item.columns || []).map((col) => ({
        key: col.key,
        title: col.title,
        dataIndex: col.key,
        width: col.width,
        render: (_, row) => {
          if (col.render === "asset_tag") {
            return <Tag className="status-pill">{row.__assetLabel}</Tag>;
          }
          if (col.render === "days_since") {
            const days = daysSince(row[dateKeyName]);
            return days === null ? EMPTY : days;
          }
          if (col.render === "date") {
            const value = row[col.key];
            if (!value) {
              return EMPTY;
            }
            return new Intl.DateTimeFormat("en", {
              year: "numeric",
              month: "short",
              day: "numeric",
            }).format(new Date(`${String(value).slice(0, 10)}T00:00:00Z`));
          }
          const value = row[col.key];
          return value === null ||
            typeof value === "undefined" ||
            value === "" ? (
            <span style={{ color: "#bbb" }}>{EMPTY}</span>
          ) : (
            String(value)
          );
        },
      })),
    [item.columns, dateKeyName]
  );

  return (
    <>
      {segments.map((segment) => (
        <SegmentFeed
          key={segment.key}
          item={item}
          segment={segment}
          filterState={filterState}
          customFilterDefs={customFilterDefs}
          onData={onData}
        />
      ))}
      {failed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`${failed.join(
            ", "
          )} could not be loaded; showing the rest.`}
        />
      )}
      <Table
        columns={columns}
        dataSource={rows.map((row, index) => ({
          ...row,
          key: `${row.__segment}-${row.id ?? index}`,
        }))}
        loading={loading}
        pagination={false}
        size="small"
        locale={{ emptyText: text?.dashboardNoData || "No inspections found" }}
      />
    </>
  );
};

MergedInspectionsTable.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
};

export default MergedInspectionsTable;
