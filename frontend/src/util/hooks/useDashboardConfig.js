import { useMemo } from "react";
import { getVisualizationConfig } from "../../config/visualizations";

/**
 * @typedef {Object} DashboardTab
 * @property {string} key
 * @property {string} label
 * @property {boolean} [hide]
 */

/**
 * @typedef {Object} DashboardApiBlock
 * @property {number} form_id
 * @property {number} [question_id]
 * @property {string} [option_value]
 * @property {"latest"|"all"} [monitoring]
 * @property {"id"|"parent_id"} [sum_by]
 * @property {"date"|"month"|"id"|"parent_id"|"option"} [group_by]
 * @property {"option"|"parent_id"} [stack_by]
 * @property {"number"|"percentage"} [value_type]
 * @property {"average"|"sum"|"max"|"min"|"last"} [repeat_agg]
 * @property {number} [date_question_id]
 * @property {string} [from_date]
 * @property {string} [to_date]
 * @property {number} [administration_id]
 * @property {number} [rolling_months]  Frontend hint: expand to from_date=today-N, to_date=today.
 * @property {boolean} [fiscal_year]    Frontend hint: expand to current fiscal year range.
 * @property {boolean} [past_due]       Frontend hint: expand to to_date=today-1 with completion/deadline params.
 * @property {number} [completion_question_id]
 * @property {number} [deadline_question_id]
 */

/**
 * @typedef {Object} DashboardKpi
 * @property {string} label
 * @property {string} [description]
 * @property {string} [color]
 * @property {boolean} [hide]
 * @property {DashboardApiBlock} api
 */

/**
 * @typedef {Object} DashboardChart
 * @property {"bar"|"doughnut"|"line"|"pie"|"stack_bar"} chart_type
 * @property {boolean} [hide]
 * @property {object} config
 * @property {DashboardApiBlock} [api]
 * @property {object} [raw_config]     Passed through to akvo-charts for ECharts-level overrides.
 * @property {"progress"} [source]     Cross-reference into config.progress.
 * @property {string} [progress_ref]
 * @property {"compliance"} [compute]  Frontend-computed chart.
 * @property {string} [compliance_params_ref]
 */

/**
 * @typedef {Object} DashboardConfig
 * @property {number} parent_form_id
 * @property {string} name
 * @property {string} [description]
 * @property {DashboardTab[]} tabs
 * @property {object} filters
 * @property {Object.<string, DashboardKpi>} kpis
 * @property {Object.<string, DashboardChart>} charts
 * @property {object} water_quality
 * @property {object} progress
 * @property {object} escalation
 * @property {object} map
 * @property {object} layout
 */

/**
 * Loads the dashboard config for a given form id.
 * Configs are bundled at build time from `src/config/visualizations/`.
 *
 * @param {number|string} formId
 * @returns {{ config: DashboardConfig|null, loading: boolean, error: Error|null }}
 */
export const useDashboardConfig = (formId) => {
  return useMemo(() => {
    if (!formId) {
      return { config: null, loading: false, error: null };
    }

    const config = getVisualizationConfig(formId);
    if (!config) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useDashboardConfig] no config registered for formId=${formId}`
      );
      return { config: null, loading: false, error: null };
    }

    return { config, loading: false, error: null };
  }, [formId]);
};

export default useDashboardConfig;
