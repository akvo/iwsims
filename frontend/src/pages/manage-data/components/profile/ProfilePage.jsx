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

const renderChild = (child, recordContext) => {
  const Widget = WIDGETS[child.chart_type];
  if (!Widget) {
    return null;
  }
  return (
    <div key={child.id} className="site-profile-item">
      <Widget item={child} recordContext={recordContext} />
    </div>
  );
};

const renderTabContent = (tabKey, config, recordContext) => {
  const children = (config.children || []).filter(
    (child) => child.tab === tabKey && !child.hide
  );
  const left = children
    .filter((child) => (child.position || "left") === "left")
    .sort(byOrder);
  const right = children
    .filter((child) => child.position === "right")
    .sort(byOrder);
  const hasLeft = left.length > 0;
  const hasRight = right.length > 0;
  const leftSpan = hasRight ? { xs: 24, md: 24, lg: 14 } : { span: 24 };
  const rightSpan = hasLeft ? { xs: 24, md: 24, lg: 10 } : { span: 24 };

  return (
    <Row gutter={[16, 16]}>
      {hasLeft ? (
        <Col {...leftSpan}>
          {left.map((child) => renderChild(child, recordContext))}
        </Col>
      ) : null}
      {hasRight ? (
        <Col {...rightSpan}>
          {right.map((child) => renderChild(child, recordContext))}
        </Col>
      ) : null}
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
