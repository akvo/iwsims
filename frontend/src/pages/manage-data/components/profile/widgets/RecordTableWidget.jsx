import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Table } from "antd";

import { findQuestionByName, getText } from "../lib/utils";

const fmt = (value) => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value === null || typeof value === "undefined" || value === "") {
    return "—";
  }
  return String(value);
};

const RecordTableWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const submissions = recordContext?.payload?.submissions || [];
  const configuredColumns =
    item.columns || (item.questions || []).map((question) => ({ question }));
  const columns = configuredColumns.map((column) => ({
    title: getText(
      text,
      column.title_key,
      column.title ||
        findQuestionByName(column.question)?.label ||
        column.question
    ),
    dataIndex: column.key || column.question || column.source,
    render: (_, row) => {
      if (column.source === "date") {
        return fmt(row.created || row.created_at || row.date);
      }
      return fmt(row.answers?.[column.question]);
    },
  }));

  return (
    <Card
      title={getText(
        text,
        item.label_key,
        item.label || text.siteProfileRecords
      )}
      bordered
    >
      {submissions.length === 0 ? (
        <Empty description={text.siteProfileNoInspections} />
      ) : (
        <Table
          columns={columns}
          dataSource={submissions.map((s) => ({ key: s.data_id, ...s }))}
          pagination={false}
          size="small"
        />
      )}
    </Card>
  );
};

RecordTableWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default RecordTableWidget;
