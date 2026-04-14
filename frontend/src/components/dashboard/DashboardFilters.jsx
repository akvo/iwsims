import React, { useEffect, useMemo } from "react";
import { DatePicker, Select, Space } from "antd";
import PropTypes from "prop-types";
import AdministrationDropdown from "../filters/AdministrationDropdown";
import { store } from "../../lib";

const { RangePicker } = DatePicker;

/**
 * Look up a question's option[] by scanning `window.forms` (populated at app
 * startup) for the matching form_id, then walking its question groups.
 * Returns an empty array if the form, question, or its options aren't found.
 */
const extractOptionsFromWindow = (formId, questionId) => {
  const form = (window.forms || []).find((f) => f.id === Number(formId));
  const groups = form?.content?.question_group || [];
  for (let i = 0; i < groups.length; i += 1) {
    const q = (groups[i].question || []).find((x) => x.id === questionId);
    if (q) {
      return (q.option || []).map((o) => ({
        label: o.label,
        value: o.value,
      }));
    }
  }
  return [];
};

/**
 * Filter bar for the config-driven dashboard. Renders the three built-in
 * filters (date range, administration, custom) based on the config's
 * `filters` block. Hidden filters (`hide: true`) are skipped.
 *
 * The component is intentionally display-only: state and query-string
 * synthesis live in `useDashboardFilters` + `lib/dashboardFilterHints`.
 */
const DashboardFilters = ({ config, filters, onChange }) => {
  const dateCfg = config?.filters?.date;
  const adminCfg = config?.filters?.administration;
  const customDefs = useMemo(() => config?.filters?.custom || [], [config]);

  // Resolve option lists for each custom filter from window.forms (populated
  // at app startup). No extra fetch required.
  const customOptions = useMemo(() => {
    const out = {};
    customDefs.forEach((d) => {
      out[d.key] = extractOptionsFromWindow(d.form_id, d.question_id);
    });
    return out;
  }, [customDefs]);

  // AdministrationDropdown is the source of truth via `store.administration`
  // (an array of levels). It does NOT fire onChange on clear, so we subscribe
  // to the store instead and derive the deepest selected admin id ourselves.
  const adminPath = store.useState((s) => s.administration);
  const { setAdministrationId } = onChange;
  useEffect(() => {
    const deepest = (adminPath || [])
      .slice()
      .reverse()
      .find((level) => level?.id)?.id;
    setAdministrationId(deepest || null);
  }, [adminPath, setAdministrationId]);

  const handleDateChange = (_, dateStrings) => {
    const [from, to] = dateStrings || [];
    onChange.setDateRange(from || null, to || null);
  };

  const handleCustomChange = (key) => (value) => {
    onChange.setCustomFilter(key, value ?? null);
  };

  const customValue = (key) =>
    filters?.state?.custom?.find((c) => c.key === key)?.value;

  return (
    <Space wrap size="middle" align="center">
      {!dateCfg?.hide && (
        <RangePicker
          onChange={handleDateChange}
          allowEmpty={[true, true]}
          aria-label={dateCfg?.label || "Date range"}
        />
      )}
      {!adminCfg?.hide && <AdministrationDropdown withLabel />}
      {customDefs
        .filter((d) => !d.hide)
        .map((d) => (
          <Select
            key={d.key}
            allowClear
            placeholder={d.label}
            style={{ minWidth: 180 }}
            value={customValue(d.key)}
            onChange={handleCustomChange(d.key)}
            {...(d.type === "multiple_option" ? { mode: "multiple" } : {})}
            options={customOptions[d.key] || []}
          />
        ))}
    </Space>
  );
};

DashboardFilters.propTypes = {
  config: PropTypes.object.isRequired,
  filters: PropTypes.object.isRequired,
  onChange: PropTypes.shape({
    setDateRange: PropTypes.func.isRequired,
    setAdministrationId: PropTypes.func.isRequired,
    setCustomFilter: PropTypes.func.isRequired,
  }).isRequired,
};

export default DashboardFilters;
