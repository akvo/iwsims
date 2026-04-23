import React, { useMemo } from "react";
import {
  Card,
  Col,
  Empty,
  Image,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { HomeOutlined, TeamOutlined, DollarOutlined } from "@ant-design/icons";
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
  COMPREHENSIVE_FORM_ID,
  CONSTRUCTION_PHOTO_QID,
  PROJECT_SCOPE_ROWS_BY_TYPE,
  PROJECT_TYPE_QID,
  QUICK_FORM_ID,
  QUICK_FORM_QIDS,
  REGISTRATION_CHARACTERISTICS_QIDS,
  REGISTRATION_FORM_ID,
  STATS_CARD_QIDS,
  TEST_METHOD_CBT,
  TEST_METHOD_LAB,
  WATER_QUALITY_DETAIL_QIDS,
  WATER_SOURCE_QID,
  WQ_CBT_PARAMS,
  WQ_LAB_PARAMS,
  WQ_PHOTO_CAPTION_QID,
  WQ_PHOTO_QID,
  WQ_STATUS_QID,
  WQ_TEST_METHOD_QID,
} from "./individual-overview/config/rws";

const { Title, Text } = Typography;

const QUICK_FORM_QID_SET = new Set(Object.values(QUICK_FORM_QIDS));

const SCOPE_COLUMNS = [
  { title: "Scope", dataIndex: "label", key: "label", width: "30%" },
  {
    title: "Implementation",
    dataIndex: "implementation",
    key: "implementation",
    width: "25%",
    render: (text) => text || <Text type="secondary">—</Text>,
  },
  {
    title: "Notes / issues",
    dataIndex: "notes",
    key: "notes",
    width: "30%",
    render: (text) => text || <Text type="secondary">—</Text>,
  },
  {
    title: "Photo",
    dataIndex: "photoUrl",
    key: "photoUrl",
    width: "15%",
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

const StatsCard = ({ regValues }) => {
  const households = findAnswer(regValues, STATS_CARD_QIDS.households)?.value;
  const population = findAnswer(regValues, STATS_CARD_QIDS.population)?.value;
  const projectCost = findAnswer(regValues, STATS_CARD_QIDS.projectCost)?.value;
  return (
    <Card title="Project Statistics" bordered>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Statistic
          title="Households served"
          value={households ?? "—"}
          prefix={<HomeOutlined />}
        />
        <Statistic
          title="People served"
          value={population ?? "—"}
          prefix={<TeamOutlined />}
        />
        <Statistic
          title="Project costs"
          value={projectCost ?? "—"}
          prefix={<DollarOutlined />}
        />
      </Space>
    </Card>
  );
};

const renderParamSection = (title, params, history) => {
  if (!params.length) {
    return null;
  }
  return (
    <Card title={title} size="small" style={{ marginBottom: 16 }}>
      <Row gutter={16}>
        {params.map((p) => (
          <Col span={8} key={p.key}>
            <HistoricalLineChart
              title={p.title}
              data={buildSeries(history, p.qid)}
              unit={p.unit}
              thresholdMin={p.thresholdMin}
              thresholdMax={p.thresholdMax}
            />
          </Col>
        ))}
      </Row>
    </Card>
  );
};

const IndividualRWSOverview = () => {
  const {
    dataPoints,
    selectedDataPoint,
    setSelectedDataPoint,
    regValues,
    monitoringValues,
  } = useIndividualOverviewData({
    regFormId: REGISTRATION_FORM_ID,
    monitoringFormIds: [COMPREHENSIVE_FORM_ID, QUICK_FORM_ID],
  });

  const compValues = useMemo(
    () => monitoringValues[COMPREHENSIVE_FORM_ID] || [],
    [monitoringValues]
  );
  const quickValues = useMemo(
    () => monitoringValues[QUICK_FORM_ID] || [],
    [monitoringValues]
  );

  // Per-field source helper — qids in QUICK_FORM_QIDS resolve against the
  // quick form, all others against the comprehensive form.
  const valuesFor = (qid) =>
    QUICK_FORM_QID_SET.has(qid) ? quickValues : compValues;

  const wqHistory = useMonitoringHistory(
    COMPREHENSIVE_FORM_ID,
    selectedDataPoint?.uuid
  );

  const projectTypeAnswer = findAnswer(compValues, PROJECT_TYPE_QID);
  const projectTypeRaw = Array.isArray(projectTypeAnswer?.value)
    ? projectTypeAnswer.value[0]
    : projectTypeAnswer?.value;
  const projectTypeLabel = resolveAnswerLabel(compValues, PROJECT_TYPE_QID);
  const waterSourceLabel = resolveAnswerLabel(compValues, WATER_SOURCE_QID);

  const photoUrl = extractPhotoUrl(compValues, CONSTRUCTION_PHOTO_QID);
  const photoCaption = resolveAnswerLabel(
    valuesFor(WQ_PHOTO_CAPTION_QID),
    WQ_PHOTO_CAPTION_QID
  );

  const wqPhotoUrl = extractPhotoUrl(compValues, WQ_PHOTO_QID);
  const wqStatus = resolveAnswerLabel(valuesFor(WQ_STATUS_QID), WQ_STATUS_QID);

  // Build the WQ details rows by routing each qid to the correct source form.
  const wqDetailValues = useMemo(() => {
    const seen = new Map();
    WATER_QUALITY_DETAIL_QIDS.forEach((qid) => {
      const list = valuesFor(qid);
      const answer = findAnswer(list, qid);
      if (answer && !seen.has(qid)) {
        seen.set(qid, answer);
      }
    });
    return Array.from(seen.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compValues, quickValues]);

  const scopeRows = useMemo(() => {
    const rows = PROJECT_SCOPE_ROWS_BY_TYPE.get(projectTypeRaw) || [];
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      implementation: row.status_qid
        ? resolveAnswerLabel(compValues, row.status_qid)
        : null,
      notes: row.issues_qid
        ? resolveAnswerLabel(compValues, row.issues_qid)
        : null,
      photoUrl: row.photo_qid
        ? extractPhotoUrl(compValues, row.photo_qid)
        : null,
    }));
  }, [compValues, projectTypeRaw]);

  const methods = toMethodList(findAnswer(compValues, WQ_TEST_METHOD_QID));
  const showLabCharts = methods.includes(TEST_METHOD_LAB);
  const showCbtCharts = methods.includes(TEST_METHOD_CBT);

  const microbialParams = WQ_LAB_PARAMS.filter(
    (p) => p.section === "microbial"
  );
  const chemicalParams = WQ_LAB_PARAMS.filter((p) => p.section === "chemical");
  const physicalParams = WQ_LAB_PARAMS.filter((p) => p.section === "physical");

  return (
    <div className="individual-overview">
      <Space style={{ marginBottom: 16 }} wrap>
        <AdministrationDropdown />
        <Select
          placeholder="Select an RWS"
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
        {waterSourceLabel && (
          <Tag color="blue">Water source: {waterSourceLabel}</Tag>
        )}
        {projectTypeLabel && (
          <Tag color="purple">Project type: {projectTypeLabel}</Tag>
        )}
      </Space>

      {!selectedDataPoint ? (
        <Empty description="Select a Location and an RWS to view details" />
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <PhotoCaptionCard
                title="Photo from last monitoring"
                photoUrl={photoUrl}
                caption={photoCaption}
                alt="Sampling point photo"
              />
            </Col>
            <Col span={8}>
              <CharacteristicsTable
                title="RWS Characteristics"
                qids={REGISTRATION_CHARACTERISTICS_QIDS}
                values={regValues}
              />
            </Col>
            <Col span={8}>
              <StatsCard regValues={regValues} />
            </Col>
          </Row>

          <Tabs destroyInactiveTabPane>
            <Tabs.TabPane key="construction" tab="Construction monitoring">
              <Card
                title="Project completion"
                size="small"
                style={{ marginBottom: 16 }}
              >
                <Empty description="Project-type-aware progress formula not yet implemented (deferred to follow-up)" />
              </Card>
              <Card
                title="Construction Information"
                size="small"
                style={{ marginBottom: 16 }}
              >
                {scopeRows.length === 0 ? (
                  <Empty
                    description={
                      projectTypeRaw
                        ? `No project-scope rows defined for project type "${projectTypeRaw}"`
                        : "Project type unknown"
                    }
                  />
                ) : (
                  <Table
                    rowKey="key"
                    size="small"
                    pagination={false}
                    columns={SCOPE_COLUMNS}
                    dataSource={scopeRows}
                  />
                )}
              </Card>
            </Tabs.TabPane>

            <Tabs.TabPane key="water_quality" tab="Water quality monitoring">
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={12}>
                  <CharacteristicsTable
                    title="Last Water Monitoring Information"
                    qids={WATER_QUALITY_DETAIL_QIDS}
                    values={wqDetailValues}
                  />
                </Col>
                <Col span={12}>
                  <PhotoCaptionCard
                    title="Sampling point"
                    photoUrl={wqPhotoUrl}
                    caption={photoCaption}
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

              {showLabCharts &&
                renderParamSection(
                  "Microbial parameters",
                  microbialParams,
                  wqHistory.rows
                )}
              {showLabCharts &&
                renderParamSection(
                  "Chemical parameters",
                  chemicalParams,
                  wqHistory.rows
                )}
              {showLabCharts &&
                renderParamSection(
                  "Physical parameters",
                  physicalParams,
                  wqHistory.rows
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

            <Tabs.TabPane key="wsmp_monitor" tab="WSMP monitor">
              <Empty description="WSMP monitor coming soon" />
            </Tabs.TabPane>
          </Tabs>
        </>
      )}
    </div>
  );
};

export default IndividualRWSOverview;
