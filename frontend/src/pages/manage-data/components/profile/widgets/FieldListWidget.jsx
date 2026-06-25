import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Empty, Table, Tag } from "antd";

import { findQuestionByName, getText, resolveOption } from "../lib/utils";

const renderAnswer = (entry, question) => {
  if (!entry) {
    return null;
  }
  if (Array.isArray(entry.options) && entry.options.length) {
    return entry.options.map((v) => {
      const { label, color } = resolveOption(question, v);
      return (
        <Tag key={v} color={color || "default"}>
          {label}
        </Tag>
      );
    });
  }
  if (entry.value !== null && typeof entry.value !== "undefined") {
    return String(entry.value);
  }
  return entry.name || null;
};

const EMPTY_OBJECT = {};

const FieldListWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || EMPTY_OBJECT;
  const latest = recordContext?.payload?.latest || EMPTY_OBJECT;
  const rows = useMemo(() => {
    const configuredRows =
      item.rows || (item.questions || []).map((question) => ({ question }));
    return configuredRows
      .map((row) => {
        const name = row.question;
        const q = findQuestionByName(name);
        const answer = renderAnswer(latest[name], q);
        if (answer === null) {
          return null;
        }
        return {
          key: name,
          label: getText(text, row.label_key, row.label || q?.label || name),
          value: answer,
        };
      })
      .filter(Boolean);
  }, [item.rows, item.questions, latest, text]);

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      {rows.length === 0 ? (
        <Empty description={text.siteProfileNoData} />
      ) : (
        <Table
          showHeader={false}
          pagination={false}
          size="small"
          bordered
          columns={[
            { dataIndex: "label", width: "50%" },
            { dataIndex: "value" },
          ]}
          dataSource={rows}
        />
      )}
    </Card>
  );
};

FieldListWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default FieldListWidget;
