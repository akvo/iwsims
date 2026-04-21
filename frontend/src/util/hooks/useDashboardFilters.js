import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * @typedef {Object} DashboardFilterState
 * @property {string|null} from_date       ISO YYYY-MM-DD, inclusive lower bound
 * @property {string|null} to_date         ISO YYYY-MM-DD, inclusive upper bound
 * @property {number|null} administration_id
 * @property {Array<{ key: string, value: string|number|null }>} custom
 */

/**
 * Extract the custom filter items from the flat items tree.
 * A custom filter item has chart_type starting with "filter_" but is NOT
 * filter_date or filter_administration.
 *
 * @param {Array} items  config.items (top-level flat array)
 * @returns {Array}      flat list of filter_option / filter_multi_option items
 */
const extractCustomFilterItems = (items = []) => {
  const result = [];
  items.forEach((item) => {
    if (
      item.chart_type === "filter_option" ||
      item.chart_type === "filter_multi_option"
    ) {
      result.push(item);
    }
    // Recurse into containers
    if (Array.isArray(item.items)) {
      result.push(...extractCustomFilterItems(item.items));
    }
  });
  return result;
};

/**
 * Initial state derived from the dashboard config's flat items array.
 * Defaults everything to null / empty so no filter params are emitted
 * until the user selects one.
 *
 * @param {object} config
 * @returns {DashboardFilterState}
 */
const buildInitialState = (config) => {
  const customItems = extractCustomFilterItems(config?.items || []);
  return {
    from_date: null,
    to_date: null,
    administration_id: null,
    custom: customItems.map((d) => ({ key: d.key, value: null })),
  };
};

/**
 * Manages filter state for one dashboard page. Filter mutations trigger
 * identity changes on the returned `queryParams` object, which downstream
 * useDashboardValues/Escalation/Progress hooks can depend on to re-fetch.
 *
 * @param {object} config
 * @returns {{
 *   state: DashboardFilterState,
 *   setDateRange: (from: string|null, to: string|null) => void,
 *   setAdministrationId: (id: number|null) => void,
 *   setCustomFilter: (key: string, value: string|number|null) => void,
 *   resetFilters: () => void,
 *   queryParams: object,
 * }}
 */
export const useDashboardFilters = (config) => {
  const [state, setState] = useState(() => buildInitialState(config));

  // Re-initialize when the dashboard config changes (e.g. route swap to a
  // different formId). `useState` only runs its initializer on first mount,
  // so without this effect the previous dashboard's custom filter shape
  // and values would persist across formId transitions.
  const lastInitKeyRef = useRef(null);
  useEffect(() => {
    const key = config?.parent_form_id ?? null;
    if (key === lastInitKeyRef.current) {
      return;
    }
    lastInitKeyRef.current = key;
    setState(buildInitialState(config));
  }, [config]);

  const setDateRange = useCallback((from, to) => {
    setState((s) => ({ ...s, from_date: from, to_date: to }));
  }, []);

  const setAdministrationId = useCallback((id) => {
    setState((s) =>
      s.administration_id === id ? s : { ...s, administration_id: id }
    );
  }, []);

  const setCustomFilter = useCallback((key, value) => {
    setState((s) => ({
      ...s,
      custom: s.custom.map((entry) =>
        entry.key === key ? { ...entry, value } : entry
      ),
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setState(buildInitialState(config));
  }, [config]);

  /**
   * Snapshot of filter state as a plain object suitable for
   * `applyDashboardFilters` in lib/dashboardFilterHints. Stable identity
   * as long as state hasn't changed.
   */
  const queryParams = useMemo(
    () => ({
      from_date: state.from_date,
      to_date: state.to_date,
      administration_id: state.administration_id,
      custom: state.custom,
    }),
    [state]
  );

  return {
    state,
    setDateRange,
    setAdministrationId,
    setCustomFilter,
    resetFilters,
    queryParams,
  };
};

export default useDashboardFilters;
