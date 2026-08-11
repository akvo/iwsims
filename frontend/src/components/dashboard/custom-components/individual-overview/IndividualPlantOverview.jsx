import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Card, Col, Empty, Row, Select, Space } from "antd";
import AdministrationDropdownLocal from "../../../filters/AdministrationDropdownLocal";
import CharacteristicsTable from "./shared/CharacteristicsTable";
import PhotoCaptionCard from "./shared/PhotoCaptionCard";
import HistoricalLineChart from "./shared/HistoricalLineChart";
import useIndividualOverviewData from "./shared/useIndividualOverviewData";
import useMonitoringHistory from "./shared/useMonitoringHistory";
import {
  extractPhotoUrl,
  findAnswer,
  resolveAnswerLabel,
} from "./shared/helpers";

/**
 * Turn a monitoring history into `[{label, value}]` for one question.
 *
 * Treats null / undefined / "" / whitespace-only as missing before numeric
 * conversion — Number("") and Number("   ") both yield 0, which would chart
 * spurious zero-value datapoints. (Same guard the EPS and RWS overviews use.)
 */
export const buildSeries = (history, qid) =>
  (Array.isArray(history) ? history : [])
    .map((row) => {
      const answer = findAnswer(row.values, qid);
      const raw = answer?.value;
      if (
        raw === null ||
        typeof raw === "undefined" ||
        (typeof raw === "string" && raw.trim() === "")
      ) {
        return null;
      }
      const numeric = Number(raw);
      if (Number.isNaN(numeric)) {
        return null;
      }
      return { label: row.date || "", value: numeric };
    })
    .filter(Boolean);

/**
 * Generic per-site overview: pick a location and a site, then see its
 * registration characteristics, latest inspection photo and details, and each
 * monitored parameter's trend.
 *
 * Driven entirely by a config module (see `config/wwtp.js`, `config/wtp.js`),
 * so a new asset is a config file rather than another component. EPS and RWS
 * keep their own components — they carry sections this shape has no room for
 * (project scope, per-infrastructure construction status).
 */
const IndividualPlantOverview = ({ config }) => {
  // Component-local admin selection, deliberately NOT store.administration:
  // picking a location here must not refetch every chart on the dashboard.
  const [embeddedAdmin, setEmbeddedAdmin] = useState(null);

  const monitoringFormIds = useMemo(
    () => [config.MONITORING_FORM_ID],
    [config.MONITORING_FORM_ID]
  );

  const {
    dataPoints,
    selectedDataPoint,
    setSelectedDataPoint,
    regValues,
    monitoringValues,
  } = useIndividualOverviewData({
    regFormId: config.REGISTRATION_FORM_ID,
    monitoringFormIds,
    selectedLocation: embeddedAdmin,
  });

  const values = useMemo(
    () => monitoringValues[config.MONITORING_FORM_ID] || [],
    [monitoringValues, config.MONITORING_FORM_ID]
  );

  const history = useMonitoringHistory(
    config.MONITORING_FORM_ID,
    selectedDataPoint?.uuid,
    config.DATE_QID
  );

  const photoUrl = extractPhotoUrl(values, config.PHOTO_QID);
  const photoCaption = resolveAnswerLabel(values, config.PHOTO_CAPTION_QID);

  return (
    <div className="individual-overview">
      <Space style={{ marginBottom: 16 }} wrap>
        <AdministrationDropdownLocal onChange={setEmbeddedAdmin} />
        <Select
          placeholder={`Select a ${config.ENTITY_LABEL}`}
          style={{ minWidth: 240 }}
          options={dataPoints}
          value={selectedDataPoint?.id || null}
          onChange={(_, option) =>
            setSelectedDataPoint(
              dataPoints.find((dp) => dp.id === option?.id) || null
            )
          }
          fieldNames={{ value: "id", label: "name" }}
          allowClear
          showSearch
          optionFilterProp="name"
        />
      </Space>

      {!selectedDataPoint ? (
        <Empty
          description={`Select a Location and a ${config.ENTITY_LABEL} to view details`}
        />
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <PhotoCaptionCard
                title="Latest inspection photo"
                photoUrl={photoUrl}
                caption={photoCaption}
                alt={`${config.ENTITY_LABEL} inspection photo`}
              />
            </Col>
            <Col span={12}>
              <CharacteristicsTable
                title={`${config.ENTITY_LABEL} Characteristics`}
                qids={config.REGISTRATION_CHARACTERISTICS_QIDS}
                values={regValues}
              />
            </Col>
          </Row>

          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={24}>
              <CharacteristicsTable
                title="Latest monitoring"
                qids={config.MONITORING_DETAIL_QIDS}
                values={values}
              />
            </Col>
          </Row>

          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {config.PARAM_GROUPS.map((group) => (
              <Card key={group.key} title={group.title} size="small">
                <Row gutter={16}>
                  {group.params.map((param) => (
                    <Col xl={8} lg={12} md={24} key={param.key}>
                      <HistoricalLineChart
                        title={param.title}
                        data={buildSeries(history.rows, param.qid)}
                        unit={param.unit}
                        thresholdMin={param.thresholdMin}
                        thresholdMax={param.thresholdMax}
                      />
                    </Col>
                  ))}
                </Row>
              </Card>
            ))}
          </Space>
        </>
      )}
    </div>
  );
};

IndividualPlantOverview.propTypes = {
  config: PropTypes.shape({
    REGISTRATION_FORM_ID: PropTypes.number.isRequired,
    MONITORING_FORM_ID: PropTypes.number.isRequired,
    ENTITY_LABEL: PropTypes.string.isRequired,
    REGISTRATION_CHARACTERISTICS_QIDS: PropTypes.array.isRequired,
    MONITORING_DETAIL_QIDS: PropTypes.array.isRequired,
    PHOTO_QID: PropTypes.number,
    PHOTO_CAPTION_QID: PropTypes.number,
    DATE_QID: PropTypes.number.isRequired,
    PARAM_GROUPS: PropTypes.array.isRequired,
  }).isRequired,
};

export default IndividualPlantOverview;
