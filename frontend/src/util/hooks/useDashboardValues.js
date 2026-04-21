import { useMemo } from "react";
import {
  expandApiHints,
  applyDashboardFilters,
} from "../../lib/dashboardFilterHints";
import useVisualizationRequest from "./useVisualizationRequest";

/**
 * GET /api/v1/visualization/values for a KPI or chart api block.
 *
 * Resolves frontend hints (`rolling_months`, `fiscal_year`, `past_due`),
 * merges dashboard-level filter state (date range, administration,
 * custom filters), and re-fetches whenever the resulting params change.
 *
 * @param {object|null} apiBlock         The `api` block from config.kpis[x] / config.charts[x]
 * @param {object}      filterState      Output of useDashboardFilters.queryParams
 * @param {object}      [options]
 * @param {Date}        [options.today]
 * @param {number}      [options.fiscalYearStartMonth]
 * @param {object[]}    [options.customFilterDefs]  config.filters.custom
 * @param {boolean}     [options.enabled]           Skip fetch when false
 * @returns {{ data, loading, error, refetch }}
 */
export const useDashboardValues = (apiBlock, filterState, options = {}) => {
  const {
    today,
    fiscalYearStartMonth,
    customFilterDefs = [],
    enabled = true,
  } = options;

  const params = useMemo(() => {
    if (!apiBlock || !enabled) {
      return null;
    }
    const expanded = expandApiHints(apiBlock, { today, fiscalYearStartMonth });
    return applyDashboardFilters(expanded, filterState, customFilterDefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    apiBlock,
    filterState,
    enabled,
    today,
    fiscalYearStartMonth,
    customFilterDefs,
  ]);

  return useVisualizationRequest(
    params ? "visualization/values" : null,
    params
  );
};

export default useDashboardValues;
