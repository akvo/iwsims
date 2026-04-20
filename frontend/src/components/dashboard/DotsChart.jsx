import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import ReactECharts from "echarts-for-react";

/**
 * Packed-bubble ("dots") chart rendered via ECharts' `graph` series with
 * a `force` layout. Each option from the /values response becomes one
 * bubble; bubble area scales with value. Clicking a bubble toggles a
 * "selected" state that zooms the clicked bubble and dims the others —
 * the zoom is an animated symbolSize transition handled by ECharts.
 *
 * Data shape: [{ label, value }, ...]  (same as doughnut/pie inputs)
 */

const DEFAULT_PALETTE = [
  "#5B3898",
  "#3B75D0",
  "#F4B73F",
  "#2FAF4F",
  "#2EAC9A",
  "#DC5B5B",
  "#7D4AC0",
  "#5B8FF9",
  "#E67E22",
  "#16A085",
];

const MIN_SYMBOL = 44;
const MAX_SYMBOL = 130;
const SELECTED_SCALE = 1.35;

const scaleSymbolSize = (value, maxValue) => {
  if (!maxValue || maxValue <= 0) {
    return MIN_SYMBOL;
  }
  const ratio = Math.sqrt(Math.max(0, value) / maxValue);
  return MIN_SYMBOL + ratio * (MAX_SYMBOL - MIN_SYMBOL);
};

const truncate = (name, symbolSize) => {
  const maxChars = Math.max(4, Math.floor(symbolSize / 9));
  if (!name) {
    return "";
  }
  return name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
};

const DotsChart = ({ data, colors, height }) => {
  const [selectedLabel, setSelectedLabel] = useState(null);

  const palette = colors && colors.length > 0 ? colors : DEFAULT_PALETTE;

  const maxValue = useMemo(
    () => data.reduce((m, d) => Math.max(m, Number(d.value) || 0), 0),
    [data]
  );

  const nodes = useMemo(
    () =>
      data.map((d, i) => {
        const baseSize = scaleSymbolSize(Number(d.value) || 0, maxValue);
        const isSelected = selectedLabel === d.label;
        const isDimmed = selectedLabel !== null && !isSelected;
        const size = isSelected ? baseSize * SELECTED_SCALE : baseSize;
        return {
          id: d.label,
          name: d.label,
          value: Number(d.value) || 0,
          symbolSize: size,
          itemStyle: {
            color: palette[i % palette.length],
            opacity: isDimmed ? 0.4 : 1,
            borderColor: isSelected ? "#ffffff" : "transparent",
            borderWidth: isSelected ? 3 : 0,
            shadowBlur: isSelected ? 20 : 0,
            shadowColor: "rgba(0,0,0,0.25)",
          },
          label: {
            show: true,
            position: "inside",
            formatter: (p) => truncate(p.name, p.data.symbolSize),
            color: "#ffffff",
            fontWeight: 600,
            fontSize: Math.max(10, Math.min(14, Math.round(size / 9))),
          },
          emphasis: {
            scale: true,
            itemStyle: {
              shadowBlur: 20,
              shadowColor: "rgba(0,0,0,0.3)",
            },
          },
        };
      }),
    [data, maxValue, selectedLabel, palette]
  );

  const option = useMemo(
    () => ({
      animationDuration: 600,
      animationDurationUpdate: 500,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        trigger: "item",
        formatter: (p) =>
          p.dataType === "node" ? `${p.name}: <b>${p.value}</b>` : "",
      },
      series: [
        {
          type: "graph",
          layout: "force",
          force: {
            repulsion: 260,
            gravity: 0.12,
            edgeLength: 0,
            friction: 0.2,
            layoutAnimation: true,
          },
          roam: false,
          draggable: false,
          focusNodeAdjacency: false,
          data: nodes,
          edges: [],
        },
      ],
    }),
    [nodes]
  );

  const onEvents = useMemo(
    () => ({
      click: (p) => {
        if (p.dataType !== "node") {
          return;
        }
        setSelectedLabel((prev) => (prev === p.data.name ? null : p.data.name));
      },
    }),
    []
  );

  return (
    <div className="dots-chart-wrapper" style={{ height, width: "100%" }}>
      <ReactECharts
        option={option}
        notMerge={false}
        lazyUpdate={false}
        style={{ height: "100%", width: "100%" }}
        onEvents={onEvents}
      />
    </div>
  );
};

DotsChart.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      value: PropTypes.number,
    })
  ).isRequired,
  colors: PropTypes.arrayOf(PropTypes.string),
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

DotsChart.defaultProps = {
  colors: null,
  height: "100%",
};

export default DotsChart;
