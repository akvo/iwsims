import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";
import { Alert, Card, Skeleton, Typography } from "antd";
import { useDashboardValues } from "../../../util/hooks";
import { computeComplianceTrend } from "../compute/complianceTrend";
import FormulaInfo from "../widgets/FormulaInfo";

const { Text } = Typography;

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Rolling month axis ending at `today`'s month, `count` buckets long. */
const buildMonthAxis = (today, count) => {
  const anchor = today instanceof Date ? today : new Date();
  const axis = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}`;
    axis.push({ key, label: MONTHS_SHORT[d.getMonth()] });
  }
  return axis;
};

/** Build the flat list of /values fetches every domain needs. */
const buildFetchSpecs = (domains, months) =>
  (domains || []).flatMap((d) => {
    const rolling = d.rolling_months || months;
    if (d.type === "option_share") {
      return [
        {
          key: `${d.key}__share`,
          api: {
            question_name: d.question_name,
            group_by: "month",
            stack_by: "option",
            monitoring: "all",
            rolling_months: rolling,
          },
        },
      ];
    }
    if (d.type === "threshold_all") {
      return (d.params || []).map((p) => ({
        key: `${d.key}__${p.question_name}`,
        api: {
          question_name: p.question_name,
          group_by: "month",
          stack_by: "parent_id",
          monitoring: "all",
          rolling_months: rolling,
        },
      }));
    }
    return [];
  });

const Fetcher = ({
  fetchKey,
  api,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  today,
  parentFormId,
  onData,
}) => {
  const { data, loading, error } = useDashboardValues(api, filterState, {
    today,
    fiscalYearStartMonth,
    customFilterDefs,
    parentFormId,
  });

  useEffect(() => {
    onData(fetchKey, { data, loading, error });
  }, [fetchKey, data, loading, error, onData]);

  return null;
};

Fetcher.propTypes = {
  fetchKey: PropTypes.string.isRequired,
  api: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  today: PropTypes.instanceOf(Date),
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onData: PropTypes.func.isRequired,
};

Fetcher.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  today: null,
  parentFormId: null,
};

const chartOption = (months, series) => ({
  grid: { left: 48, right: 24, top: 16, bottom: 44, containLabel: true },
  legend: { bottom: 0, data: series.map((s) => s.label) },
  tooltip: {
    trigger: "axis",
    valueFormatter: (v) => (typeof v === "number" ? `${v}` : "—"),
  },
  xAxis: {
    type: "category",
    boundaryGap: false,
    data: months,
    axisLabel: { color: "#5a626b" },
  },
  yAxis: {
    type: "value",
    min: 0,
    max: 100,
    interval: 20,
    axisLabel: { formatter: "{value}%", color: "#8a929b" },
    splitLine: { lineStyle: { color: "#eef1f4" } },
  },
  series: series.map((s) => ({
    name: s.label,
    type: "line",
    smooth: false,
    symbol: "circle",
    symbolSize: 6,
    connectNulls: true,
    data: s.data,
    itemStyle: { color: s.color },
    lineStyle: { color: s.color, width: 2 },
    areaStyle: { color: s.color, opacity: 0.12 },
  })),
});

/**
 * Compliance Trend — 12-month line chart of the % of WWTPs passing each domain.
 *
 * Frontend compute (no backend changes): each domain is one rule shape fed by
 * existing /values calls — see compute/complianceTrend.js. Effluent uses numeric
 * thresholds (group_by:month + stack_by:parent_id); OHS uses an option share
 * (group_by:month + stack_by:option). Self-fetching like StageFlowWidget.
 */
const ComplianceTrendWidget = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  today,
  parentFormId,
}) => {
  const [results, setResults] = useState({});
  const onData = useCallback((key, payload) => {
    setResults((prev) =>
      prev[key] === payload ? prev : { ...prev, [key]: payload }
    );
  }, []);

  const months = item.months || 12;
  const monthAxis = useMemo(
    () => buildMonthAxis(today, months),
    [today, months]
  );
  const fetchSpecs = useMemo(
    () => buildFetchSpecs(item.domains, months),
    [item.domains, months]
  );

  const loading = fetchSpecs.some(
    (f) => !results[f.key] || results[f.key]?.loading
  );
  const error = fetchSpecs.map((f) => results[f.key]?.error).find(Boolean);

  const responses = useMemo(() => {
    const out = {};
    fetchSpecs.forEach((f) => {
      out[f.key] = results[f.key]?.data;
    });
    return out;
  }, [fetchSpecs, results]);

  const { series } = useMemo(
    () => computeComplianceTrend(item.domains, monthAxis, responses),
    [item.domains, monthAxis, responses]
  );

  const hasData = series.some((s) => s.data.some((v) => typeof v === "number"));
  const title = item.title || item.label || "Compliance Trend";

  return (
    <Card className="chart-card compliance-trend">
      <div className="condition-matrix-head">
        <h4 className="condition-matrix-title">
          {title}
          <FormulaInfo info={item.info} title={title} />
        </h4>
        {item.subtitle && (
          <Text type="secondary" className="condition-matrix-subtitle">
            {item.subtitle}
          </Text>
        )}
      </div>
      {fetchSpecs.map((f) => (
        <Fetcher
          key={f.key}
          fetchKey={f.key}
          api={f.api}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          today={today}
          parentFormId={parentFormId}
          onData={onData}
        />
      ))}
      {error ? (
        <Alert
          type="error"
          message={`Failed to load ${item.id}: ${error.message || "error"}`}
        />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : hasData ? (
        <ReactECharts
          option={chartOption(
            monthAxis.map((m) => m.label),
            series
          )}
          notMerge
          style={{ height: item.height || 300, width: "100%" }}
        />
      ) : (
        <div style={{ padding: 16, color: "#999", textAlign: "center" }}>
          No data
        </div>
      )}
    </Card>
  );
};

ComplianceTrendWidget.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string,
    label: PropTypes.string,
    subtitle: PropTypes.string,
    months: PropTypes.number,
    height: PropTypes.number,
    domains: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        color: PropTypes.string,
        type: PropTypes.oneOf(["option_share", "threshold_all"]).isRequired,
      })
    ).isRequired,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  today: PropTypes.instanceOf(Date),
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

ComplianceTrendWidget.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  today: null,
  parentFormId: null,
};

export default ComplianceTrendWidget;
