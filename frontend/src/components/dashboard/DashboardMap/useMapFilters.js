import { useMemo, useState, useCallback } from "react";

/**
 * Local state + derived geolocation query params for the dashboard
 * map widget. Filter values stay map-local (per design decision #7);
 * they do not propagate to other dashboard widgets.
 *
 * @param {Array} itemFilters    item.filters[] from the map config
 * @param {Object} filterState   dashboard-level filter state
 * @returns {{
 *   values: Object,
 *   setValue: (key: string, next: any) => void,
 *   queryParams: URLSearchParams,
 *   toggleDisabled: boolean,
 *   activeFilter: Object | null,
 * }}
 */
const useMapFilters = (itemFilters, filterState) => {
  const filters = useMemo(() => itemFilters || [], [itemFilters]);

  const initialValues = useMemo(() => {
    const out = {};
    filters.forEach((f) => {
      if (f.type === "toggle") {
        out[f.key] = Boolean(f.default);
      } else {
        out[f.key] = null;
      }
    });
    return out;
  }, [filters]);

  const [values, setValues] = useState(initialValues);
  const [lastChangedKey, setLastChangedKey] = useState(null);

  const setValue = useCallback((key, next) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    setLastChangedKey(key);
  }, []);

  const toggleDisabled = Boolean(
    filterState?.from_date || filterState?.to_date
  );

  const activeFilter = useMemo(() => {
    if (!filters.length) {
      return null;
    }
    const selectFilters = filters.filter((f) => f.type === "select");
    if (!selectFilters.length) {
      return null;
    }
    if (lastChangedKey) {
      const last = selectFilters.find((f) => f.key === lastChangedKey);
      if (last) {
        return last;
      }
    }
    return selectFilters[0];
  }, [filters, lastChangedKey]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    const criteria = [];
    filters.forEach((f) => {
      if (f.type === "select" && f.question_id) {
        const v = values[f.key];
        if (v !== null && typeof v !== "undefined" && v !== "") {
          criteria.push(`option_equals:${f.question_id}:${v}`);
        }
      }
    });
    if (criteria.length > 0) {
      params.set("criteria", criteria.join(","));
    }
    if (!toggleDisabled) {
      filters.forEach((f) => {
        if (f.type === "toggle" && values[f.key] === true && f.rolling_months) {
          const today = new Date();
          const from = new Date(today);
          from.setMonth(from.getMonth() - f.rolling_months);
          const isoDate = (d) => d.toISOString().slice(0, 10);
          params.set("from_date", isoDate(from));
          params.set("to_date", isoDate(today));
          params.set("include_monitoring", "true");
        }
      });
    }
    return params;
  }, [filters, values, toggleDisabled]);

  return { values, setValue, queryParams, toggleDisabled, activeFilter };
};

export default useMapFilters;
