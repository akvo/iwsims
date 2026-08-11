import React from "react";
import PropTypes from "prop-types";
import { Alert, Col, Row, Spin, Tabs } from "antd";

import { ProfileProvider, useProfile } from "./ProfileContext";
import ProfileHeader from "./ProfileHeader";
import { FieldList, HistoryChart, Photo, RecordTable } from "./widgets";
import { getText } from "./utils";
import "./style.scss";

const { TabPane } = Tabs;

const WIDGETS = {
  record: RecordTable,
  field: FieldList,
  line: HistoryChart,
  photo: Photo,
};

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/**
 * Width of a child when its config does not say.
 *
 * Tables are full width — they carry several columns and were previously
 * squeezed into a fixed 10/24 side column. Field lists pair up. Trend charts
 * go three to a row, matching the individual-overview charts.
 */
const DEFAULT_SPAN = { record: 24, field: 12, line: 8, photo: 12 };

/**
 * Resolve a child's grid width, clamped to the 1–24 Ant Design grid.
 * A `col_span` in config always wins.
 */
export const resolveSpan = (child) => {
  const configured = Number(child?.col_span);
  if (Number.isFinite(configured) && configured >= 1 && configured <= 24) {
    return configured;
  }
  return DEFAULT_SPAN[child?.chart_type] ?? 24;
};

const renderChild = (child, recordContext) => {
  const Widget = WIDGETS[child.chart_type];
  if (!Widget) {
    return null;
  }
  const span = resolveSpan(child);
  return (
    // Below lg every box goes full width; the grid only applies once there is
    // room for it. md is a halfway step so two-up layouts survive on tablets.
    <Col
      key={child.id}
      xs={24}
      sm={24}
      md={span >= 12 ? 24 : 12}
      lg={span}
      className="site-profile-item"
    >
      <Widget item={child} recordContext={recordContext} />
    </Col>
  );
};

/**
 * One ordered grid per tab.
 *
 * Replaces a fixed left/right split that gave every tab the same 14/10 shape
 * regardless of content — a lone table sat at 14 with dead space beside it,
 * while the WWTP effluent tab stacked eleven boxes down the 10-wide column.
 * `order` alone now decides sequence; `position` is honoured only as a
 * tiebreak so configs that still carry it keep their reading order.
 */
const renderTabContent = (tabKey, config, recordContext) => {
  const children = (config.children || [])
    .filter((child) => child.tab === tabKey && !child.hide)
    .sort((a, b) => {
      const byPosition =
        ((a.position || "left") === "right" ? 1 : 0) -
        ((b.position || "left") === "right" ? 1 : 0);
      return byPosition !== 0 ? byPosition : byOrder(a, b);
    });

  return (
    <Row gutter={[16, 16]} align="stretch">
      {children.map((child) => renderChild(child, recordContext))}
    </Row>
  );
};

const ProfileBody = () => {
  const { config, recordContext, loading, error, text } = useProfile();

  if (error) {
    return <Alert type="error" showIcon message={text.siteProfileLoadFailed} />;
  }
  if (!config) {
    return null;
  }
  const tabs = config.tabs || [];

  return (
    <Spin spinning={loading} tip={text.siteProfileLoading}>
      <div className="site-profile">
        <ProfileHeader config={config} recordContext={recordContext} />
        {tabs.length ? (
          <Tabs className="site-profile-tabs" destroyInactiveTabPane>
            {tabs.map((tab) => (
              <TabPane
                tab={getText(text, tab.label_key, tab.label)}
                key={tab.key}
              >
                {renderTabContent(tab.key, config, recordContext)}
              </TabPane>
            ))}
          </Tabs>
        ) : (
          renderTabContent(null, config, recordContext)
        )}
      </div>
    </Spin>
  );
};

const ProfilePage = ({ parentId, parentFormId, config, text, enabled }) => (
  <ProfileProvider
    parentId={parentId}
    parentFormId={parentFormId}
    config={config}
    text={text}
    enabled={enabled}
  >
    <ProfileBody />
  </ProfileProvider>
);

ProfilePage.propTypes = {
  parentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  parentFormId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  config: PropTypes.object,
  text: PropTypes.object,
  enabled: PropTypes.bool,
};

ProfilePage.defaultProps = {
  enabled: true,
};

export default ProfilePage;
