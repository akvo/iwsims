import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { divIcon } from "leaflet";
import { Alert, Skeleton, Space, Tag } from "antd";
import "leaflet/dist/leaflet.css";
import { api, geo } from "../../lib";
import {
  FUNCTIONAL,
  NON_FUNCTIONAL,
  STATUS_TONE,
  UNKNOWN,
  buildStatusPoints,
  countByStatus,
  valuesByParent,
} from "./compute/assetStatus";
import "./DashboardMap/styles.scss";

const BUCKETS = [
  { key: FUNCTIONAL, label: "Functional" },
  { key: NON_FUNCTIONAL, label: "Non-functional" },
  { key: UNKNOWN, label: "No status recorded" },
];

const markerIcon = (status) =>
  divIcon({
    className: "dashboard-map-marker",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span class="dashboard-map-marker-dot" style="background:${
      STATUS_TONE[status] || STATUS_TONE[UNKNOWN]
    };"></span>`,
  });

/**
 * Fetch one asset family's points and, when it has a status question, that
 * question's latest value per site.
 *
 * Both endpoints are scoped to a single registration family, so a fleet-wide
 * map is a fan-out — one pair of requests per asset, merged for display.
 */
const fetchSource = (source, administrationId) => {
  const query = new URLSearchParams();
  if (administrationId) {
    query.set("administration", administrationId);
  }
  const qs = query.toString();
  const geoPath = qs
    ? `/maps/geolocation/${source.form_id}?${qs}`
    : `/maps/geolocation/${source.form_id}`;

  const points = api.get(geoPath).then((res) => res?.data || []);
  if (!source.question_name) {
    return points.then((p) => ({ source, points: p, byParent: {} }));
  }
  const values = api
    .get("visualization/values", {
      params: {
        question_name: source.question_name,
        parent_form_id: source.form_id,
        group_by: "parent_id",
        monitoring: "latest",
        ...(administrationId ? { administration_id: administrationId } : {}),
      },
    })
    .then((res) => valuesByParent(res?.data?.data || []));
  return Promise.all([points, values]).then(([p, byParent]) => ({
    source,
    points: p,
    byParent,
  }));
};

/**
 * A national map of every registered asset, coloured by whether its latest
 * monitoring found it working.
 *
 * `DashboardMap` takes one `source_form_id`; a cross-asset page has no single
 * form, so this widget takes a list and merges. Colour comes from the reserved
 * status palette rather than a per-question colour map, because the question
 * differs per family but the meaning does not.
 */
const MultiAssetMap = ({ item, filterState, height = 480 }) => {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const sources = useMemo(() => item?.sources || [], [item]);
  const administrationId = filterState?.administration_id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // One asset failing must not blank the national map — the rest is still a
    // valid, if partial, picture, so a rejected source becomes no points
    // rather than a rejected batch.
    Promise.all(
      sources.map((source) =>
        fetchSource(source, administrationId).catch(() => ({
          source,
          points: [],
          byParent: {},
          failed: true,
        }))
      )
    )
      .then((results) => {
        if (cancelled) {
          return;
        }
        setResponses(results);
        const failed = results.filter((r) => r.failed);
        if (failed.length === sources.length && sources.length > 0) {
          setError(new Error("No asset could be loaded"));
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sources, administrationId]);

  const points = useMemo(() => buildStatusPoints(responses), [responses]);
  const counts = useMemo(() => countByStatus(points), [points]);
  const center = useMemo(() => {
    const d = geo?.defaultPos?.();
    return d?.coordinates || [0, 0];
  }, []);
  const failedLabels = responses
    .filter((r) => r.failed)
    .map((r) => r.source?.label || r.source?.key);

  if (error) {
    return <Alert type="error" showIcon message="Could not load the map." />;
  }

  return (
    <div className="dashboard-map">
      {failedLabels.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`${failedLabels.join(
            ", "
          )} could not be loaded; showing the rest.`}
        />
      )}
      <Space wrap style={{ marginBottom: 8 }}>
        {BUCKETS.map((bucket) => (
          <Tag key={bucket.key} className="status-pill" color="default">
            <span
              className="dashboard-map-legend-dot"
              style={{ background: STATUS_TONE[bucket.key] }}
            />
            {bucket.label} · {counts[bucket.key]}
          </Tag>
        ))}
      </Space>
      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <MapContainer
          center={center}
          zoom={item.zoom || 7}
          style={{ height, width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {points
            .filter((point) => point.geo?.length === 2)
            .map((point) => (
              <Marker
                key={`${point.__sourceKey}-${point.id}`}
                position={point.geo}
                icon={markerIcon(point.__status)}
              >
                <Popup>
                  <div className="dashboard-map-popup">
                    <strong>{point.name}</strong>
                    <div>
                      <Tag className="status-pill">{point.__asset}</Tag>
                    </div>
                    <div>{point.administration_full_name}</div>
                    <div>
                      {BUCKETS.find((b) => b.key === point.__status)?.label}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
        </MapContainer>
      )}
    </div>
  );
};

MultiAssetMap.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  height: PropTypes.number,
};

export default MultiAssetMap;
