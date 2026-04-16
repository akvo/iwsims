import { useMemo } from "react";
import { applyDashboardFilters } from "../../lib/dashboardFilterHints";
import useVisualizationRequest from "./useVisualizationRequest";

/**
 * Serialize escalation criteria array into the colon-delimited format the
 * backend expects.
 *
 * option_equals:qid:value, threshold_gt:qid:value, threshold_lt:qid:value,
 * overdue:completion_qid:deadline_qid
 */
export const serializeCriteria = (criteria = []) =>
  criteria
    .filter((c) => !c.hide)
    .map((c) => {
      if (c.type === "overdue") {
        return `overdue:${c.completion_qid}:${c.deadline_qid}`;
      }
      return `${c.type}:${c.question_id}:${c.value}`;
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
      return `${c.key}:${c.source}:${c.question_id}`;
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
  } = options;

  const endpoint = useMemo(() => {
    if (!escalationBlock || !enabled) {
      return null;
    }
    const parentFormId = escalationBlock?.api?.form_id;
    return parentFormId ? `visualization/escalation/${parentFormId}` : null;
  }, [escalationBlock, enabled]);

  const params = useMemo(() => {
    if (!escalationBlock || !enabled) {
      return null;
    }
    const { monitoring_form_id, criteria = [] } = escalationBlock.api || {};

    const out = {
      monitoring_form_id,
      criteria: serializeCriteria(criteria),
      columns: serializeColumns(escalationBlock.columns || []),
      page,
      page_size: pageSize,
    };

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
      { form_id: escalationBlock.api?.form_id },
      filterState,
      customFilterDefs
    );
    if (withCriteria.criteria) {
      out.filter_criteria = withCriteria.criteria;
    }
    return out;
  }, [escalationBlock, filterState, page, pageSize, enabled, customFilterDefs]);

  return useVisualizationRequest(endpoint, params);
};

export default useDashboardEscalation;
