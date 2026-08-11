import React from "react";
import PropTypes from "prop-types";
import { Button, Space, Tooltip, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

/**
 * Format as "Mon, 11 Aug 2026 · 22:14" — weekday included because the value a
 * viewer usually wants from a refresh stamp is "was this today?".
 */
export const formatRefreshedAt = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const day = new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
  const time = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
  return `${day} · ${time}`;
};

/**
 * Header stamp showing when this page's data was last fetched, with a refresh
 * that actually refetches.
 *
 * The stamp is only meaningful if refreshing is possible — otherwise it just
 * reports page-load time and slowly becomes a lie as the user leaves the tab
 * open. `onRefresh` clears the module-level request cache and remounts the
 * widgets, so the pair is honest: the time shown is the time the data on
 * screen was fetched.
 */
const LastRefreshed = ({ refreshedAt, onRefresh, loading }) => {
  const formatted = formatRefreshedAt(refreshedAt);

  return (
    <Space size={8} className="dashboard-refresh">
      {formatted && (
        <Text type="secondary" className="dashboard-refresh-stamp">
          Last refresh: {formatted}
        </Text>
      )}
      <Tooltip title="Refetch every widget on this page">
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          loading={loading}
          aria-label="Refresh dashboard data"
        >
          Refresh
        </Button>
      </Tooltip>
    </Space>
  );
};

LastRefreshed.propTypes = {
  refreshedAt: PropTypes.instanceOf(Date),
  onRefresh: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

LastRefreshed.defaultProps = {
  refreshedAt: null,
  loading: false,
};

export default LastRefreshed;
