import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Empty, Table, Tag, Typography } from "antd";

import {
  answerValue,
  formatAnswer,
  findQuestionByName,
  getText,
  optionSeverity,
  resolveOption,
  severityTagColor,
} from "../lib/utils";

const { Text } = Typography;

const severityRank = { red: 3, amber: 2, neutral: 1, green: 0 };

const severityLabel = (text, severity) => {
  if (severity === "red") {
    return text.siteProfileSeverityHigh;
  }
  if (severity === "amber" || severity === "neutral") {
    return text.siteProfileSeverityMedium;
  }
  return null;
};

const EMPTY_OBJECT = {};

const RisksWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || EMPTY_OBJECT;
  const latest = recordContext?.payload?.latest || EMPTY_OBJECT;
  const rows = useMemo(() => {
    const candidates = [];
    (item.rows || item.questions || []).forEach((rowConfig) => {
      const row =
        typeof rowConfig === "string" ? { question: rowConfig } : rowConfig;
      const question = findQuestionByName(row.question);
      const value = answerValue(latest[row.question]);
      const values = Array.isArray(value) ? value : [value];
      values.forEach((v) => {
        if (v === null || typeof v === "undefined" || v === "") {
          return;
        }
        const option = resolveOption(question, v);
        const severity = row.severity || optionSeverity(option.color);
        const label = severityLabel(text, severity);
        if (!label) {
          return;
        }
        candidates.push({
          key: `${row.question}-${v}`,
          risk:
            row.label || `${question?.label || row.question} - ${option.label}`,
          severity,
          severityLabel: label,
          action:
            formatAnswer(latest[row.action_question], row.action_question) ||
            row.action ||
            "—",
          recurring:
            formatAnswer(
              latest[row.recurring_question],
              row.recurring_question
            ) || row.recurring,
        });
      });
    });
    return candidates.sort(
      (a, b) => severityRank[b.severity] - severityRank[a.severity]
    );
  }, [item.rows, item.questions, latest, text]);

  const columns = [
    { title: text.siteProfileRiskCol, dataIndex: "risk" },
    {
      title: text.siteProfileSeverityCol,
      dataIndex: "severityLabel",
      render: (value, row) => (
        <Tag color={severityTagColor(row.severity)}>{value}</Tag>
      ),
    },
    { title: text.siteProfileRecommendedActionCol, dataIndex: "action" },
  ];
  if (rows.some((row) => row.recurring)) {
    columns.push({
      title: text.siteProfileRecurringCol,
      dataIndex: "recurring",
      render: (value) =>
        value ? (
          <Tag color="gold">{value}</Tag>
        ) : (
          <Tag>{text.siteProfileNo}</Tag>
        ),
    });
  }

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      {rows.length ? (
        <>
          <Table
            columns={columns}
            dataSource={rows}
            pagination={false}
            size="small"
          />
          <Text type="secondary">
            {rows.length} {text.siteProfileIssuesUnit}
          </Text>
        </>
      ) : (
        <Empty description={text.siteProfileNoFlaggedRisks} />
      )}
    </Card>
  );
};

RisksWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default RisksWidget;
