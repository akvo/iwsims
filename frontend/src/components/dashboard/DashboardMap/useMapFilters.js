import { useMemo, useState, useCallback, useEffect } from "react";

const isoDate = (d) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");

/**
 * Local state + derived geolocation query params for the dashboard
 * map widget. Filter state stays map-local (decision #7).
 *
 * Active filter resolution (decision #18):
 *   - The filter-mode dropdown picks WHICH select filter is active.
 *   - The first declared select filter is the default.
 *
 * Per-filter chip selection (decision #19):
 *   - selectedChips[filterKey] = Set<bucket_value> | null
 *   - null means "all chips selected" (the natural default; no
 *     narrowing). The hook lazily materialises the Set on the first
 *     deselect so subsequent toggles have a coherent baseline.
 *
 * @param {Array} itemFilters    item.filters[] from the map config
 * @param {Object} filterState   dashboard-level filter state
 * @returns {{
 *   activeKey: string | null,
 *   setActiveKey: (key: string) => void,
 *   activeFilter: Object | null,
 *   selectedChips: Object<string, Set<string> | null>,
 *   toggleChip: (filterKey: string, bucketValue: string,
 *                allBucketValues: string[]) => void,
 *   isChipSelected: (filterKey: string, bucketValue: string) => boolean,
 *   toggleValues: Object,
 *   setToggleValue: (key: string, next: boolean) => void,
 *   queryParams: URLSearchParams,
 *   toggleDisabled: boolean,
 * }}
 */
const useMapFilters = (itemFilters, filterState) => {
  const filters = useMemo(() => itemFilters || [], [itemFilters]);

  const selectFilters = useMemo(
    () => filters.filter((f) => f.type === "select"),
    [filters]
  );
  const toggleFilters = useMemo(
    () => filters.filter((f) => f.type === "toggle"),
    [filters]
  );

  const initialActiveKey = selectFilters[0]?.key || null;
  const [activeKey, setActiveKey] = useState(initialActiveKey);
  const [selectedChips, setSelectedChips] = useState({});

  // Reset active key if the configured filters change.
  useEffect(() => {
    if (activeKey && !selectFilters.find((f) => f.key === activeKey)) {
      setActiveKey(selectFilters[0]?.key || null);
    } else if (!activeKey && selectFilters[0]) {
      setActiveKey(selectFilters[0].key);
    }
  }, [selectFilters, activeKey]);

  // Reset chip selections when the widget config changes. Both dashboards
  // share the same map_main item id, so navigating between them reuses this
  // component instance — without a reset, the previous dashboard's chip
  // selections carry over into the new one.
  useEffect(() => {
    setSelectedChips({});
  }, [itemFilters]);

  const activeFilter = useMemo(
    () => selectFilters.find((f) => f.key === activeKey) || null,
    [selectFilters, activeKey]
  );

  const initialToggleValues = useMemo(() => {
    const out = {};
    toggleFilters.forEach((f) => {
      out[f.key] = Boolean(f.default);
    });
    return out;
  }, [toggleFilters]);

  const [toggleValues, setToggleValues] = useState(initialToggleValues);
  const setToggleValue = useCallback((key, next) => {
    setToggleValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  // Reset toggle values to config defaults on config change, for the same
  // reason as the chip reset above — a toggle turned off in dashboard A must
  // not persist into dashboard B where the config default is true.
  useEffect(() => {
    setToggleValues(initialToggleValues);
  }, [initialToggleValues]);

  const toggleChip = useCallback((filterKey, bucketValue, allBucketValues) => {
    setSelectedChips((prev) => {
      const current = prev[filterKey];
      const baseline =
        current === null || typeof current === "undefined"
          ? new Set(allBucketValues)
          : new Set(current);
      if (baseline.has(bucketValue)) {
        baseline.delete(bucketValue);
      } else {
        baseline.add(bucketValue);
      }
      return { ...prev, [filterKey]: baseline };
    });
  }, []);

  const isChipSelected = useCallback(
    (filterKey, bucketValue) => {
      const current = selectedChips[filterKey];
      if (current === null || typeof current === "undefined") {
        return true;
      }
      return current.has(bucketValue);
    },
    [selectedChips]
  );

  const toggleDisabled = Boolean(
    filterState?.from_date || filterState?.to_date
  );

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (!toggleDisabled) {
      toggleFilters.forEach((f) => {
        if (toggleValues[f.key] === true && f.rolling_months) {
          const today = new Date();
          const from = new Date(today);
          from.setMonth(from.getMonth() - f.rolling_months);
          params.set("from_date", isoDate(from));
          params.set("to_date", isoDate(today));
          params.set("include_monitoring", "true");
          const monFormId = selectFilters[0]?.form_id;
          if (monFormId) {
            params.set("monitoring_form_id", monFormId);
          }
        }
      });
    }
    return params;
  }, [toggleFilters, toggleValues, toggleDisabled, selectFilters]);

  return {
    activeKey,
    setActiveKey,
    activeFilter,
    selectedChips,
    toggleChip,
    isChipSelected,
    toggleValues,
    setToggleValue,
    queryParams,
    toggleDisabled,
  };
};

export default useMapFilters;
