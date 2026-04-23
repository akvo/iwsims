import React, { useMemo } from "react";
import {
  Card,
  Col,
  Empty,
  Image,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import AdministrationDropdown from "../../filters/AdministrationDropdown";
import CharacteristicsTable from "./individual-overview/shared/CharacteristicsTable";
import PhotoCaptionCard from "./individual-overview/shared/PhotoCaptionCard";
import HistoricalLineChart from "./individual-overview/shared/HistoricalLineChart";
import useIndividualOverviewData from "./individual-overview/shared/useIndividualOverviewData";
import useMonitoringHistory from "./individual-overview/shared/useMonitoringHistory";
import {
  extractPhotoUrl,
  findAnswer,
  resolveAnswerLabel,
} from "./individual-overview/shared/helpers";
import {
  CONSTRUCTION_FORM_ID,
  CONSTRUCTION_PHOTO_CAPTION_QID,
  CONSTRUCTION_PHOTO_QID,
  CONSTRUCTION_PROGRESS_QID,
  CONSTRUCTION_REMARKS_QID,
  PROJECT_SCOPE_ROWS,
  REGISTRATION_CHARACTERISTICS_QIDS,
  REGISTRATION_FORM_ID,
  TEST_METHOD_CBT,
  TEST_METHOD_LAB,
  WATER_QUALITY_DETAIL_QIDS,
  WATER_QUALITY_FORM_ID,
  WQ_CBT_PARAMS,
  WQ_LAB_PARAMS,
  WQ_PHOTO_CAPTION_QID,
  WQ_PHOTO_QID,
  WQ_STATUS_QID,
  WQ_TEST_METHOD_QID,
} from "./individual-overview/config/eps";

const { Title, Text } = Typography;

const SCOPE_COLUMNS = [
  { title: "Project Scope", dataIndex: "label", key: "label", width: "30%" },
  {
    title: "In Scope?",
    dataIndex: "inScope",
    key: "inScope",
    width: "15%",
    render: (text) =>
      text ? <Tag color="green">{text}</Tag> : <Text type="secondary">—</Text>,
  },
  {
    title: "Implementation / Construction",
    dataIndex: "implementation",
    key: "implementation",
    width: "35%",
    render: (text) => text || <Text type="secondary">—</Text>,
  },
  {
    title: "Photo",
    dataIndex: "photoUrl",
    key: "photoUrl",
    width: "20%",
    render: (url) =>
      url ? (
        <Image
          src={url}
          width={80}
          height={60}
          style={{ objectFit: "cover" }}
        />
      ) : (
        <Text type="secondary">—</Text>
      ),
  },
];

const toMethodList = (methodAnswer) => {
  if (!methodAnswer) {
    return [];
  }
  const v = methodAnswer.value;
  if (Array.isArray(v)) {
    return v;
  }
  if (typeof v === "string") {
    return [v];
  }
  return [];
};

const buildSeries = (history, qid) => {
  if (!Array.isArray(history)) {
    return [];
  }
  return history
    .map((row) => {
      const answer = findAnswer(row.values, qid);
      if (!answer) {
        return null;
      }
      const numeric = Number(answer.value);
      if (Number.isNaN(numeric)) {
        return null;
      }
      return { label: row.date || "", value: numeric };
    })
    .filter(Boolean);
};

const IndividualEPSOverview = () => {
  const {
    dataPoints,
    selectedDataPoint,
    setSelectedDataPoint,
    regValues,
    monitoringValues,
  } = useIndividualOverviewData({
    regFormId: REGISTRATION_FORM_ID,
    monitoringFormIds: [CONSTRUCTION_FORM_ID, WATER_QUALITY_FORM_ID],
  });

  const constructionValues = useMemo(
    () => monitoringValues[CONSTRUCTION_FORM_ID] || [],
    [monitoringValues]
  );
  const wqValues = useMemo(
    () => monitoringValues[WATER_QUALITY_FORM_ID] || [],
    [monitoringValues]
  );

  const wqHistory = useMonitoringHistory(
    WATER_QUALITY_FORM_ID,
    selectedDataPoint?.uuid
  );

  const photoUrl = extractPhotoUrl(constructionValues, CONSTRUCTION_PHOTO_QID);
  const photoCaption = resolveAnswerLabel(
    constructionValues,
    CONSTRUCTION_PHOTO_CAPTION_QID
  );

  const progressPct = useMemo(() => {
    const answer = findAnswer(constructionValues, CONSTRUCTION_PROGRESS_QID);
    if (!answer) {
      return null;
    }
    const n = Number(answer.value);
    if (Number.isNaN(n)) {
      return null;
    }
    return Math.max(0, Math.min(100, n));
  }, [constructionValues]);

  const remarks = resolveAnswerLabel(
    constructionValues,
    CONSTRUCTION_REMARKS_QID
  );

  const scopeRows = useMemo(() => {
    return PROJECT_SCOPE_ROWS.map((row) => ({
      key: row.key,
      label: row.label,
      inScope: row.status_qid
        ? resolveAnswerLabel(constructionValues, row.status_qid)
        : null,
      implementation: row.impl_qid
        ? resolveAnswerLabel(constructionValues, row.impl_qid)
        : null,
      photoUrl: row.photo_qid
        ? extractPhotoUrl(constructionValues, row.photo_qid)
        : null,
    }));
  }, [constructionValues]);

  const wqPhotoUrl = extractPhotoUrl(wqValues, WQ_PHOTO_QID);
  const wqPhotoCaption = resolveAnswerLabel(wqValues, WQ_PHOTO_CAPTION_QID);
  const wqStatus = resolveAnswerLabel(wqValues, WQ_STATUS_QID);

  const methods = toMethodList(findAnswer(wqValues, WQ_TEST_METHOD_QID));
  const showLabCharts = methods.includes(TEST_METHOD_LAB);
  const showCbtCharts = methods.includes(TEST_METHOD_CBT);

  const renderEmptySelection = () => (
    <Empty description="Select a Location and an EPS to view details" />
  );

  return (
    <div className="individual-overview">
      <Space style={{ marginBottom: 16 }} wrap>
        <AdministrationDropdown />
        <Select
          placeholder="Select an EPS"
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
        renderEmptySelection()
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <PhotoCaptionCard
                title="Latest construction photo"
                photoUrl={photoUrl}
                caption={photoCaption}
                alt="Construction photo"
              />
            </Col>
            <Col span={12}>
              <CharacteristicsTable
                title="EPS Characteristics"
                qids={REGISTRATION_CHARACTERISTICS_QIDS}
                values={regValues}
              />
            </Col>
          </Row>

          <Tabs destroyInactiveTabPane>
            <Tabs.TabPane key="construction" tab="Construction monitoring">
              <Card
                title="Project completion"
                size="small"
                style={{ marginBottom: 16 }}
              >
                {progressPct === null ? (
                  <Empty description="No progress data yet" />
                ) : (
                  <Progress percent={progressPct} status="active" />
                )}
              </Card>
              <Card
                title="Construction Information — EPS"
                size="small"
                style={{ marginBottom: 16 }}
              >
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  columns={SCOPE_COLUMNS}
                  dataSource={scopeRows}
                />
              </Card>
              <Card title="General remarks" size="small">
                {remarks ? (
                  <Text>{remarks}</Text>
                ) : (
                  <Text type="secondary">No remarks</Text>
                )}
              </Card>
            </Tabs.TabPane>

            <Tabs.TabPane key="water_quality" tab="Water quality monitoring">
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={12}>
                  <CharacteristicsTable
                    title="Last Water Monitoring Information"
                    qids={WATER_QUALITY_DETAIL_QIDS}
                    values={wqValues}
                  />
                </Col>
                <Col span={12}>
                  <PhotoCaptionCard
                    title="Sampling point"
                    photoUrl={wqPhotoUrl}
                    caption={wqPhotoCaption}
                    alt="Sampling point photo"
                  />
                  <Card size="small" style={{ marginTop: 16 }}>
                    <Title level={5} style={{ marginBottom: 8 }}>
                      Operational status
                    </Title>
                    {wqStatus ? (
                      <Tag color="blue">{wqStatus}</Tag>
                    ) : (
                      <Text type="secondary">Not reported</Text>
                    )}
                  </Card>
                </Col>
              </Row>

              {showLabCharts && (
                <Card
                  title="Microbial parameters"
                  size="small"
                  style={{ marginBottom: 16 }}
                >
                  <Row gutter={16}>
                    {WQ_LAB_PARAMS.map((p) => (
                      <Col span={8} key={p.key}>
                        <HistoricalLineChart
                          title={p.title}
                          data={buildSeries(wqHistory.rows, p.qid)}
                          unit={p.unit}
                          thresholdMin={p.thresholdMin}
                          thresholdMax={p.thresholdMax}
                        />
                      </Col>
                    ))}
                  </Row>
                </Card>
              )}

              {showCbtCharts && (
                <Card title="CBT parameters" size="small">
                  <Row gutter={16}>
                    {WQ_CBT_PARAMS.map((p) => (
                      <Col span={12} key={p.key}>
                        <HistoricalLineChart
                          title={p.title}
                          data={buildSeries(wqHistory.rows, p.qid)}
                          unit={p.unit}
                          thresholdMax={p.thresholdMax}
                        />
                      </Col>
                    ))}
                  </Row>
                </Card>
              )}
            </Tabs.TabPane>
          </Tabs>
        </>
      )}
    </div>
  );
};

export default IndividualEPSOverview;
