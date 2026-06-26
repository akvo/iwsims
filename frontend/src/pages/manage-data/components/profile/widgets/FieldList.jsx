import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Empty, Table, Tag } from "antd";

import {
  answerValue,
  findQuestionByName,
  formatAnswer,
  getText,
  optionSeverity,
  resolveOption,
  severityTagColor,
} from "../utils";

const renderFieldValue = (entry, questionName) => {
  const question = findQuestionByName(questionName);
  const value = answerValue(entry);
  const isOption =
    question?.type === "option" ||
    question?.type === "multiple_option" ||
    Array.isArray(entry?.options);
  if (isOption) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((v) => v !== null && typeof v !== "undefined" && v !== "")
      .map((v) => {
        const option = resolveOption(question, v);
        return (
          <Tag key={v} color={severityTagColor(optionSeverity(option.color))}>
            {option.label}
          </Tag>
        );
      });
  }
  const formatted = formatAnswer(entry, questionName);
  return Array.isArray(formatted) ? formatted.join(", ") : formatted;
};

const FieldList = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const rows = useMemo(() => {
    const latest = recordContext?.payload?.latest || {};
    const localeText = recordContext?.text || {};
    const configured =
      item.rows || (item.questions || []).map((question) => ({ question }));
    return configured
      .map((row) => {
        const name = row.question;
        const entry = latest[name];
        if (answerValue(entry) === null) {
          return null;
        }
        const question = findQuestionByName(name);
        return {
          key: name,
          label: getText(
            localeText,
            row.label_key,
            row.label || question?.label || name
          ),
          value: renderFieldValue(entry, name),
        };
      })
      .filter(Boolean);
  }, [item.rows, item.questions, recordContext]);

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      {rows.length ? (
        <Table
          showHeader={false}
          pagination={false}
          size="small"
          bordered
          columns={[
            { dataIndex: "label", key: "label", width: "50%" },
            { dataIndex: "value", key: "value" },
          ]}
          dataSource={rows}
        />
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

FieldList.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default FieldList;
