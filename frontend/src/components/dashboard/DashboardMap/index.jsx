import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { Alert, Skeleton } from "antd";
import "leaflet/dist/leaflet.css";
import { api, geo } from "../../../lib";
import { applyDashboardFilters } from "../../../lib/dashboardFilterHints";
import DashboardMapHeader, { resolveBuckets } from "./DashboardMapHeader";
import MapPopupCard from "./MapPopupCard";
import useMapFilters from "./useMapFilters";
import useMapByParent from "./useMapByParent";
import "./styles.scss";

const DEFAULT_COLOR = "#1890ff";

/**
 * Config-driven dashboard map widget.
 *
 * Endpoints:
 *   GET /api/v1/maps/geolocation/{source_form_id}
 *       [?administration=<id>&criteria=...&from_date=...
 *        &to_date=...&include_monitoring=true]
 *   GET /api/v1/visualization/values
 *       (when active select filter has question_id)
 *   GET /api/v1/visualization/values/formula
 *       (when active select filter has formula)
 *
 * The geolocation response carries id, name, geo, administration_id,
 * administration_full_name, updated. byParent[id] is the active
 * filter's bucket value for the datapoint, used for marker colour,
 * the popup's dynamic row, and chip-based narrowing.
 */
const DashboardMap = ({
  item,
  filterState,
  customFilterDefs = [],
  height = 400,
}) => {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const sourceFormId = item?.source_form_id;
  const urlTemplate =
    item?.click_url_template ||
    "/control-center/data/{parent_form_id}/monitoring/{data_id}";

  const itemFilters = useMemo(() => item?.filters || [], [item]);

  const {
    activeKey,
    setActiveKey,
    activeFilter,
    isChipSelected,
    toggleChip,
    toggleValues,
    setToggleValue,
    queryParams,
    toggleDisabled,
  } = useMapFilters(itemFilters, filterState);

  const { byParent } = useMapByParent({ activeFilter, filterState });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const adminId = filterState?.administration_id;
    const dashboardParams = applyDashboardFilters(
      { form_id: sourceFormId },
      filterState,
      customFilterDefs
    );
    const query = new URLSearchParams();
    if (adminId) {
      query.set("administration", adminId);
    }
    if (dashboardParams.criteria) {
      query.set("criteria", dashboardParams.criteria);
    }

    const widgetFrom = queryParams.get("from_date");
    const widgetTo = queryParams.get("to_date");
    const widgetIncludeMonitoring = queryParams.get("include_monitoring");

    if (filterState?.from_date) {
      query.set("from_date", filterState.from_date);
    } else if (widgetFrom) {
      query.set("from_date", widgetFrom);
    }
    if (filterState?.to_date) {
      query.set("to_date", filterState.to_date);
    } else if (widgetTo) {
      query.set("to_date", widgetTo);
    }
    if (widgetIncludeMonitoring && !toggleDisabled) {
      query.set("include_monitoring", widgetIncludeMonitoring);
    }

    const qs = query.toString();
    const path = qs
      ? `/maps/geolocation/${sourceFormId}?${qs}`
      : `/maps/geolocation/${sourceFormId}`;

    api
      .get(path)
      .then((res) => {
        if (cancelled) {
          return;
        }
        setPoints(res?.data || []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    sourceFormId,
    filterState,
    customFilterDefs,
    queryParams,
    toggleDisabled,
  ]);

  const center = useMemo(() => {
    const d = geo?.defaultPos?.();
    return d?.coordinates || [0, 0];
  }, []);

  const bucketForPoint = (pointId) => byParent[pointId] || "_no_info";

  const colorForParent = (pointId) => {
    const map = activeFilter?.color_map || {};
    const value = bucketForPoint(pointId);
    return map[value] || map._no_info || DEFAULT_COLOR;
  };

  const visiblePoints = useMemo(() => {
    const pts = points.filter(
      (p) => Array.isArray(p.geo) && p.geo.length === 2
    );
    if (!activeFilter) {
      return pts;
    }
    const buckets = resolveBuckets(activeFilter);
    if (buckets.length === 0) {
      return pts;
    }
    return pts.filter((p) =>
      isChipSelected(activeFilter.key, bucketForPoint(String(p.id)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, activeFilter, byParent, isChipSelected]);

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }
  if (error) {
    return (
      <Alert
        type="error"
        message={`Failed to load map: ${error.message || "error"}`}
      />
    );
  }

  return (
    <div className="dashboard-map-wrapper">
      <DashboardMapHeader
        title={item?.title}
        filters={itemFilters}
        activeKey={activeKey}
        onActiveKeyChange={setActiveKey}
        activeFilter={activeFilter}
        isChipSelected={isChipSelected}
        onChipToggle={toggleChip}
        toggleValues={toggleValues}
        onToggleChange={setToggleValue}
        toggleDisabled={toggleDisabled}
      />
      <MapContainer
        center={center}
        zoom={7}
        style={{ height, width: "100%" }}
        scrollWheelZoom={false}
        className="dashboard-map-popup"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {visiblePoints.map((p) => (
          <CircleMarker
            key={p.id}
            center={p.geo}
            radius={7}
            pathOptions={{
              color: colorForParent(String(p.id)),
              fillColor: colorForParent(String(p.id)),
              fillOpacity: 0.9,
              weight: 1,
            }}
          >
            <Popup>
              <MapPopupCard
                point={p}
                activeFilter={activeFilter}
                byParent={byParent}
                urlTemplate={urlTemplate}
                sourceFormId={sourceFormId}
              />
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

DashboardMap.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  height: PropTypes.number,
};

export default DashboardMap;
