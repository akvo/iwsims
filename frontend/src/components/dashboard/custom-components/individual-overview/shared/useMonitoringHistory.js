import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../lib";

const PAGE_SIZE = 20;

const fetchAllPages = async (formId, parentUuid) => {
  const collected = [];
  const fetchPage = async (page) => {
    const { data } = await api.get(
      `/form-data/${formId}?parent=${parentUuid}&page=${page}&page_size=${PAGE_SIZE}&sort_by=latest_activity&sort_type=descend`
    );
    const rows = data?.data || [];
    collected.push(...rows);
    const total = data?.total ?? collected.length;
    if (rows.length === PAGE_SIZE && collected.length < total) {
      await fetchPage(page + 1);
    }
  };
  await fetchPage(1);
  return collected;
};

/**
 * Fetch all monitoring submissions for a parent record, plus their answer
 * payloads. Charts then project per-parameter without extra calls.
 *
 * @param {number} formId
 * @param {string|null|undefined} parentUuid    Falsy disables the fetch.
 *
 * @returns {{
 *   rows: Array<{ id: number, date: string|null, values: Array }>,
 *   loading: boolean,
 *   error: Error|null,
 * }}
 */
const useMonitoringHistory = (formId, parentUuid) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!formId || !parentUuid) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const list = await fetchAllPages(formId, parentUuid);
        const detail = await Promise.all(
          list.map(async (entry) => {
            try {
              const { data: values } = await api.get(`/data/${entry.id}`);
              return {
                id: entry.id,
                date:
                  entry.created || entry.updated || entry.submitted_at || null,
                values: values || [],
              };
            } catch (err) {
              console.error(
                `useMonitoringHistory: /data/${entry.id} failed`,
                err
              );
              return { id: entry.id, date: null, values: [] };
            }
          })
        );
        if (cancelled || !mountedRef.current) {
          return;
        }
        setRows(detail);
      } catch (err) {
        if (cancelled || !mountedRef.current) {
          return;
        }
        console.error("useMonitoringHistory: list fetch failed", err);
        setError(err);
        setRows([]);
      } finally {
        if (!cancelled && mountedRef.current) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId, parentUuid]);

  return { rows, loading, error };
};

export default useMonitoringHistory;
