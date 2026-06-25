import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Empty, Table, Tag, Typography } from "antd";

import {
  answerValue,
  getQuestionLabel,
  passThreshold,
  thresholdLabel,
  getText,
} from "../lib/utils";

const { Text } = Typography;

const formatResult = (value, unit) => {
  if (value === null || value === "" || typeof value === "undefined") {
    return "—";
  }
  return unit ? `${value} ${unit}` : String(value);
};

const EMPTY_OBJECT = {};

const ComplianceWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || EMPTY_OBJECT;
  const latest = recordContext?.payload?.latest || EMPTY_OBJECT;
  const rows = useMemo(
    () =>
      (item.rows || [])
        .map((row) => {
          const entry = latest[row.question];
          const value = answerValue(entry);
          const status = passThreshold(value, row.threshold);
          if (value === null || value === "" || typeof value === "undefined") {
            return null;
          }
          return {
            key: row.question,
            parameter: getQuestionLabel(text, row),
            result: formatResult(value, row.unit),
            threshold: thresholdLabel(row.threshold, row.unit),
            status,
          };
        })
        .filter(Boolean),
    [item.rows, latest, text]
  );
  const failed = rows.some((row) => row.status === false);
  const verdict = failed
    ? text.siteProfileVerdictFail
    : text.siteProfileVerdictPass;

  return (
    <Card title={getText(text, item.label_key, item.label)} bordered>
      {rows.length ? (
        <>
          <Table
            columns={[
              { title: text.siteProfileParameterCol, dataIndex: "parameter" },
              { title: text.siteProfileResultCol, dataIndex: "result" },
              { title: text.siteProfileThresholdCol, dataIndex: "threshold" },
              {
                title: text.siteProfileStatusCol,
                dataIndex: "status",
                render: (status) =>
                  status === null ? (
                    <Tag>{text.siteProfileStatusInfo}</Tag>
                  ) : (
                    <Tag color={status ? "green" : "red"}>
                      {status
                        ? text.siteProfileStatusPass
                        : text.siteProfileStatusFail}
                    </Tag>
                  ),
              },
            ]}
            dataSource={rows}
            pagination={false}
            size="small"
          />
          <Text type="secondary">
            {text.siteProfileComplianceVerdict}:{" "}
            <Text strong type={failed ? "danger" : "success"}>
              {verdict}
            </Text>
            {item.compliance_text ? ` - ${item.compliance_text}` : null}
          </Text>
        </>
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

ComplianceWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default ComplianceWidget;
