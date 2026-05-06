import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../lib";
import { findAnswer } from "./helpers";

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
 * @param {number|null} [dateQuestionId]        When provided, the answer for
 *   this question id is used as the row date instead of FormData.created.
 *   Falls back to FormData.created when the answer is absent.
 *
 * @returns {{
 *   rows: Array<{ id: number, date: string|null, values: Array }>,
 *   loading: boolean,
 *   error: Error|null,
 * }}
 */
const useMonitoringHistory = (formId, parentUuid, dateQuestionId) => {
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
              const dateAnswer = dateQuestionId
                ? findAnswer(values || [], dateQuestionId)
                : null;
              const rawDate =
                dateAnswer?.value || entry.created || entry.updated || null;
              // Trim ISO datetimes (e.g. "2026-02-24T02:16:00.000Z") to
              // date-only ("2026-02-24") so x-axis labels stay compact.
              const date =
                typeof rawDate === "string" && rawDate.length > 10
                  ? rawDate.slice(0, 10)
                  : rawDate;
              return {
                id: entry.id,
                date,
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
  }, [formId, parentUuid, dateQuestionId]);

  return { rows, loading, error };
};

export default useMonitoringHistory;
