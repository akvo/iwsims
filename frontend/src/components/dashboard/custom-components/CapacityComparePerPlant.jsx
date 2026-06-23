import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";
import { Alert, Card, Skeleton } from "antd";
import { useDashboardValues } from "../../../util/hooks";

// Per-plant Production-vs-Design comparison. Each plant is one category on a
// horizontal grouped bar; the canvas grows with the plant count and lives in a
// fixed-height scroll viewport so it stays usable at 99+ plants. The Production
// bar turns amber where production exceeds design capacity (DWS secondary
// indicator). The value axis is pinned to the top with vertical gridlines so
// the ML/day scale stays referenceable while scrolling.

const DESIGN_COLOR = "#a6cee3";
const PRODUCTION_COLOR = "#1aab9f";
const OVER_COLOR = "#f5a623";
const ROW_PX = 34;
const MIN_CANVAS = 160;
const AXIS_PAD = 56;

const toNum = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const MeasureFetcher = ({
  measure,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
  onData,
}) => {
  const { data, loading, error } = useDashboardValues(
    measure.api,
    filterState,
    {
      fiscalYearStartMonth,
      customFilterDefs,
      parentFormId,
    }
  );
  useEffect(() => {
    onData(measure.key, { data, loading, error });
  }, [measure.key, data, loading, error, onData]);
  return null;
};

MeasureFetcher.propTypes = {
  measure: PropTypes.shape({
    key: PropTypes.string.isRequired,
    api: PropTypes.object.isRequired,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onData: PropTypes.func.isRequired,
};

MeasureFetcher.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

/**
 * Join the design (universe) and production responses by parent_id and sort
 * descending by design capacity. Design is the universe: a plant with no
 * production answer shows production = 0.
 */
const joinRows = (designData, productionData) => {
  const prod = new Map();
  (productionData || []).forEach((row) => {
    prod.set(String(row.group), toNum(row.value));
  });
  return (designData || [])
    .map((row) => {
      const design = toNum(row.value);
      const production = prod.get(String(row.group)) || 0;
      return {
        label: row.label,
        design,
        production,
        over: production > design,
      };
    })
    .sort((a, b) => b.design - a.design);
};

const findMeasure = (measures, key, index) =>
  (measures || []).find((m) => m.key === key) || (measures || [])[index];

const CapacityComparePerPlant = ({
  item,
  filterState,
  fiscalYearStartMonth,
  customFilterDefs,
  parentFormId,
}) => {
  const [results, setResults] = useState({});
  const onMeasureData = useCallback((key, payload) => {
    setResults((prev) =>
      prev[key] === payload ? prev : { ...prev, [key]: payload }
    );
  }, []);

  const designMeasure = findMeasure(item.measures, "design", 0);
  const productionMeasure = findMeasure(item.measures, "production", 1);
  const designLabel = designMeasure?.label || "Design";
  const productionLabel = productionMeasure?.label || "Production";
  const overColor = item.over_capacity_color || OVER_COLOR;

  const loading = (item.measures || []).some(
    (m) => !results[m.key] || results[m.key]?.loading
  );
  const error = Object.values(results).find((r) => r?.error)?.error;

  const rows = useMemo(
    () =>
      joinRows(
        results[designMeasure?.key]?.data?.data,
        results[productionMeasure?.key]?.data?.data
      ),
    [results, designMeasure, productionMeasure]
  );

  const option = useMemo(() => {
    const labels = rows.map((r) => r.label);
    return {
      grid: { left: 8, right: 24, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const row = rows[params?.[0]?.dataIndex];
          if (!row) {
            return "";
          }
          const flag = row.over
            ? '<br/><span style="color:#f5a623">⚠ over design capacity</span>'
            : "";
          return (
            `<b>${row.label}</b><br/>` +
            `${designLabel}: ${row.design}<br/>` +
            `${productionLabel}: ${row.production}${flag}`
          );
        },
      },
      xAxis: {
        type: "value",
        position: "top",
        name: item.config?.xAxisLabel || "ML/day",
        nameLocation: "middle",
        nameGap: 28,
        splitLine: { show: true, lineStyle: { color: "#eee" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: labels,
        axisLabel: { interval: 0 },
        axisTick: { show: false },
      },
      series: [
        {
          name: designLabel,
          type: "bar",
          color: DESIGN_COLOR,
          data: rows.map((r) => r.design),
        },
        {
          name: productionLabel,
          type: "bar",
          color: PRODUCTION_COLOR,
          data: rows.map((r) => ({
            value: r.production,
            itemStyle: { color: r.over ? overColor : PRODUCTION_COLOR },
          })),
        },
      ],
    };
  }, [rows, designLabel, productionLabel, overColor, item.config]);

  const title =
    item.config?.title ||
    item.title ||
    item.label ||
    "Production vs Design Capacity";
  const viewport = item.height || 480;
  const canvasHeight = Math.max(
    MIN_CANVAS,
    rows.length * (item.row_px || ROW_PX) + AXIS_PAD
  );

  return (
    <Card title={title} className="chart-card">
      {(item.measures || []).map((measure) => (
        <MeasureFetcher
          key={measure.key}
          measure={measure}
          filterState={filterState}
          fiscalYearStartMonth={fiscalYearStartMonth}
          customFilterDefs={customFilterDefs}
          parentFormId={parentFormId}
          onData={onMeasureData}
        />
      ))}
      <div
        className="capacity-compare-legend"
        style={{
          display: "flex",
          gap: 16,
          margin: "0 0 8px 4px",
          fontSize: 12,
        }}
      >
        <span>
          <span
            style={{
              background: DESIGN_COLOR,
              display: "inline-block",
              width: 12,
              height: 12,
              marginRight: 4,
            }}
          />
          {designLabel}
        </span>
        <span>
          <span
            style={{
              background: PRODUCTION_COLOR,
              display: "inline-block",
              width: 12,
              height: 12,
              marginRight: 4,
            }}
          />
          {productionLabel}
        </span>
        <span>
          <span
            style={{
              background: overColor,
              display: "inline-block",
              width: 12,
              height: 12,
              marginRight: 4,
            }}
          />
          Over design capacity
        </span>
      </div>
      {error ? (
        <Alert
          type="error"
          message={`Failed to load ${item.id}: ${error.message || "error"}`}
        />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : rows.length === 0 ? (
        <Alert type="info" message="No data" />
      ) : (
        <div
          style={{ height: viewport, overflowY: "auto", overflowX: "hidden" }}
        >
          <ReactECharts
            option={option}
            notMerge
            style={{ height: canvasHeight, width: "100%" }}
          />
        </div>
      )}
    </Card>
  );
};

CapacityComparePerPlant.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string,
    label: PropTypes.string,
    config: PropTypes.object,
    height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    row_px: PropTypes.number,
    over_capacity_color: PropTypes.string,
    measures: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string.isRequired,
        label: PropTypes.string,
        api: PropTypes.object.isRequired,
      })
    ).isRequired,
  }).isRequired,
  filterState: PropTypes.object,
  fiscalYearStartMonth: PropTypes.number,
  customFilterDefs: PropTypes.array,
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

CapacityComparePerPlant.defaultProps = {
  filterState: {},
  fiscalYearStartMonth: 1,
  customFilterDefs: [],
  parentFormId: null,
};

export default CapacityComparePerPlant;
