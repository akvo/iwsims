import React, { useCallback } from "react";
import PropTypes from "prop-types";
import { Col, Row } from "antd";

import { getText } from "./lib/utils";
import TabsWidget from "../../../../components/dashboard/widgets/TabsWidget";
import SectionTitleWidget from "../../../../components/dashboard/widgets/SectionTitleWidget";
import {
  AssessmentWidget,
  ComplianceWidget,
  FieldListWidget,
  MetricWidget,
  PhotoWidget,
  RecordTableWidget,
  RisksWidget,
  RiskScoreTrend,
  TagsWidget,
  TrendWidget,
} from "./widgets";
import ProfileHeader from "./ProfileHeader";
import "./style.scss";

const CUSTOM_COMPONENTS = { RiskScoreTrend };

const localizeItem = (item, text) => ({
  ...item,
  label: getText(text, item.label_key, item.label),
  title: getText(text, item.title_key, item.title),
  items: (item.items || []).map((child) => localizeItem(child, text)),
});

const ProfileRenderer = ({ header, items, recordContext }) => {
  const text = recordContext?.text || {};
  const renderItems = useCallback(
    (children) => (
      <ProfileRenderer items={children} recordContext={recordContext} />
    ),
    [recordContext]
  );

  const renderWidget = (item) => {
    const localizedItem = localizeItem(item, text);
    switch (item.chart_type) {
      case "tabs":
        return <TabsWidget item={localizedItem} renderItems={renderItems} />;
      case "heading":
        return <SectionTitleWidget item={localizedItem} />;
      case "field_list":
        return (
          <FieldListWidget item={localizedItem} recordContext={recordContext} />
        );
      case "record_table":
        return (
          <RecordTableWidget
            item={localizedItem}
            recordContext={recordContext}
          />
        );
      case "assessment":
        return (
          <AssessmentWidget
            item={localizedItem}
            recordContext={recordContext}
          />
        );
      case "compliance":
        return (
          <ComplianceWidget
            item={localizedItem}
            recordContext={recordContext}
          />
        );
      case "tags":
        return (
          <TagsWidget item={localizedItem} recordContext={recordContext} />
        );
      case "trend":
        return (
          <TrendWidget item={localizedItem} recordContext={recordContext} />
        );
      case "metric":
        return (
          <MetricWidget item={localizedItem} recordContext={recordContext} />
        );
      case "photo":
        return (
          <PhotoWidget item={localizedItem} recordContext={recordContext} />
        );
      case "risks":
        return (
          <RisksWidget item={localizedItem} recordContext={recordContext} />
        );
      case "custom": {
        const Component = CUSTOM_COMPONENTS[item.component];
        return Component ? (
          <Component item={localizedItem} recordContext={recordContext} />
        ) : null;
      }
      default:
        return null;
    }
  };

  const visible = [...(items || [])]
    .filter((item) => !item.hide)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <>
      <ProfileHeader header={header} recordContext={recordContext} />
      <Row gutter={[16, 16]}>
        {visible.map((item) => {
          const node = renderWidget(item);
          if (node === null) {
            return null;
          }
          return (
            <Col key={item.id} xs={24} md={item.col_span ?? 24}>
              {node}
            </Col>
          );
        })}
      </Row>
    </>
  );
};

ProfileRenderer.propTypes = {
  header: PropTypes.object,
  items: PropTypes.array,
  recordContext: PropTypes.object,
};

export default ProfileRenderer;
