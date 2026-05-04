import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { api } from "../../../lib";
import getQuestionOptions from "./getQuestionOptions";

const NO_DATA = "No monitoring data";
const LOADING = "…";

const resolveDynamic = (activeFilter, byParent, pointId) => {
  if (!activeFilter) {
    return null;
  }
  const raw = byParent?.[pointId];
  if (raw === null || typeof raw === "undefined") {
    return NO_DATA;
  }
  if (activeFilter.formula) {
    const buckets = activeFilter.formula.buckets || [];
    const found = buckets.find((b) => b.value === raw);
    if (found) {
      return found.label;
    }
    if (activeFilter.formula.default?.value === raw) {
      return activeFilter.formula.default.label;
    }
    return raw;
  }
  if (activeFilter.question_id) {
    const opts = getQuestionOptions(
      activeFilter.form_id,
      activeFilter.question_id
    );
    const found = opts.find((o) => String(o.value) === String(raw));
    return found ? found.label : raw;
  }
  return raw;
};

const formatUpdated = (iso) => {
  if (!iso) {
    return "—";
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toISOString().slice(0, 10);
  } catch (e) {
    return iso;
  }
};

const MapPopupCard = ({
  point,
  activeFilter,
  byParent,
  urlTemplate,
  sourceFormId,
  cache,
}) => {
  const cached = cache.current[point.id];
  const [detail, setDetail] = useState(cached || null);
  const [loadingDetail, setLoadingDetail] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    if (!cache.current[point.id]) {
      api
        .get(`/maps/datapoint/${point.id}`)
        .then((res) => {
          if (cancelled) {
            return;
          }
          cache.current[point.id] = res.data;
          setDetail(res.data);
          setLoadingDetail(false);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setLoadingDetail(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [point.id, cache]);

  const detailHref = useMemo(() => {
    if (!urlTemplate) {
      return null;
    }
    return urlTemplate
      .replace("{parent_form_id}", sourceFormId)
      .replace("{data_id}", point.id);
  }, [urlTemplate, sourceFormId, point.id]);

  const dynamicValue = useMemo(
    () => resolveDynamic(activeFilter, byParent, String(point.id)),
    [activeFilter, byParent, point.id]
  );

  const locationValue = loadingDetail
    ? LOADING
    : detail?.administration_full_name || "—";
  const updatedValue = loadingDetail ? LOADING : formatUpdated(detail?.updated);

  return (
    <div className="map-popup-card">
      <div className="map-popup-row">
        <span className="map-popup-label">Name</span>
        <span className="map-popup-value">{point.name || "—"}</span>
      </div>
      <div className="map-popup-row">
        <span className="map-popup-label">Location</span>
        <span className="map-popup-value">{locationValue}</span>
      </div>
      <div className="map-popup-row">
        <span className="map-popup-label">Last update</span>
        <span className="map-popup-value">{updatedValue}</span>
      </div>
      {activeFilter && (
        <div className="map-popup-row">
          <span className="map-popup-label">{activeFilter.label}</span>
          <span className="map-popup-value">{dynamicValue}</span>
        </div>
      )}
      {detailHref && (
        <div className="map-popup-row map-popup-link">
          <a href={detailHref} target="_blank" rel="noopener noreferrer">
            View details
          </a>
        </div>
      )}
    </div>
  );
};

MapPopupCard.propTypes = {
  point: PropTypes.object.isRequired,
  activeFilter: PropTypes.object,
  byParent: PropTypes.object,
  urlTemplate: PropTypes.string,
  sourceFormId: PropTypes.number,
  cache: PropTypes.object.isRequired,
};

export default MapPopupCard;
