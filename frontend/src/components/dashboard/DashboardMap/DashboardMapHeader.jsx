import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Select, Space, Switch, Tooltip } from "antd";
import getQuestionOptions from "./getQuestionOptions";

const DEFAULT_NO_INFO_LABEL = "No information available";

/**
 * Resolve the bucket entries (value, label, color) for a given
 * select filter — the chips users can click to narrow markers.
 * Includes the formula `default` bucket and the `_no_info` fallback
 * when present in the color_map.
 */
export const resolveBuckets = (filter) => {
  if (!filter) {
    return [];
  }
  const map = filter.color_map || {};
  const out = [];
  if (filter.formula) {
    (filter.formula.buckets || []).forEach((b) => {
      out.push({
        value: b.value,
        label: b.label,
        color: map[b.value] || "#1890ff",
      });
    });
    const fallback = filter.formula.default;
    if (fallback) {
      out.push({
        value: fallback.value,
        label: fallback.label,
        color: map[fallback.value] || "#1890ff",
      });
    }
  } else if (filter.question_id) {
    const opts = getQuestionOptions(filter.form_id, filter.question_id);
    opts.forEach((o) => {
      out.push({
        value: o.value,
        label: o.label,
        color: map[o.value] || "#1890ff",
      });
    });
  }
  if (map._no_info) {
    out.push({
      value: "_no_info",
      label: DEFAULT_NO_INFO_LABEL,
      color: map._no_info,
    });
  }
  return out;
};

/**
 * Header row for the dashboard map widget. Renders the title, a
 * single filter-mode Select (one option per declared select filter),
 * clickable legend chips for the active filter's buckets, and any
 * configured Switch toggles.
 */
const DashboardMapHeader = ({
  title,
  filters,
  activeKey,
  onActiveKeyChange,
  activeFilter,
  isChipSelected,
  onChipToggle,
  toggleValues,
  onToggleChange,
  toggleDisabled,
}) => {
  const selectFilters = useMemo(
    () => filters.filter((f) => f.type === "select"),
    [filters]
  );
  const toggleFilters = useMemo(
    () => filters.filter((f) => f.type === "toggle"),
    [filters]
  );

  const filterModeOptions = useMemo(
    () =>
      selectFilters.map((f) => ({
        value: f.key,
        label: f.label,
      })),
    [selectFilters]
  );

  const buckets = useMemo(() => resolveBuckets(activeFilter), [activeFilter]);
  const allBucketValues = useMemo(() => buckets.map((b) => b.value), [buckets]);

  if (!title && selectFilters.length === 0 && toggleFilters.length === 0) {
    return null;
  }

  return (
    <div className="dashboard-map-header">
      <Space>
        {title && <span className="dashboard-map-title">{title}</span>}
        {filterModeOptions.length > 0 && (
          <Select
            className="dashboard-map-filter-mode"
            style={{ minWidth: 200 }}
            value={activeKey || typeof activeKey === "undefined"}
            onChange={onActiveKeyChange}
            options={filterModeOptions}
          />
        )}
        {buckets.length > 0 && (
          <div className="dashboard-map-legend">
            {buckets.map((b) => {
              const selected = isChipSelected(activeFilter.key, b.value);
              return (
                <button
                  type="button"
                  key={b.value}
                  className={`legend-chip${
                    selected ? " is-selected" : " is-deselected"
                  }`}
                  onClick={() =>
                    onChipToggle(activeFilter.key, b.value, allBucketValues)
                  }
                  aria-pressed={selected}
                >
                  <span
                    className="legend-dot"
                    style={{ background: b.color }}
                  />
                  {b.label}
                </button>
              );
            })}
          </div>
        )}
      </Space>
      <div>
        {toggleFilters.map((f) => {
          const sw = (
            <Switch
              checked={Boolean(toggleValues[f.key]) && !toggleDisabled}
              disabled={toggleDisabled}
              onChange={(v) => onToggleChange(f.key, v)}
            />
          );
          return (
            <span className="dashboard-map-toggle" key={f.key}>
              {toggleDisabled ? (
                <Tooltip title="Cleared by date filter">{sw}</Tooltip>
              ) : (
                sw
              )}
              <span className="toggle-label">{f.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

DashboardMapHeader.propTypes = {
  title: PropTypes.string,
  filters: PropTypes.array.isRequired,
  activeKey: PropTypes.string,
  onActiveKeyChange: PropTypes.func.isRequired,
  activeFilter: PropTypes.object,
  isChipSelected: PropTypes.func.isRequired,
  onChipToggle: PropTypes.func.isRequired,
  toggleValues: PropTypes.object.isRequired,
  onToggleChange: PropTypes.func.isRequired,
  toggleDisabled: PropTypes.bool,
};

export default DashboardMapHeader;
