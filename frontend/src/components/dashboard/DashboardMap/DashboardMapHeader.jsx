import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Select, Switch, Tooltip } from "antd";
import getQuestionOptions from "./getQuestionOptions";

const DEFAULT_NO_INFO_LABEL = "No information available";

/**
 * Header row for the dashboard map widget. Renders the title,
 * configurable Select / Switch controls, and inline legend chips
 * driven by the active select filter's color_map.
 */
const DashboardMapHeader = ({
  title,
  filters,
  values,
  onChange,
  toggleDisabled,
  activeFilter,
}) => {
  const selectFilters = useMemo(
    () => filters.filter((f) => f.type === "select"),
    [filters]
  );
  const toggleFilters = useMemo(
    () => filters.filter((f) => f.type === "toggle"),
    [filters]
  );

  const selectOptions = useMemo(() => {
    const out = {};
    selectFilters.forEach((f) => {
      if (f.formula) {
        const buckets = (f.formula.buckets || []).map((b) => ({
          value: b.value,
          label: b.label,
        }));
        out[f.key] = buckets;
      } else if (f.question_id) {
        out[f.key] = getQuestionOptions(f.form_id, f.question_id);
      } else {
        out[f.key] = [];
      }
    });
    return out;
  }, [selectFilters]);

  const legendEntries = useMemo(() => {
    if (!activeFilter || !activeFilter.color_map) {
      return [];
    }
    const map = activeFilter.color_map;
    if (activeFilter.formula) {
      const buckets = activeFilter.formula.buckets || [];
      const fallback = activeFilter.formula.default;
      const entries = [];
      buckets.forEach((b) => {
        if (map[b.value]) {
          entries.push({ color: map[b.value], label: b.label });
        }
      });
      if (fallback && map[fallback.value]) {
        entries.push({
          color: map[fallback.value],
          label: fallback.label,
        });
      }
      return entries;
    }
    const opts = getQuestionOptions(
      activeFilter.form_id,
      activeFilter.question_id
    );
    const entries = [];
    opts.forEach((o) => {
      if (map[o.value]) {
        entries.push({ color: map[o.value], label: o.label });
      }
    });
    if (map._no_info) {
      entries.push({ color: map._no_info, label: DEFAULT_NO_INFO_LABEL });
    }
    return entries;
  }, [activeFilter]);

  if (!title && selectFilters.length === 0 && toggleFilters.length === 0) {
    return null;
  }

  return (
    <div className="dashboard-map-header">
      {title && <span className="dashboard-map-title">{title}</span>}
      {selectFilters.map((f) => (
        <Select
          key={f.key}
          allowClear
          placeholder={f.label}
          style={{ minWidth: 180 }}
          value={values[f.key] ?? undefined}
          onChange={(v) => onChange(f.key, v ?? null)}
          options={selectOptions[f.key] || []}
        />
      ))}
      {legendEntries.length > 0 && (
        <div className="dashboard-map-legend">
          {legendEntries.map(({ color, label }, i) => (
            <span className="legend-chip" key={`${label}-${i}`}>
              <span className="legend-dot" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
      {toggleFilters.map((f) => {
        const sw = (
          <Switch
            checked={Boolean(values[f.key]) && !toggleDisabled}
            disabled={toggleDisabled}
            onChange={(v) => onChange(f.key, v)}
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
  );
};

DashboardMapHeader.propTypes = {
  title: PropTypes.string,
  filters: PropTypes.array.isRequired,
  values: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  toggleDisabled: PropTypes.bool,
  activeFilter: PropTypes.object,
};

export default DashboardMapHeader;
