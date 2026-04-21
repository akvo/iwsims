import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import { Alert, Skeleton } from "antd";
import "leaflet/dist/leaflet.css";
import { api, geo } from "../../lib";
import { applyDashboardFilters } from "../../lib/dashboardFilterHints";

const DEFAULT_COLOR = "#1890ff";

/**
 * Config-driven dashboard map. Accepts a flat-schema `map` item directly.
 *
 * Endpoints:
 *   GET /api/v1/maps/geolocation/{source_form_id}[?administration=<id>]
 *   GET /api/v1/visualization/values?form_id=<status_monitoring_form_id>
 *        &question_id=<status_question_id>&group_by=parent_id&monitoring=latest
 *
 * The first call returns points ({ id, name, geo: [lat, lng], ... }); the
 * second optional call provides per-EPS status used to color markers via
 * `item.status_colors`. Marker click navigates through
 * `item.click_url_template` with {parent_form_id}/{data_id} substituted.
 */
const DashboardMap = ({
  item,
  filterState,
  customFilterDefs = [],
  height = 400,
}) => {
  const [points, setPoints] = useState([]);
  const [statusByParent, setStatusByParent] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const sourceFormId = item?.source_form_id;
  const statusQid = item?.status_question_id;
  const statusFormId = item?.status_monitoring_form_id;
  const statusColors = item?.status_colors || {};
  const urlTemplate =
    item?.click_url_template ||
    "/control-center/data/{parent_form_id}/monitoring/{data_id}";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const adminId = filterState?.administration_id;
    const criteriaParams = applyDashboardFilters(
      { form_id: sourceFormId },
      filterState,
      customFilterDefs
    );
    const query = new URLSearchParams();
    if (adminId) {
      query.set("administration", adminId);
    }
    if (criteriaParams.criteria) {
      query.set("criteria", criteriaParams.criteria);
    }
    if (filterState?.from_date) {
      query.set("from_date", filterState.from_date);
    }
    if (filterState?.to_date) {
      query.set("to_date", filterState.to_date);
    }
    const qs = query.toString();
    const path = qs
      ? `/maps/geolocation/${sourceFormId}?${qs}`
      : `/maps/geolocation/${sourceFormId}`;
    const tasks = [api.get(path)];
    if (statusQid && statusFormId) {
      tasks.push(
        api.get("visualization/values", {
          params: {
            form_id: statusFormId,
            question_id: statusQid,
            group_by: "parent_id",
            monitoring: "latest",
          },
        })
      );
    }
    Promise.all(tasks)
      .then(([mapRes, statusRes]) => {
        if (cancelled) {
          return;
        }
        setPoints(mapRes?.data || []);
        if (statusRes) {
          const byParent = {};
          (statusRes.data?.data || []).forEach((row) => {
            byParent[row.group] = row.label;
          });
          setStatusByParent(byParent);
        }
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
  }, [sourceFormId, statusQid, statusFormId, filterState, customFilterDefs]);

  const center = useMemo(() => {
    const d = geo?.defaultPos?.();
    return d?.coordinates || [0, 0];
  }, []);

  const colorForParent = (parentId) => {
    const label = statusByParent[parentId];
    if (!label) {
      return DEFAULT_COLOR;
    }
    const slug = label.toLowerCase().replace(/\s+/g, "_");
    return statusColors[slug] || statusColors[label] || DEFAULT_COLOR;
  };

  const buildUrl = (pointId) =>
    urlTemplate
      .replace("{parent_form_id}", sourceFormId)
      .replace("{data_id}", pointId);

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
    <MapContainer
      center={center}
      zoom={7}
      style={{ height, width: "100%" }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {points
        .filter((p) => Array.isArray(p.geo) && p.geo.length === 2)
        .map((p) => (
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
            eventHandlers={{
              click: () =>
                window.open(buildUrl(p.id), "_blank", "noopener,noreferrer"),
            }}
          >
            <Popup>
              <div>
                <strong>{p.name || `EPS #${p.id}`}</strong>
                <br />
                <a
                  href={buildUrl(p.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open monitoring
                </a>
              </div>
            </Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
};

DashboardMap.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  height: PropTypes.number,
};

export default DashboardMap;
