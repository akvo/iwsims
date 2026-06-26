import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Empty, Popover } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Line } from "akvo-charts";

import {
  findQuestionByName,
  formatDate,
  getText,
  optionSeverity,
  resolveOption,
} from "../utils";

const RISK_BUCKETS = 5; // OK · Low · Med · High · Critical

const scoreSubmission = (submission, questions) =>
  (questions || []).reduce((score, name) => {
    const answer = submission.answers?.[name];
    const value = Array.isArray(answer) ? answer[0] : answer;
    const sev = optionSeverity(
      resolveOption(findQuestionByName(name), value).color
    );
    return score + (sev === "red" ? 2 : sev === "amber" ? 1 : 0);
  }, 0);

const toBucket = (score) => {
  if (score === 0) {
    return 0;
  }
  if (score <= 2) {
    return 1;
  }
  if (score <= 4) {
    return 2;
  }
  if (score <= 6) {
    return 3;
  }
  return 4;
};

// Legend explaining the OK · Low · Med · High · Critical risk-score levels.
const RISK_LEGEND = [
  { key: "Ok", color: "#52c41a" },
  { key: "Low", color: "#a0d911" },
  { key: "Med", color: "#faad14" },
  { key: "High", color: "#fa8c16" },
  { key: "Critical", color: "#f5222d" },
];

// Bucket index (0..4) → legend color, so chart dots match the legend.
const RISK_BUCKET_COLORS = RISK_LEGEND.map((level) => level.color);

const RiskLegend = ({ text }) => (
  <div className="site-profile-risk-legend">
    {RISK_LEGEND.map((level) => (
      <span key={level.key} className="site-profile-risk-legend-item">
        <i style={{ backgroundColor: level.color }} />
        <b>{getText(text, `siteProfileRisk${level.key}`, level.key)}</b>
        <span>{getText(text, `siteProfileRisk${level.key}Desc`, "")}</span>
      </span>
    ))}
  </div>
);

RiskLegend.propTypes = {
  text: PropTypes.object,
};

const SEVERITY_POINTS = { red: 2, amber: 1, green: 0, neutral: 0 };

// "(i)" popover explaining the risk-score formula for THIS chart, read live
// from each scoring question's option colors.
const RiskFormulaInfo = ({ item, text }) => {
  const questions = (item.questions || []).map((name) => {
    const found = findQuestionByName(name);
    const options = (found?.option || found?.options || []).map((opt) => ({
      key: opt.value,
      label: opt.label || opt.value,
      points: SEVERITY_POINTS[optionSeverity(opt.color)] ?? 0,
    }));
    return { key: name, label: found?.label || name, options };
  });

  const content = (
    <div style={{ maxWidth: 360, fontSize: 12 }}>
      <div>
        {getText(
          text,
          "siteProfileRiskFormulaIntro",
          "Score = sum of severity points across these questions:"
        )}
      </div>
      <ul style={{ paddingLeft: 18, margin: "6px 0" }}>
        {questions.map((q) => (
          <li key={q.key}>
            <b>{q.label}</b>
            {q.options.length
              ? ` — ${q.options
                  .map((o) => `${o.label}: ${o.points}`)
                  .join(", ")}`
              : null}
          </li>
        ))}
      </ul>
      <div>
        {getText(
          text,
          "siteProfileRiskFormulaScale",
          "Severity: red = 2, amber = 1, green = 0. Levels: OK 0 · Low 1–2 · Med 3–4 · High 5–6 · Critical 7+."
        )}
      </div>
    </div>
  );

  return (
    <Popover
      placement="topRight"
      title={getText(
        text,
        "siteProfileRiskFormulaTitle",
        "How this is calculated"
      )}
      content={content}
    >
      <InfoCircleOutlined
        style={{ marginLeft: 6, color: "#8c8c8c", cursor: "help" }}
      />
    </Popover>
  );
};

RiskFormulaInfo.propTypes = {
  item: PropTypes.object.isRequired,
  text: PropTypes.object,
};

/**
 * akvo-charts <Line> with a compact grid and optional overrides (threshold
 * band + dashed limit lines, or a categorical y-axis). akvo-charts doesn't
 * expose these, so we grab the ECharts instance via a ref and setOption.
 */
const ConfiguredLine = ({
  config,
  data,
  bounds,
  lines,
  yAxis,
  tooltipLabels,
  pointColors,
}) => {
  const [chart, setChart] = useState(null);
  const setRef = useCallback((instance) => {
    if (instance && typeof instance.setOption === "function") {
      setChart((prev) => prev || instance);
    }
  }, []);

  useEffect(() => {
    if (!chart) {
      return;
    }
    const opts = {
      grid: { top: 12, right: 12, bottom: 36, left: 8, containLabel: true },
      xAxis: { axisLabel: { rotate: 30, hideOverlap: true } },
      yAxis: yAxis || { min: 0 },
    };
    if (tooltipLabels) {
      // Map the bucket value to its level name (OK · Low · Med · High · Critical).
      opts.tooltip = {
        trigger: "axis",
        formatter: (params) => {
          const point = Array.isArray(params) ? params[0] : params;
          // akvo-charts feeds { label, value } objects, so the bucket lives on
          // point.data.value (point.value is the whole object).
          const bucket =
            typeof point.value === "number"
              ? point.value
              : point.data?.value ?? point.value?.value;
          const level = tooltipLabels[bucket] ?? bucket;
          return `${point.axisValue}<br/>${point.marker || ""} <b>${level}</b>`;
        },
      };
    }
    const series = {};
    if (bounds) {
      series.markArea = {
        silent: true,
        itemStyle: { color: "rgba(82, 196, 26, 0.12)" },
        data: [[{ yAxis: bounds.lo }, { yAxis: bounds.hi }]],
      };
    }
    if (lines.length) {
      series.markLine = {
        silent: true,
        symbol: "none",
        label: { show: false },
        lineStyle: { type: "dashed", color: "#999" },
        data: lines.map((y) => ({ yAxis: y })),
      };
    }
    if (pointColors) {
      // Color each dot by its level; keep the connecting line subtle.
      series.symbol = "circle";
      series.symbolSize = 8;
      series.itemStyle = {
        color: (p) => {
          const bucket =
            typeof p.value === "number"
              ? p.value
              : p.data?.value ?? p.value?.value;
          return pointColors[bucket] || "#5b8ff9";
        },
      };
      series.lineStyle = { color: "#bfbfbf" };
    }
    if (bounds || lines.length || pointColors) {
      opts.series = [series];
    }
    chart.setOption(opts, false);
  }, [chart, config, data, bounds, lines, yAxis, tooltipLabels, pointColors]);

  return <Line ref={setRef} config={config} data={data} />;
};

ConfiguredLine.propTypes = {
  config: PropTypes.object.isRequired,
  data: PropTypes.array.isRequired,
  bounds: PropTypes.shape({ lo: PropTypes.number, hi: PropTypes.number }),
  lines: PropTypes.array.isRequired,
  yAxis: PropTypes.object,
  tooltipLabels: PropTypes.array,
  pointColors: PropTypes.array,
};

const HistoryChart = ({ item, recordContext }) => {
  const text = useMemo(() => recordContext?.text || {}, [recordContext]);
  const question = findQuestionByName(item.question);
  const isRiskScore = item.source === "risk_score";

  const data = useMemo(() => {
    if (isRiskScore) {
      const submissions = recordContext?.payload?.submissions || [];
      // Prefer the inspection-date question's answer over FormData.created.
      return submissions
        .map((submission) => {
          const inspected = item.date_question
            ? submission.answers?.[item.date_question]
            : null;
          const date = inspected || submission.date;
          return {
            date,
            label: formatDate(date),
            value: toBucket(scoreSubmission(submission, item.questions)),
          };
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(({ label, value }) => ({ label, value }));
    }
    const history = recordContext?.payload?.history?.[item.question] || [];
    return history
      .map((row) => ({ label: formatDate(row.date), value: Number(row.value) }))
      .filter((row) => !Number.isNaN(row.value));
  }, [
    recordContext,
    item.question,
    item.questions,
    item.date_question,
    isRiskScore,
  ]);

  const riskLabels = useMemo(
    () => [
      getText(text, "siteProfileRiskOk", "OK"),
      getText(text, "siteProfileRiskLow", "Low"),
      getText(text, "siteProfileRiskMed", "Med"),
      getText(text, "siteProfileRiskHigh", "High"),
      getText(text, "siteProfileRiskCritical", "Critical"),
    ],
    [text]
  );

  const yAxis = useMemo(() => {
    if (!isRiskScore) {
      return null;
    }
    return {
      min: 0,
      max: RISK_BUCKETS,
      interval: 1,
      axisLabel: { formatter: (value) => riskLabels[value] || "" },
    };
  }, [isRiskScore, riskLabels]);

  const bounds = useMemo(() => {
    const min = item.threshold?.min;
    const max = item.threshold?.max;
    const hasMin = typeof min === "number";
    const hasMax = typeof max === "number";
    if (isRiskScore || (!hasMin && !hasMax)) {
      return null;
    }
    const lo = hasMin ? min : 0;
    const hi = hasMax ? max : min;
    return hi > lo ? { lo, hi } : null;
  }, [item.threshold, isRiskScore]);

  const lines = useMemo(
    () =>
      isRiskScore
        ? []
        : [item.threshold?.min, item.threshold?.max].filter(
            (v) => typeof v === "number"
          ),
    [item.threshold, isRiskScore]
  );

  const title = getText(text, item.label_key, item.label || question?.label);
  const config = useMemo(
    () => ({
      title: "",
      xAxisLabel: "",
      yAxisLabel: isRiskScore ? "" : item.unit || "",
      legend: { show: false },
      ...(item.config || {}),
    }),
    [item.unit, item.config, isRiskScore]
  );

  const cardTitle = isRiskScore ? (
    <span>
      {title}
      <RiskFormulaInfo item={item} text={text} />
    </span>
  ) : (
    title
  );

  return (
    <Card
      title={cardTitle}
      size="small"
      className="history-chart-card"
      bordered
    >
      {data.length ? (
        <>
          <ConfiguredLine
            config={config}
            data={data}
            bounds={bounds}
            lines={lines}
            yAxis={yAxis}
            tooltipLabels={isRiskScore ? riskLabels : null}
            pointColors={isRiskScore ? RISK_BUCKET_COLORS : null}
          />
          {isRiskScore ? <RiskLegend text={text} /> : null}
        </>
      ) : (
        <Empty description={text.siteProfileNoData} />
      )}
    </Card>
  );
};

HistoryChart.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default HistoryChart;
