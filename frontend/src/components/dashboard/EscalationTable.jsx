import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Alert, Table } from "antd";
import { DownCircleOutlined, LeftCircleOutlined } from "@ant-design/icons";
import { useDashboardEscalation } from "../../util/hooks";

const renderValue = (column, row, cellComputers) => {
  if (column.computed) {
    const computer = cellComputers[column.key];
    const computed = computer ? computer(row) : null;
    if (computed === null || typeof computed === "undefined") {
      return null;
    }
    return typeof computed === "object"
      ? JSON.stringify(computed)
      : String(computed);
  }
  const value = row[column.key];
  if (value === null || typeof value === "undefined") {
    return null;
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

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

  const visibleColumns = useMemo(
    () => (item.columns || []).filter((c) => !c.hide),
    [item.columns]
  );

  const MAX_COLUMNS = 6;

  const summaryColumns = useMemo(() => {
    const priority = visibleColumns.filter((c) => c.priority);
    return priority.length > 0
      ? priority
      : visibleColumns.slice(0, MAX_COLUMNS);
  }, [visibleColumns]);

  const columns = useMemo(
    () => [
      ...summaryColumns.map((c) => ({
        title: c.label,
        dataIndex: c.key,
        key: c.key,
        render: (_value, row) => {
          const display = renderValue(c, row, cellComputers);
          if (display === null) {
            return <span style={{ color: "#bbb" }}>—</span>;
          }
          return <span>{display}</span>;
        },
      })),
      Table.EXPAND_COLUMN,
    ],
    [summaryColumns, cellComputers]
  );

  const renderExpandedRow = (row) => {
    const rows = visibleColumns.map((c) => ({
      key: c.key,
      label: c.label,
      display: renderValue(c, row, cellComputers),
    }));
    return (
      <div className="pending-data-wrapper">
        <h3>{item.label || "Details"}</h3>
        <Table
          pagination={false}
          dataSource={rows}
          rowKey="key"
          columns={[
            {
              title: "Question",
              dataIndex: "label",
              width: "50%",
              className: "table-col-question",
            },
            {
              title: "Response",
              dataIndex: "display",
              width: "50%",
              render: (display) =>
                display === null ? (
                  <span style={{ color: "#bbb" }}>—</span>
                ) : (
                  display
                ),
            },
          ]}
        />
      </div>
    );
  };

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
      loading={loading}
      columns={columns}
      dataSource={data?.results || []}
      expandable={{
        expandedRowRender: renderExpandedRow,
        expandRowByClick: true,
        expandIcon: ({ expanded, onExpand, record }) =>
          expanded ? (
            <DownCircleOutlined
              onClick={(e) => onExpand(record, e)}
              style={{ color: "#1651B6", fontSize: "19px" }}
            />
          ) : (
            <LeftCircleOutlined
              onClick={(e) => onExpand(record, e)}
              style={{ color: "#1651B6", fontSize: "19px" }}
            />
          ),
      }}
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
