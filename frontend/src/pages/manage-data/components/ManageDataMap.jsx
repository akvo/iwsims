import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { unstable_batchedUpdates } from "react-dom";
import { Select, Space } from "antd";
import { takeRight, debounce } from "lodash";
import { scaleQuantize } from "d3-scale";
import { GradationLegend, MapView, MarkerLegend } from "../../../components";
import { api, store, uiText, geo, QUESTION_TYPES, config } from "../../../lib";
import { color } from "../../../util";
const { getBounds } = geo;
const { colorRange = [] } = config.mapConfig ?? {};

/**
 * Return the coarsest "nice" domainMax >= maxValue such that maxValue still
 * lands in the last scaleQuantize bucket.
 *
 * Policy: for n buckets, the last bucket starts at (n-1)/n * domainMax.
 * maxValue must satisfy: maxValue >= (n-1)/n * domainMax
 * => domainMax <= maxValue * n / (n-1)  (= 1.25 * maxValue for n=5)
 *
 * We search step sizes derived from the order-of-magnitude of maxValue
 * (e.g. for maxValue=21: magnitude=10, steps=[50, 25, 10, 5, 2.5, 1]).
 * The first (coarsest) step whose ceil-rounded candidate satisfies the
 * constraint is returned, giving the nicest possible round-number domain.
 */
const computeDomainMax = (maxValue) => {
  const n = colorRange.length;
  if (!Number.isFinite(maxValue) || maxValue <= 0 || n < 2) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(maxValue));
  for (const m of [5, 2.5, 1, 0.5, 0.25, 0.1]) {
    const step = magnitude * m;
    const candidate = Math.ceil(maxValue / step) * step;
    if (maxValue >= ((n - 1) / n) * candidate) {
      return candidate;
    }
  }
  return maxValue;
};

const buildColorScale = (domainMax) =>
  scaleQuantize().domain([0, domainMax]).range(colorRange);

const ManageDataMap = () => {
  const [loading, setLoading] = useState(true);
  const [geoDataset, setGeoDataset] = useState([]);
  const [statsByQuestion, setStatsByQuestion] = useState({});
  const [position, setPosition] = useState(null);
  const selectedForm = store.useState((s) => s.selectedForm);
  const [prevForm, setPrevForm] = useState(selectedForm);
  const [legendOptions, setLegendOptions] = useState([]);
  const [legendTitle, setLegendTitle] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [isNumeric, setIsNumeric] = useState(false);
  const [selectedLegendOption, setSelectedLegendOption] = useState(null);
  const [selectedGradationIndex, setSelectedGradationIndex] = useState(null);
  const [isLocationFetched, setIsLocationFetched] = useState(false);
  const fetchStatsRequestIdRef = useRef(0);
  const loadingTimerRef = useRef(null);
  const subscribeStateRef = useRef({ prevForm, isLocationFetched });
  const fetchStatsRef = useRef(null);

  useEffect(() => {
    subscribeStateRef.current = { prevForm, isLocationFetched };
  });

  const flashLoading = useCallback(() => {
    setLoading(true);
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    loadingTimerRef.current = setTimeout(() => {
      setLoading(false);
    }, 100);
  }, []);

  useEffect(() => {
    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
      }
    };
  }, []);

  const selectedAdm = store.useState((s) => s.administration);
  const { active: activeLang } = store.useState((s) => s.language);
  const text = useMemo(() => {
    return uiText[activeLang];
  }, [activeLang]);

  const mapForms = useMemo(() => {
    return window?.forms?.filter((f) => f.content?.parent === selectedForm);
  }, [selectedForm]);
  const [mapForm, setMapForm] = useState(mapForms?.[0]?.id);

  const mapQuestions = useMemo(() => {
    const f = window?.forms?.find((f) => f.id === mapForm);
    const registrationGroup = window?.forms?.find((f) => f.id === selectedForm);
    const groupQuestions =
      registrationGroup?.content?.question_group &&
      f?.content?.question_group?.length
        ? [
            ...registrationGroup.content.question_group.map((qg) => ({
              ...qg,
              formID: selectedForm,
            })),
            ...f.content.question_group,
          ]
        : f?.content?.question_group;
    return groupQuestions
      ?.map((qg) => ({
        label: qg?.label,
        options: qg?.question
          ?.filter((q) =>
            [
              QUESTION_TYPES.number,
              QUESTION_TYPES.option,
              QUESTION_TYPES.multiple_option,
            ].includes(q?.type)
          )
          ?.map((q) => ({
            label: q?.label,
            value: q?.id,
            type: q?.type,
            formID: qg?.formID || mapForm,
          })),
      }))
      ?.filter((qg) => qg?.options?.length > 0);
  }, [mapForm, selectedForm]);

  const handleQuestionSearch = (input, option) => {
    return option?.label?.toLowerCase().includes(input.toLowerCase());
  };

  // Merge immutable location records with per-question stats for the active question
  const activeStats = useMemo(() => {
    if (!activeQuestion || !statsByQuestion[activeQuestion]) {
      return geoDataset.map((d) => ({ ...d, hidden: false }));
    }
    const stats = statsByQuestion[activeQuestion];
    return geoDataset.map((d) => ({
      ...d,
      hidden: stats.hidden[d.id] ?? true,
      color: stats.color?.[d.id] ?? null,
      value: stats.value?.[d.id] ?? null,
      values: stats.values?.[d.id] ?? null,
    }));
  }, [geoDataset, activeQuestion, statsByQuestion]);

  // Derive color scale from the domainMax stored at fetch time so legend
  // thresholds always match the colors already assigned to data points.
  const colorScale = useMemo(() => {
    const domainMax =
      isNumeric && activeQuestion
        ? statsByQuestion[activeQuestion]?.domainMax ?? 1
        : 1;
    return buildColorScale(domainMax);
  }, [activeQuestion, isNumeric, statsByQuestion]);

  // Compute filtered dataset based on legend selections
  const filteredDataset = useMemo(() => {
    if (!selectedLegendOption && selectedGradationIndex === null) {
      return activeStats.filter((d) => !d.hidden);
    }

    return activeStats.filter((d) => {
      if (d.hidden) {
        return false;
      }

      if (selectedLegendOption) {
        if (d?.values?.length > 0) {
          return d.values.some(
            (v) =>
              v.value === selectedLegendOption.value ||
              v.color === selectedLegendOption.color
          );
        }
        return (
          d.value === selectedLegendOption.label ||
          d.color === selectedLegendOption.color
        );
      }

      if (selectedGradationIndex !== null) {
        return d.color === colorRange[selectedGradationIndex];
      }

      return true;
    });
  }, [activeStats, selectedLegendOption, selectedGradationIndex]);

  const handleMarkerLegendClick = (option) => {
    setSelectedLegendOption(option);
    setSelectedGradationIndex(null);
  };

  const handleGradationLegendClick = (index) => {
    setSelectedGradationIndex(index);
    setSelectedLegendOption(null);
  };

  const fetchStats = async (questionId, questionType, questionForm = null) => {
    const reqId = fetchStatsRequestIdRef.current + 1;
    fetchStatsRequestIdRef.current = reqId;
    try {
      const mapFormID = questionForm || mapForm;
      const apiURL = `/visualization/formdata-stats/${mapFormID}?question_id=${questionId}`;
      const { data: apiData } = await api.get(
        apiURL,
        {},
        "manage-data-map:stats"
      );
      if (reqId !== fetchStatsRequestIdRef.current) {
        return;
      }
      if (apiData?.data?.length === 0) {
        unstable_batchedUpdates(() => {
          setLegendOptions([]);
          setLegendTitle(null);
          setStatsByQuestion((prev) => ({
            ...prev,
            [questionId]: {
              hidden: Object.fromEntries(geoDataset.map((d) => [d.id, true])),
              color: {},
              value: {},
              values: {},
              domainMax: 1,
            },
          }));
          flashLoading();
        });
        return;
      }
      if (apiData?.options?.length === 0) {
        const numericValues =
          apiData?.data
            ?.map((item) => item.value)
            ?.filter((v) => typeof v === "number" && !isNaN(v) && v > 0) || [];

        const numericMax =
          numericValues.length > 0 ? Math.max(...numericValues) : null;
        const domainMax =
          numericMax !== null ? computeDomainMax(numericMax) : 1;
        const currentColorScale = buildColorScale(domainMax);

        const dataByID = Object.fromEntries(
          (apiData?.data || []).map((item) => [item.id, item])
        );
        const hiddenMap = {};
        const colorMap = {};
        const valueMap = {};
        geoDataset.forEach((d) => {
          const item = dataByID[d.id];
          hiddenMap[d.id] =
            typeof item?.value === "undefined" || item?.value === null;
          colorMap[d.id] =
            item?.value < 0 ? "#ffffff" : currentColorScale(item?.value);
          valueMap[d.id] = item?.value ?? null;
        });
        unstable_batchedUpdates(() => {
          setLegendOptions([]);
          setStatsByQuestion((prev) => ({
            ...prev,
            [questionId]: {
              hidden: hiddenMap,
              color: colorMap,
              value: valueMap,
              values: {},
              domainMax,
            },
          }));
          flashLoading();
        });
      } else {
        const dynamicColors = color.forMarker(apiData?.options?.length);
        const options = apiData?.options?.map((o, ox) => ({
          ...o,
          color: o?.color || dynamicColors[ox],
        }));
        const hiddenMap = {};
        const colorMap = {};
        const valueMap = {};
        const valuesMap = {};

        if (questionType === QUESTION_TYPES.multiple_option) {
          const groupedData = apiData?.data?.reduce((acc, item) => {
            if (item?.id in acc) {
              acc[item.id].push(item);
            } else {
              acc[item.id] = [item];
            }
            return acc;
          }, {});
          geoDataset.forEach((d) => {
            const dataValues = groupedData?.[d?.id]
              ?.map((item) => {
                const option = options?.find((o) => o?.id === item?.value);
                return {
                  color: option?.color,
                  value: option?.label,
                  hidden:
                    typeof item?.value === "undefined" || item?.value === null,
                };
              })
              ?.filter((v) => !v.hidden);
            hiddenMap[d.id] = !dataValues?.length;
            valuesMap[d.id] = dataValues || null;
          });
        } else {
          const singleDataByID = Object.fromEntries(
            (apiData?.data || []).map((item) => [item.id, item])
          );
          geoDataset.forEach((d) => {
            const optionID = singleDataByID[d.id]?.value;
            const option = options?.find((o) => o?.id === optionID);
            hiddenMap[d.id] =
              typeof optionID === "undefined" || optionID === null;
            colorMap[d.id] = option?.color ?? null;
            valueMap[d.id] = option?.label ?? null;
          });
        }

        unstable_batchedUpdates(() => {
          setLegendOptions(options);
          setStatsByQuestion((prev) => ({
            ...prev,
            [questionId]: {
              hidden: hiddenMap,
              color: colorMap,
              value: valueMap,
              values: valuesMap,
              domainMax: null,
            },
          }));
          flashLoading();
        });
      }
    } catch (error) {
      if (api.isCancel(error)) {
        return;
      }
      if (reqId !== fetchStatsRequestIdRef.current) {
        return;
      }
      console.error("Error fetching geolocation stats:", error);
    }
  };

  fetchStatsRef.current = fetchStats;

  const debouncedFetchStats = useMemo(
    () =>
      debounce((questionId, questionType, questionFormID) => {
        fetchStatsRef.current(questionId, questionType, questionFormID);
      }, 150),
    []
  );

  useEffect(() => {
    return () => {
      debouncedFetchStats.cancel();
    };
  }, [debouncedFetchStats]);

  const onMapFormChange = (value) => {
    fetchStatsRequestIdRef.current += 1;
    setMapForm(value);
    setActiveQuestion(null);
    setIsNumeric(false);
    setLegendOptions([]);
    setLegendTitle(null);
    setSelectedLegendOption(null);
    setSelectedGradationIndex(null);
    setStatsByQuestion({});
    flashLoading();
  };

  const onQuestionChange = (value) => {
    const q = mapQuestions
      ?.flatMap((m) => m?.options)
      ?.find((q) => q?.value === value);
    if (!q) {
      setLegendOptions([]);
      setLegendTitle(null);
      setActiveQuestion(null);
      setIsNumeric(false);
      setSelectedLegendOption(null);
      setSelectedGradationIndex(null);
      setStatsByQuestion({});
      return;
    }
    setLegendTitle(q?.label);
    setActiveQuestion(value);
    setIsNumeric(q?.type === QUESTION_TYPES.number);
    setSelectedLegendOption(null);
    setSelectedGradationIndex(null);
    debouncedFetchStats(value, q.type, q.formID);
  };

  const fetchData = useCallback(async () => {
    try {
      if (isLocationFetched) {
        return;
      }
      const adm = takeRight(selectedAdm, 1)[0];
      const apiURL = adm?.id
        ? `/maps/geolocation/${selectedForm}?administration=${adm.id}`
        : `/maps/geolocation/${selectedForm}`;
      const { data: apiData } = await api.get(
        apiURL,
        {},
        "manage-data-map:geo"
      );
      const isFormSwitch = prevForm !== selectedForm;
      const selected = [{ prop: adm?.level_name, value: adm?.name }];
      const pos = getBounds(selected);
      unstable_batchedUpdates(() => {
        if (isFormSwitch) {
          setPrevForm(selectedForm);
          setStatsByQuestion({});
        }
        setGeoDataset(
          apiData?.map((d) => ({ id: d.id, name: d.name, geo: d.geo }))
        );
        setIsLocationFetched(true);
        setPosition(pos);
        setMapForm(mapForms?.[0]?.id);
        flashLoading();
      });
    } catch (error) {
      if (api.isCancel(error)) {
        return;
      }
      setIsLocationFetched(true);
      setGeoDataset([]);
      setLoading(false);
    }
  }, [
    selectedAdm,
    prevForm,
    selectedForm,
    mapForms,
    isLocationFetched,
    flashLoading,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // listen selectForm changes to refetch data
  useEffect(() => {
    const unsubscribe = store.subscribe(
      ({ selectedForm, administration }) => ({ selectedForm, administration }),
      ({ selectedForm: sf, administration }) => {
        const { prevForm: pf, isLocationFetched: ilf } =
          subscribeStateRef.current;
        const isFormChanged = sf && sf !== pf;
        if ((isFormChanged || administration) && ilf) {
          fetchStatsRequestIdRef.current += 1;
          unstable_batchedUpdates(() => {
            if (isFormChanged) {
              setIsNumeric(false);
              setActiveQuestion(null);
              setLegendOptions([]);
              setLegendTitle(null);
              setSelectedLegendOption(null);
              setSelectedGradationIndex(null);
            }
            setIsLocationFetched(false);
          });
        }
      }
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="manage-data-map">
      <div className="map-filter">
        <Space direction="vertical" size="middle">
          <Select
            className="select-form"
            fieldNames={{ label: "name", value: "id" }}
            options={mapForms}
            placeholder={text.selectMonitoringFormPlaceholder}
            style={{ minWidth: 320 }}
            value={mapForm}
            onChange={onMapFormChange}
          />
          <Select
            className="select-question"
            options={mapQuestions}
            placeholder={text.selectQuestionPlaceholder}
            style={{ minWidth: 320 }}
            value={activeQuestion}
            onChange={onQuestionChange}
            onClear={() => {
              setSelectedLegendOption(null);
              setSelectedGradationIndex(null);
              onMapFormChange(mapForm);
            }}
            filterOption={handleQuestionSearch}
            showSearch
            allowClear
          />
        </Space>
      </div>
      <MapView
        dataset={filteredDataset}
        loading={loading}
        position={position}
      />
      {legendOptions.length > 0 && (
        <MarkerLegend
          title={legendTitle}
          options={legendOptions}
          onClick={handleMarkerLegendClick}
        />
      )}
      {isNumeric && (
        <GradationLegend
          title={legendTitle}
          thresholds={colorScale.thresholds()}
          onClick={handleGradationLegendClick}
        />
      )}
    </div>
  );
};

export default ManageDataMap;
