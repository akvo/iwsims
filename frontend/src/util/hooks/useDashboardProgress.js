import { useMemo } from "react";
import { applyDashboardFilters } from "../../lib/dashboardFilterHints";
import useVisualizationRequest from "./useVisualizationRequest";

/**
 * Serialize progress components into `{key}:{formula}:{qid1}:{qid2}...[:{total_items}]`,
 * comma-separated. Hidden components are skipped.
 */
export const serializeComponents = (components = []) =>
  components
    .filter((c) => !c.hide)
    .map((c) => {
      const base = `${c.key}:${c.formula}:${(c.question_ids || []).join(":")}`;
      return c.formula === "multi_select_proportion" && c.total_items
        ? `${base}:${c.total_items}`
        : base;
    })
    .join(",");

/**
 * GET /api/v1/visualization/progress/{parent_form_id}
 *
 * @param {object|null} progressBlock   e.g. config.progress.construction
 * @param {object}       filterState    useDashboardFilters.queryParams
 * @param {{ enabled?: boolean }} [options]
 * @returns {{ data, loading, error, refetch }}
 */
export const useDashboardProgress = (
  progressBlock,
  filterState,
  options = {}
) => {
  const { enabled = true, customFilterDefs = [] } = options;

  const endpoint = useMemo(() => {
    if (!progressBlock || !enabled) {
      return null;
    }
    const formId = progressBlock?.api?.form_id;
    return formId ? `visualization/progress/${formId}` : null;
  }, [progressBlock, enabled]);

  const params = useMemo(() => {
    if (!progressBlock || !enabled) {
      return null;
    }
    const { monitoring_form_id, filter_question_id, filter_option_value } =
      progressBlock.api || {};

    const out = {
      monitoring_form_id,
      filter_question_id,
      filter_option_value,
      components: serializeComponents(progressBlock.components || []),
    };

    if (progressBlock.deadline_question_id) {
      out.deadline_question_id = progressBlock.deadline_question_id;
    }

    if (filterState?.from_date) {
      out.from_date = filterState.from_date;
    }
    if (filterState?.to_date) {
      out.to_date = filterState.to_date;
    }
    if (filterState?.administration_id) {
      out.administration_id = filterState.administration_id;
    }
    // Fold in multi-criteria custom filters (applyDashboardFilters
    // reads form_id from `out` to decide which defs to include).
    const withCriteria = applyDashboardFilters(
      { ...out, form_id: progressBlock.api?.form_id },
      filterState,
      customFilterDefs
    );
    if (withCriteria.criteria) {
      out.criteria = withCriteria.criteria;
    }
    return out;
  }, [progressBlock, filterState, enabled, customFilterDefs]);

  return useVisualizationRequest(endpoint, params);
};

export default useDashboardProgress;
