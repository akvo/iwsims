import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Select, Space } from "antd";
import { takeRight } from "lodash";
import { scaleQuantize } from "d3-scale";
import { GradationLegend, MapView, MarkerLegend } from "../../../components";
import { api, store, uiText, geo, QUESTION_TYPES, config } from "../../../lib";
import { color } from "../../../util";
const { getBounds } = geo;

const ManageDataMap = () => {
  const [loading, setLoading] = useState(true);
  const [dataset, setDataset] = useState([]);
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

  // Calculate color scale based on numeric data values for shape coloring
  const colorScale = useMemo(() => {
    // Extract numeric values from dataset, filtering out null/undefined values
    const numericValues = dataset
      .map((d) => d.value)
      .filter((v) => typeof v === "number" && !isNaN(v) && v > 0);

    if (numericValues.length === 0 || !isNumeric || !dataset.length) {
      return scaleQuantize().domain([0, 1]).range(config.mapConfig.colorRange);
    }

    // Calculate domain based on actual data distribution
    const maxValue = Math.max(...numericValues);
    let domainMax = maxValue;

    if (maxValue <= 10) {
      // For small values, round up to the nearest 5 or 10
      domainMax = Math.ceil(maxValue / 5) * 5;
    } else if (maxValue <= 100) {
      // For medium values, round up to nearest 10
      domainMax = Math.ceil(maxValue / 10) * 10;
    } else {
      // For larger values, round up to nearest 50
      domainMax = Math.ceil(maxValue / 50) * 50;
    }
    return scaleQuantize()
      .domain([0, domainMax])
      .range(config.mapConfig.colorRange);
  }, [dataset, isNumeric]);

  // Compute filtered dataset based on legend selections
  const filteredDataset = useMemo(() => {
    if (!selectedLegendOption && selectedGradationIndex === null) {
      // No filters applied, return all non-hidden items
      return dataset.filter((d) => !d.hidden);
    }

    return dataset.filter((d) => {
      if (d.hidden) {
        return false;
      }

      if (selectedLegendOption) {
        // Filter by marker legend selection
        if (d?.values?.length > 0) {
          // For multiple option questions, check if any value matches the selected option
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
        // Filter by gradation legend selection
        const colorRange = config.mapConfig.colorRange;
        return d.color === colorRange[selectedGradationIndex];
      }

      return true;
    });
  }, [dataset, selectedLegendOption, selectedGradationIndex]);

  const handleMarkerLegendClick = (option) => {
    setSelectedLegendOption(option);
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 100);
    setSelectedGradationIndex(null); // Reset gradation selection
  };

  const handleGradationLegendClick = (index) => {
    setSelectedGradationIndex(index);
    setSelectedLegendOption(null); // Reset marker selection
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 100);
  };

  const fetchStats = async (questionId, questionType, questionForm = null) => {
    try {
      const mapFormID = questionForm || mapForm;
      const apiURL = `/visualization/formdata-stats/${mapFormID}?question_id=${questionId}`;
      const { data: apiData } = await api.get(apiURL);
      if (apiData?.data?.length === 0) {
        // Hide all markers if no data is available
        const _dataset = dataset.map((d) => ({
          ...d,
          hidden: true,
        }));
        setLegendOptions([]);
        setLegendTitle(null);
        setDataset(_dataset);
        setLoading(true);
        setTimeout(() => {
          setLoading(false);
        }, 100);
        return;
      }
      if (apiData?.options?.length === 0) {
        /**
         * Handle case where no options are available for the question
         * This can happen for questions like number or text where options are not defined
         * In this case, we will just set the dataset with the data from apiData
         * and reset the legend options and title
         */
        setLegendOptions([]);

        // Create color scale based on API data values for numeric questions
        const numericValues =
          apiData?.data
            ?.map((item) => item.value)
            ?.filter((v) => typeof v === "number" && !isNaN(v) && v > 0) || [];

        let currentColorScale;
        if (numericValues.length === 0) {
          currentColorScale = scaleQuantize()
            .domain([0, 1])
            .range(config.mapConfig.colorRange);
        } else {
          const maxValue = Math.max(...numericValues);
          let domainMax = maxValue;

          if (maxValue <= 10) {
            domainMax = Math.ceil(maxValue / 5) * 5;
          } else if (maxValue <= 100) {
            domainMax = Math.ceil(maxValue / 10) * 10;
          } else {
            domainMax = Math.ceil(maxValue / 50) * 50;
          }
          currentColorScale = scaleQuantize()
            .domain([0, domainMax])
            .range(config.mapConfig.colorRange);
        }

        const _dataset = dataset.map((d) => {
          const item = apiData?.data?.find((a) => a.id === d.id);
          return {
            ...d,
            ...item,
            hidden: typeof item?.value === "undefined" || item?.value === null,
            color: item?.value <= 0 ? "#FFF" : currentColorScale(item?.value),
            values: null, // Reset values for numeric questions
          };
        });
        setDataset(_dataset);
        setLoading(true);
        setTimeout(() => {
          setLoading(false);
        }, 100);
      } else {
        // Generate dynamic colors based on the number of options
        const dynamicColors = color.forMarker(apiData?.options?.length);
        const options = apiData?.options?.map((o, ox) => ({
          ...o,
          color: o?.color || dynamicColors[ox],
        }));
        setLegendOptions(options);
        const _dataset = dataset.map((d) => {
          if (questionType === QUESTION_TYPES.multiple_option) {
            const groupedData = apiData?.data?.reduce((acc, item) => {
              item?.id in acc
                ? acc[item.id].push(item)
                : (acc[item.id] = [item]);
              return acc;
            }, {});
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
            return {
              ...d,
              values: dataValues,
              hidden: dataValues?.length === 0,
            };
          }
          const optionID = apiData?.data?.find(
            (item) => item?.id === d?.id
          )?.value;
          const option = options?.find((o) => o?.id === optionID);
          return {
            ...d,
            values: null, // Reset values for single option questions
            color: option?.color,
            value: option?.label,
            hidden: typeof optionID === "undefined" || optionID === null,
          };
        });
        setDataset(_dataset);
        setLoading(true);
        setTimeout(() => {
          setLoading(false);
        }, 100);
      }
    } catch (error) {
      console.error("Error fetching geolocation stats:", error);
    }
  };

  const onMapFormChange = (value) => {
    setMapForm(value);
    setActiveQuestion(null);
    setLegendOptions([]);
    setLegendTitle(null);
    setSelectedLegendOption(null);
    setSelectedGradationIndex(null);
    const resetDataset = dataset.map((d) => ({
      ...d,
      color: null,
      value: null,
      values: null,
    }));
    setDataset(resetDataset);
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 100);
  };

  const onQuestionChange = async (value) => {
    const q = mapQuestions
      ?.flatMap((m) => m?.options)
      ?.find((q) => q?.value === value);
    if (!q) {
      // Reset if question not found
      setLegendOptions([]);
      setLegendTitle(null);
      setActiveQuestion(null);
      setIsNumeric(false);
      setSelectedLegendOption(null);
      setSelectedGradationIndex(null);
      // set hidden false for all markers
      const resetDataset = dataset.map((d) => ({
        ...d,
        hidden: false,
        color: null,
        value: null,
        values: null,
      }));
      setDataset(resetDataset);
      return;
    }
    setLegendTitle(q?.label);
    setActiveQuestion(value);
    setIsNumeric(q?.type === QUESTION_TYPES.number);
    setSelectedLegendOption(null);
    setSelectedGradationIndex(null);
    await fetchStats(value, q.type, q.formID);
  };

  const fetchData = useCallback(async () => {
    try {
      if (isLocationFetched) {
        // If location data is already fetched, no need to refetch
        return;
      }
      const adm = takeRight(selectedAdm, 1)[0];
      const apiURL = adm?.id
        ? `/maps/geolocation/${selectedForm}?administration=${adm.id}`
        : `/maps/geolocation/${selectedForm}`;
      const { data: apiData } = await api.get(apiURL);
      if (dataset?.length > 0 && prevForm !== selectedForm) {
        setPrevForm(selectedForm);
        const _dataset = dataset.map((d) => {
          const item = apiData?.find((a) => a.id === d.id);
          if (item) {
            return {
              ...d,
              hidden: false,
            };
          }
          return {
            ...d,
            hidden: true,
          };
        });
        setDataset(_dataset);
        setLoading(true);
      } else {
        const newDataset = apiData?.map((d) => ({
          ...d,
          hidden: false,
        }));
        setDataset(newDataset);
        setLoading(true);
      }
      setIsLocationFetched(true);
      const selected = [{ prop: adm?.level_name, value: adm?.name }];
      const pos = getBounds(selected);
      setPosition(pos);
      setMapForm(mapForms?.[0]?.id);
      setTimeout(() => {
        setLoading(false);
      }, 100);
    } catch (error) {
      setIsLocationFetched(true);
      setDataset([]);
      setLoading(false);
    }
  }, [
    selectedAdm,
    prevForm,
    selectedForm,
    dataset,
    mapForms,
    isLocationFetched,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // listen selectForm changes to refetch data
  useEffect(() => {
    const unsubscribe = store.subscribe(
      ({ selectedForm, administration }) => ({ selectedForm, administration }),
      ({ selectedForm, administration }) => {
        const isFormChanged = selectedForm && selectedForm !== prevForm;
        if ((isFormChanged || administration) && isLocationFetched) {
          // If form or administration changes, reset state and fetch new data
          if (isFormChanged) {
            setIsNumeric(false);
            setActiveQuestion(null);
            setLegendOptions([]);
            setLegendTitle(null);
            setSelectedLegendOption(null);
            setSelectedGradationIndex(null);
          }
          setIsLocationFetched(false);
        }
      }
    );
    return () => unsubscribe();
  }, [prevForm, selectedForm, isLocationFetched]);

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
            allowClear
          />
        </Space>
      </div>
      <MapView
        dataset={filteredDataset}
        loading={loading}
        position={position}
      />
      {/* )} */}
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
