import { useEffect, useState } from "react";
import { api } from "../../../lib";
import getCrossFormQuestionOptions from "./getCrossFormQuestionOptions";

/**
 * Fetches and caches the per-parent_id bucket value for the active
 * select filter. Both question-name and formula filters route to
 * /visualization/values/formula (decision #22):
 *   - formula filters pass the config JSON directly
 *   - question-name filters build an equivalent option_equals formula
 *     from the family's option list so the endpoint handles both modes
 *
 * Scope is always cross-form: options are unioned across the
 * registration family (the registration form `sourceFormId` plus its
 * monitoring forms) and the backend resolves the latest value per
 * parent across all of them — with a registration fallback — via
 * mv_cross_form_latest (passed as `parent_form_id`).
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

    let formula;
    if (activeFilter.formula) {
      formula = activeFilter.formula;
    } else if (activeFilter.question_name) {
      const options = getCrossFormQuestionOptions(
        sourceFormId,
        activeFilter.question_name
      );
      formula = {
        buckets: options.map((opt) => ({
          value: opt.value,
          label: opt.label,
          all_of: [
            {
              question_name: activeFilter.question_name,
              op: "option_equals",
              value: opt.value,
            },
          ],
        })),
        default: { value: "_no_info", label: "No info" },
      };
    } else {
      setByParent({});
      setLoading(false);
      return () => {};
    }

    const request = api.get("visualization/values/formula", {
      params: {
        parent_form_id: sourceFormId,
        group_by: "parent_id",
        monitoring: "latest",
        formula: JSON.stringify(formula),
        ...params,
      },
    });

    request
      .then((res) => {
        if (cancelled) {
          return;
        }
        const map = {};
        (res?.data?.data || []).forEach((row) => {
          map[row.group] = row.label;
        });
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
