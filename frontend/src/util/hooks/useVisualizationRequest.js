import { useEffect, useRef, useState, useCallback } from "react";
import api from "../../lib/api";

/**
 * Module-level cache keyed by serialized request. Values are
 * `{ promise, data, error, timestamp }`. In-flight requests share the same
 * promise so multiple widgets hitting the same endpoint don't duplicate work.
 *
 * Cache is NOT time-bounded — filters change the cache key, so stale entries
 * are naturally ignored. refetch() bypasses the cache explicitly.
 */
const cache = new Map();

const buildKey = (endpoint, params) => `${endpoint}?${JSON.stringify(params)}`;

const sendRequest = (endpoint, params) =>
  api.get(endpoint, { params }).then((res) => res.data);

/**
 * Generic visualization fetch hook. Reused by useDashboardValues,
 * useDashboardEscalation, useDashboardProgress.
 *
 * @param {string|null} endpoint  e.g. "visualization/values". null skips the fetch.
 * @param {object}       params   Plain object serialized into query string.
 * @returns {{ data, loading, error, refetch: () => void }}
 */
export const useVisualizationRequest = (endpoint, params) => {
  const [state, setState] = useState({
    data: null,
    loading: Boolean(endpoint),
    error: null,
  });
  const mountedRef = useRef(true);
  const keyRef = useRef(null);

  const key = endpoint ? buildKey(endpoint, params) : null;

  const run = useCallback(
    (bypassCache = false) => {
      if (!endpoint) {
        return;
      }
      const cacheKey = buildKey(endpoint, params);
      keyRef.current = cacheKey;

      const existing = cache.get(cacheKey);
      if (!bypassCache && existing && typeof existing.data !== "undefined") {
        setState({ data: existing.data, loading: false, error: null });
        return;
      }

      setState((s) => ({ ...s, loading: true, error: null }));

      let promise;
      if (!bypassCache && existing && existing.promise) {
        promise = existing.promise;
      } else {
        promise = sendRequest(endpoint, params);
        cache.set(cacheKey, { promise });
      }

      promise
        .then((data) => {
          cache.set(cacheKey, { data });
          if (mountedRef.current && keyRef.current === cacheKey) {
            setState({ data, loading: false, error: null });
          }
        })
        .catch((error) => {
          cache.delete(cacheKey);
          if (mountedRef.current && keyRef.current === cacheKey) {
            setState({ data: null, loading: false, error });
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, key]
  );

  useEffect(() => {
    mountedRef.current = true;
    run(false);
    return () => {
      mountedRef.current = false;
    };
  }, [run]);

  const refetch = useCallback(() => run(true), [run]);

  return { ...state, refetch };
};

/**
 * Test hook: clears the module cache. Exposed for unit tests only.
 */
export const __clearVisualizationCache = () => cache.clear();

export default useVisualizationRequest;
