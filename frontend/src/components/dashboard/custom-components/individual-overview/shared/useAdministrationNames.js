import { useEffect, useState } from "react";
import { collectAdministrationIds, fetchAdministrationNames } from "./helpers";

/**
 * Resolve every administration-typed answer in `values` to a display name.
 *
 * Walks `values`, picks the ids whose corresponding question has
 * `type === "administration"`, and pre-fetches their names through
 * `fetchAdministrationNames` (process-wide cache). Returns an empty map
 * synchronously on first render and re-renders once the API resolves so
 * `<CharacteristicsTable>` can show "Fiji - Western - Ra - Saivou"
 * instead of "78".
 *
 * @param {Array} values  /data/<id> answer payload
 * @returns {Map<number,string>}
 */
const useAdministrationNames = (values) => {
  const [lookup, setLookup] = useState(() => new Map());

  useEffect(() => {
    const ids = collectAdministrationIds(values);
    if (ids.length === 0) {
      return () => {};
    }
    let cancelled = false;
    fetchAdministrationNames(ids).then((map) => {
      if (cancelled || map.size === 0) {
        return;
      }
      setLookup((prev) => {
        const next = new Map(prev);
        map.forEach((v, k) => {
          next.set(k, v);
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [values]);

  return lookup;
};

export default useAdministrationNames;
