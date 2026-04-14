import React, { useState } from "react";
import PropTypes from "prop-types";
import { Alert, Table } from "antd";
import { useDashboardEscalation } from "../../util/hooks";

/**
 * Renders a paginated AntD Table from `config.escalation[key]` by wiring into
 * useDashboardEscalation (which hits /visualization/escalation/{parent_form_id}).
 *
 * Dynamic column definitions come from escalationBlock.columns. Computed
 * columns (source not present in the backend vocabulary — e.g. violations,
 * overall_progress) render a placeholder today; hooks for joining with
 * /progress or frontend-compute results can be wired per-column in the
 * future.
 */
const EscalationTable = ({ escalationBlock, filterState, pageSize = 10 }) => {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useDashboardEscalation(
    escalationBlock,
    filterState,
    { page, pageSize }
  );

  const columns = (escalationBlock.columns || [])
    .filter((c) => !c.hide)
    .map((c) => ({
      title: c.label,
      dataIndex: c.key,
      key: c.key,
      render: (value) => {
        if (value === null) {
          return "—";
        }
        if (typeof value === "object") {
          return JSON.stringify(value);
        }
        return String(value);
      },
    }));

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
  escalationBlock: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  pageSize: PropTypes.number,
};

export default EscalationTable;
