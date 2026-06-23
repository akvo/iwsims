import { useEffect, useState } from "react";
import { api } from "../../../lib";

/**
 * Fetches and caches the active select filter's per-parent_id value(s).
 * In all cases `byParent[parent_id]` is an ARRAY of values so a datapoint
 * that selected several options (multiple_option, e.g. two disinfection
 * techniques) keeps every value for a segmented marker:
 *
 *   - question_name filters → GET /visualization/values
 *     (?question_name&group_by=parent_id&parent_form_id) returns the
 *     latest option array per parent across the family (single-option →
 *     a 1-element array).
 *   - formula filters → GET /visualization/values/formula returns one
 *     bucket per parent, wrapped into a 1-element array.
 *
 * Scope is always cross-form, scoped to the registration family via
 * `parent_form_id = sourceFormId` (mv_cross_form_latest).
 *
 * @param {{
 *   activeFilter: Object | null,
 *   filterState: Object,
 *   sourceFormId: number | undefined,
 * }} args
 * @returns {{ byParent: Object, loading: boolean, error: any }}
 */
const useMapByParent = ({ activeFilter, filterState, sourceFormId }) => {
  const [byParent, setByParent] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activeFilter) {
      setByParent({});
      setLoading(false);
      setError(null);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = {};
    if (filterState?.from_date) {
      params.from_date = filterState.from_date;
    }
    if (filterState?.to_date) {
      params.to_date = filterState.to_date;
    }

    let request;
    if (activeFilter.formula) {
      // Formula filter: one bucket value per parent → wrap into an array.
      request = api
        .get("visualization/values/formula", {
          params: {
            parent_form_id: sourceFormId,
            group_by: "parent_id",
            monitoring: "latest",
            formula: JSON.stringify(activeFilter.formula),
            ...params,
          },
        })
        .then((res) => {
          const map = {};
          (res?.data?.data || []).forEach((row) => {
            map[row.group] = [row.label];
          });
          return map;
        });
    } else if (activeFilter.question_name) {
      // Option filter: the cross-form values endpoint returns the latest
      // selected option array per parent (multiple_option keeps all).
      request = api
        .get("visualization/values", {
          params: {
            question_name: activeFilter.question_name,
            parent_form_id: sourceFormId,
            group_by: "parent_id",
            monitoring: "latest",
            ...params,
          },
        })
        .then((res) => {
          const map = {};
          (res?.data?.data || []).forEach((row) => {
            if (Array.isArray(row.value)) {
              map[row.group] = row.value;
            } else if (row.value !== null && typeof row.value !== "undefined") {
              map[row.group] = [row.value];
            } else {
              map[row.group] = [];
            }
          });
          return map;
        });
    } else {
      setByParent({});
      setLoading(false);
      return () => {};
    }

    request
      .then((map) => {
        if (cancelled) {
          return;
        }
        setByParent(map);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilter, filterState, sourceFormId]);

  return { byParent, loading, error };
};

export default useMapByParent;
