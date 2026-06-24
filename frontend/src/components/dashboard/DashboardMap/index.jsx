import React, { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { divIcon } from "leaflet";
import { Alert, Skeleton } from "antd";
import "leaflet/dist/leaflet.css";
import { api, geo } from "../../../lib";
import { applyDashboardFilters } from "../../../lib/dashboardFilterHints";
import { conicGradient } from "../../map-view/markerGradient";
import DashboardMapHeader, { resolveBuckets } from "./DashboardMapHeader";
import MapPopupCard from "./MapPopupCard";
import useMapFilters from "./useMapFilters";
import useMapByParent from "./useMapByParent";
import resolveColorMap from "./resolveColorMap";
import "./styles.scss";

const DEFAULT_COLOR = "#1890ff";

/**
 * Build a leaflet divIcon for a datapoint: a single coloured dot, or an
 * equal-segment conic-gradient pie when it has several selected options
 * (multiple_option) — matching the manage-data MapView.
 */
const buildMarkerIcon = (segments) => {
  const colors = segments.map((s) => s.color).filter(Boolean);
  const background =
    colors.length > 1 ? conicGradient(colors) : colors[0] || DEFAULT_COLOR;
  return divIcon({
    className: "dashboard-map-marker",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span class="dashboard-map-marker-dot" style="background:${background};"></span>`,
  });
};

/**
 * Config-driven dashboard map widget.
 *
 * Endpoints:
 *   GET /api/v1/maps/geolocation/{source_form_id}
 *       [?administration=<id>&criteria=...&from_date=...
 *        &to_date=...&include_monitoring=true]
 *   GET /api/v1/visualization/values         (option question_name filters)
 *   GET /api/v1/visualization/values/formula (formula filters)
 *       (per active select filter; cross-form, scoped by
 *        parent_form_id = source_form_id)
 *
 * The geolocation response carries id, name, geo, administration_id,
 * administration_full_name, updated. byParent[id] is the array of the
 * active filter's selected values for the datapoint, used for the
 * (segmented) marker colour, the popup's dynamic row, and chip-based
 * narrowing.
 */
const DashboardMap = ({
  item,
  filterState,
  customFilterDefs = [],
  definitionsById,
  parentFormId,
  height = 400,
}) => {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const datapointCache = useRef({});

  const sourceFormId = item?.source_form_id || parentFormId;
  const urlTemplate =
    item?.click_url_template ||
    "/control-center/data/{parent_form_id}/monitoring/{data_id}";

  const itemFilters = useMemo(
    () =>
      (item?.filters || []).map((filter) => {
        if (!filter.formula_ref) {
          return filter;
        }
        const definition = definitionsById?.get(filter.formula_ref);
        return {
          ...filter,
          formula: definition?.compliance_formula,
        };
      }),
    [item, definitionsById]
  );

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

  const { byParent } = useMapByParent({
    activeFilter,
    filterState,
    sourceFormId,
  });

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
    const includeMonitoring =
      Boolean(widgetIncludeMonitoring) && !toggleDisabled;

    // The map shows the whole fleet of plants. A monitoring-period date
    // range must NOT prune the universe by registration date (the
    // geolocation endpoint's no-include_monitoring branch filters on the
    // registration's `created`, which would drop plants onboarded before
    // the window). So dates are sent to /maps/geolocation only when the
    // "Monitored last year" toggle is on — there the backend narrows to
    // plants with a monitoring submission in the toggle's window via the
    // include_monitoring child-join. The global date range still scopes
    // marker colours through useMapByParent's /values call.
    if (includeMonitoring) {
      query.set("include_monitoring", widgetIncludeMonitoring);
      if (widgetFrom) {
        query.set("from_date", widgetFrom);
      }
      if (widgetTo) {
        query.set("to_date", widgetTo);
      }
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

  const colorMap = useMemo(
    () => resolveColorMap(activeFilter, sourceFormId),
    [activeFilter, sourceFormId]
  );

  // byParent[id] is an array of values; a datapoint with none answered
  // falls back to a single "_no_info" segment.
  const valuesForPoint = (pointId) => {
    const v = byParent[pointId];
    return Array.isArray(v) && v.length > 0 ? v : ["_no_info"];
  };

  const segmentsForPoint = (pointId) =>
    valuesForPoint(pointId).map((value) => ({
      value,
      color: colorMap[value] || colorMap._no_info || DEFAULT_COLOR,
    }));

  const visiblePoints = useMemo(() => {
    const pts = points.filter(
      (p) => Array.isArray(p.geo) && p.geo.length === 2
    );
    if (!activeFilter) {
      return pts;
    }
    const buckets = resolveBuckets(activeFilter, sourceFormId);
    if (buckets.length === 0) {
      return pts;
    }
    // A datapoint is visible when ANY of its selected values is selected
    // in the legend (mirrors the manage-data map's multi-option filter).
    return pts.filter((p) =>
      valuesForPoint(String(p.id)).some((v) =>
        isChipSelected(activeFilter.key, v)
      )
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
        sourceFormId={sourceFormId}
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
          <Marker
            key={p.id}
            position={p.geo}
            icon={buildMarkerIcon(segmentsForPoint(String(p.id)))}
          >
            <Popup>
              <MapPopupCard
                point={p}
                activeFilter={activeFilter}
                byParent={byParent}
                urlTemplate={urlTemplate}
                sourceFormId={sourceFormId}
                cache={datapointCache}
              />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

DashboardMap.propTypes = {
  item: PropTypes.object.isRequired,
  filterState: PropTypes.object,
  customFilterDefs: PropTypes.array,
  definitionsById: PropTypes.instanceOf(Map),
  parentFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  height: PropTypes.number,
};

export default DashboardMap;
