import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../lib";

/**
 * Hook that drives the admin → datapoints → values fetch chain shared by
 * every Individual Overview shell.
 *
 * The `selectedLocation` is supplied by the caller (typically the parent
 * component's local `useState` fed by an embedded admin dropdown), so
 * this hook is location-agnostic and never reads the global Pullstate
 * `store.administration`. That keeps the embedded selection from
 * leaking into the dashboard-wide filter state.
 *
 * @param {object} options
 * @param {number} options.regFormId
 * @param {Array<number>} options.monitoringFormIds
 * @param {{ id: number } | null} [options.selectedLocation]
 *   Deepest admin level the caller wants to scope to. `null` (or missing
 *   `id`) clears the data-point list and selection.
 *
 * @returns {{
 *   loadingDataPoints: boolean,
 *   dataPoints: Array,
 *   selectedDataPoint: object|null,
 *   setSelectedDataPoint: (dp: object|null) => void,
 *   regValues: Array,
 *   monitoringValues: { [formId: number]: Array },
 *   loadingValues: boolean,
 *   refetch: () => void,
 * }}
 */
const useIndividualOverviewData = ({
  regFormId,
  monitoringFormIds,
  selectedLocation,
}) => {
  const [dataPoints, setDataPoints] = useState([]);
  const [loadingDataPoints, setLoadingDataPoints] = useState(false);
  const [selectedDataPoint, setSelectedDataPointState] = useState(null);
  const [regValues, setRegValues] = useState([]);
  const [monitoringValues, setMonitoringValues] = useState({});
  const [loadingValues, setLoadingValues] = useState(false);
  const [refetchToken, setRefetchToken] = useState(0);

  const monitoringIdsKey = useMemo(
    () => (monitoringFormIds || []).join(","),
    [monitoringFormIds]
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setSelectedDataPoint = useCallback((dp) => {
    setSelectedDataPointState(dp || null);
  }, []);

  const refetch = useCallback(() => {
    setRefetchToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!regFormId || !selectedLocation?.id) {
      setDataPoints([]);
      setSelectedDataPointState(null);
      return;
    }
    let cancelled = false;
    setLoadingDataPoints(true);
    (async () => {
      try {
        const { data: apiData } = await api.get(
          `/form-data/${regFormId}?administration=${selectedLocation.id}&sort_by=latest_activity&sort_type=descend`
        );
        if (cancelled || !mountedRef.current) {
          return;
        }
        setDataPoints(apiData?.data || []);
        setSelectedDataPointState(null);
      } catch (error) {
        if (cancelled || !mountedRef.current) {
          return;
        }
        console.error(
          "useIndividualOverviewData: dataPoints fetch failed",
          error
        );
        setDataPoints([]);
      } finally {
        if (!cancelled && mountedRef.current) {
          setLoadingDataPoints(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [regFormId, selectedLocation?.id, refetchToken]);

  useEffect(() => {
    if (!selectedDataPoint?.id || !selectedDataPoint?.uuid) {
      setRegValues([]);
      setMonitoringValues({});
      return;
    }
    let cancelled = false;
    const ids = (monitoringIdsKey ? monitoringIdsKey.split(",") : [])
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));

    setLoadingValues(true);
    (async () => {
      try {
        const regPromise = api
          .get(`/data/${selectedDataPoint.id}`)
          .then(({ data }) => data || [])
          .catch((error) => {
            console.error(
              "useIndividualOverviewData: regValues fetch failed",
              error
            );
            return [];
          });

        const monitoringPromise = Promise.all(
          ids.map(async (formId) => {
            try {
              const { data: list } = await api.get(
                `/form-data/${formId}?parent=${selectedDataPoint.uuid}`
              );
              const latest = list?.data?.[0];
              if (!latest?.id) {
                return [formId, []];
              }
              const { data: payload } = await api.get(`/data/${latest.id}`);
              return [formId, payload || []];
            } catch (error) {
              console.error(
                `useIndividualOverviewData: monitoringValues fetch failed (form ${formId})`,
                error
              );
              return [formId, []];
            }
          })
        );

        const [reg, monitoringEntries] = await Promise.all([
          regPromise,
          monitoringPromise,
        ]);
        if (cancelled || !mountedRef.current) {
          return;
        }
        setRegValues(reg);
        setMonitoringValues(Object.fromEntries(monitoringEntries));
      } finally {
        if (!cancelled && mountedRef.current) {
          setLoadingValues(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedDataPoint?.id,
    selectedDataPoint?.uuid,
    monitoringIdsKey,
    refetchToken,
  ]);

  return {
    loadingDataPoints,
    dataPoints,
    selectedDataPoint,
    setSelectedDataPoint,
    regValues,
    monitoringValues,
    loadingValues,
    refetch,
  };
};

export default useIndividualOverviewData;
