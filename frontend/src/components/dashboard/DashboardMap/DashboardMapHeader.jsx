import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Select, Space, Switch, Tooltip } from "antd";
import getCrossFormQuestionOptions from "./getCrossFormQuestionOptions";
import resolveColorMap, { DEFAULT_BUCKET_COLOR } from "./resolveColorMap";

const DEFAULT_NO_INFO_LABEL = "No information available";

/**
 * Resolve the bucket entries (value, label, color) for a given
 * select filter — the chips users can click to narrow markers.
 * Includes the formula `default` bucket and an always-present
 * `_no_info` fallback.
 *
 * For question_name filters, options are resolved cross-form across the
 * registration family rooted at `sourceFormId` (matching
 * useMapByParent's scope). Colours default to each option's `color` and
 * are overridden per-value by the filter's `color_map` (see
 * resolveColorMap).
 */
export const resolveBuckets = (filter, sourceFormId) => {
  if (!filter) {
    return [];
  }
  const colorMap = resolveColorMap(filter, sourceFormId);
  const out = [];
  if (filter.formula) {
    (filter.formula.buckets || []).forEach((b) => {
      out.push({
        value: b.value,
        label: b.label,
        color: colorMap[b.value] || DEFAULT_BUCKET_COLOR,
      });
    });
    const fallback = filter.formula.default;
    if (fallback) {
      out.push({
        value: fallback.value,
        label: fallback.label,
        color: colorMap[fallback.value] || DEFAULT_BUCKET_COLOR,
      });
    }
  } else if (filter.question_name) {
    const opts = getCrossFormQuestionOptions(
      sourceFormId,
      filter.question_name
    );
    opts.forEach((o) => {
      out.push({
        value: o.value,
        label: o.label,
        color: colorMap[o.value] || DEFAULT_BUCKET_COLOR,
      });
    });
  }
  if (!out.some((b) => b.value === "_no_info")) {
    out.push({
      value: "_no_info",
      label: DEFAULT_NO_INFO_LABEL,
      color: colorMap._no_info,
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
  sourceFormId,
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

  const buckets = useMemo(
    () => resolveBuckets(activeFilter, sourceFormId),
    [activeFilter, sourceFormId]
  );
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
  sourceFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
};

export default DashboardMapHeader;
