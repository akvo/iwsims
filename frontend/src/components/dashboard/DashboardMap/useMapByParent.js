import { useEffect, useState } from "react";
import { api } from "../../../lib";

/**
 * Fetches and caches the per-parent_id bucket value for the active
 * select filter. Routes question-id filters to /visualization/values
 * and formula filters to /visualization/values/formula. Both produce
 * the same response shape: { data: [{ group, label }] }.
 *
 * @param {{
 *   activeFilter: Object | null,
 *   filterState: Object,
 * }} args
 * @returns {{ byParent: Object, loading: boolean, error: any }}
 */
const useMapByParent = ({ activeFilter, filterState }) => {
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
      request = api.get("visualization/values/formula", {
        params: {
          form_id: activeFilter.form_id,
          group_by: "parent_id",
          monitoring: "latest",
          formula: JSON.stringify(activeFilter.formula),
          ...params,
        },
      });
    } else if (activeFilter.question_id) {
      request = api.get("visualization/values", {
        params: {
          form_id: activeFilter.form_id,
          question_id: activeFilter.question_id,
          group_by: "parent_id",
          monitoring: "latest",
          ...params,
        },
      });
    } else {
      setByParent({});
      setLoading(false);
      return () => {};
    }

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
  }, [activeFilter, filterState]);

  return { byParent, loading, error };
};

export default useMapByParent;
