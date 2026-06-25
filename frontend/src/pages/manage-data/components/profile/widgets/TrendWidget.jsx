import React from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";
import { Card, Empty } from "antd";

import { formatDate, findQuestionByName, getText } from "../lib/utils";

const TrendWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const question = findQuestionByName(item.question);
  const history = recordContext?.payload?.history?.[item.question] || [];
  const rows = history
    .map((row) => ({
      date: row.created,
      value: Number(row.value),
    }))
    .filter((row) => !Number.isNaN(row.value));
  const title = getText(text, item.label_key, item.label || question?.label);

  return (
    <Card title={title} bordered>
      {rows.length ? (
        <ReactECharts
          style={{ height: 260 }}
          option={{
            grid: { left: 48, right: 24, top: 20, bottom: 36 },
            tooltip: { trigger: "axis" },
            xAxis: {
              type: "category",
              data: rows.map((row) => formatDate(row.date)),
            },
            yAxis: {
              type: "value",
              name: item.unit || "",
            },
            series: [
              {
                type: "line",
                smooth: true,
                data: rows.map((row) => row.value),
              },
            ],
          }}
        />
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

TrendWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default TrendWidget;
