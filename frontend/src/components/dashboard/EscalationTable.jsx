import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Alert, Table } from "antd";
import { useDashboardEscalation } from "../../util/hooks";

/**
 * Renders a paginated AntD Table from a flat-schema `table` item.
 *
 * Dynamic column definitions come from `item.columns`. Computed columns
 * (where `computed: true` — no backend source) delegate to a per-column
 * function in `cellComputers`, keyed by `column.key`.
 *
 * Columns with `progress_ref` and `component_key` are resolved client-side
 * from the progress response data passed in via `cellComputers`.
 */
const EscalationTable = ({
  item,
  filterState,
  customFilterDefs,
  pageSize = 10,
  cellComputers = {},
}) => {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useDashboardEscalation(item, filterState, {
    page,
    pageSize,
    customFilterDefs,
  });

  const columns = useMemo(
    () =>
      (item.columns || [])
        .filter((c) => !c.hide)
        .map((c, colIndex) => {
          if (colIndex === 0) {
            return { ...c, fixed: "left", width: c.width || 200 };
          }
          // Non-first columns need an explicit width so scroll.x=max-content
          // can let them keep their natural size instead of being crushed
          // by AntD's default flex-shrink behaviour on narrow cards.
          return { ...c, width: c.width || 140 };
        })
        .map((c) => ({
          title: c.label,
          dataIndex: c.key,
          key: c.key,
          fixed: c.fixed,
          width: c.width,
          render: (value, row) => {
            // Computed columns (no backend source). If the page provided a
            // computer for this column key, run it against the row; otherwise
            // render a muted placeholder.
            if (c.computed) {
              const computer = cellComputers[c.key];
              const computed = computer ? computer(row) : null;
              if (computed === null || typeof computed === "undefined") {
                return <span style={{ color: "#bbb" }}>—</span>;
              }
              return typeof computed === "object"
                ? JSON.stringify(computed)
                : String(computed);
            }
            if (value === null || typeof value === "undefined") {
              return "—";
            }
            if (typeof value === "object") {
              return JSON.stringify(value);
            }
            return String(value);
          },
        })),
    [item.columns, cellComputers]
  );

  if (error) {
    return (
      <Alert
        type="error"
        message={`Failed to load escalation list: ${error.message || "error"}`}
      />
    );
  }

  return (
    <Table
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={data?.results || []}
      scroll={{ x: "max-content" }}
      pagination={{
        current: page,
        pageSize,
        total: data?.count || 0,
        onChange: setPage,
        showSizeChanger: false,
      }}
    />
  );
};

EscalationTable.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  pageSize: PropTypes.number,
  cellComputers: PropTypes.object,
};

export default EscalationTable;
