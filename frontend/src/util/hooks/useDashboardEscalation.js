import { useMemo } from "react";
import { applyDashboardFilters } from "../../lib/dashboardFilterHints";
import useVisualizationRequest from "./useVisualizationRequest";

/**
 * Serialize escalation criteria array into the colon-delimited format the
 * backend expects.
 *
 * option_equals:qid:value, threshold_gt:qid:value, threshold_lt:qid:value,
 * overdue:completion_qid:deadline_qid:incomplete_value:mode
 *
 * The 4th/5th overdue parts describe what "still incomplete" means: the value
 * (default "no") and the mode — "option" (default; the completion question
 * carries that option) or "lt" (numeric, e.g. project_completion_percentage
 * < 100). Both default so existing yes/no completion questions keep working.
 */
export const serializeCriteria = (criteria = []) =>
  criteria
    .filter((c) => !c.hide)
    .map((c) => {
      if (c.type === "overdue") {
        const incomplete = c.completion_incomplete_value ?? "no";
        const mode = c.completion_incomplete_op || "option";
        return (
          `overdue:${c.completion_qname}:${c.deadline_qname}` +
          `:${incomplete}:${mode}`
        );
      }
      return `${c.type}:${c.question_name}:${c.value}`;
    })
    .join(",");

/**
 * Serialize column defs into the backend format. Computed columns (no
 * backend source) are skipped — they are rendered client-side by joining
 * with /progress or filter-parameter responses.
 *
 * `key:parent_name`, `key:parent_answer:qid`, `key:administration`,
 * `key:answer:qid`, `key:latest_date:qid`
 */
export const serializeColumns = (columns = []) =>
  columns
    .filter((c) => !c.hide && !c.computed)
    .map((c) => {
      if (c.source === "parent_name" || c.source === "administration") {
        return `${c.key}:${c.source}`;
      }
      return `${c.key}:${c.source}:${c.question_name}`;
    })
    .join(",");

/**
 * GET /api/v1/visualization/escalation/{parent_form_id}
 *
 * @param {object|null} escalationBlock  e.g. config.escalation.monitoring
 * @param {object}       filterState     useDashboardFilters.queryParams
 * @param {{
 *   page?: number,
 *   pageSize?: number,
 *   enabled?: boolean,
 * }}                   [options]
 * @returns {{ data, loading, error, refetch }}
 */
export const useDashboardEscalation = (
  escalationBlock,
  filterState,
  options = {}
) => {
  const {
    page = 1,
    pageSize = 20,
    enabled = true,
    customFilterDefs = [],
    parentFormId,
  } = options;

  const endpoint = useMemo(() => {
    if (!escalationBlock || !enabled) {
      return null;
    }
    const resolvedParentFormId = escalationBlock?.api?.form_id || parentFormId;
    return resolvedParentFormId
      ? `visualization/escalation/${resolvedParentFormId}`
      : null;
  }, [escalationBlock, enabled, parentFormId]);

  const params = useMemo(() => {
    if (!escalationBlock || !enabled) {
      return null;
    }
    const {
      monitoring_form_id,
      criteria = [],
      order_by,
      order_dir,
    } = escalationBlock.api || {};

    const out = {
      criteria: serializeCriteria(criteria),
      columns: serializeColumns(escalationBlock.columns || []),
      page,
      page_size: pageSize,
    };
    // Sort by a `latest_date` column instead of insertion order — an
    // inspections feed is only a feed if it is chronological. Names a column
    // key from `columns`; the backend falls back to id ordering for anything
    // it cannot sort, so a stale key degrades quietly rather than erroring.
    if (order_by) {
      out.order_by = order_by;
      out.order_dir = order_dir || "desc";
    }
    // Optional: when omitted, the backend resolves the latest answer per
    // question across every monitoring form (cross-form escalation).
    if (monitoring_form_id) {
      out.monitoring_form_id = monitoring_form_id;
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
    // Fold in custom filters as AND-narrowing on top of the OR
    // escalation `criteria`. Emitted as `filter_criteria`.
    const withCriteria = applyDashboardFilters(
      { form_id: escalationBlock.api?.form_id || parentFormId },
      filterState,
      customFilterDefs
    );
    if (withCriteria.criteria) {
      out.filter_criteria = withCriteria.criteria;
    }
    return out;
  }, [
    escalationBlock,
    filterState,
    page,
    pageSize,
    enabled,
    customFilterDefs,
    parentFormId,
  ]);

  return useVisualizationRequest(endpoint, params);
};

export default useDashboardEscalation;
