import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { api, uiText } from "../../../lib";
import { buildSiteDetailHref } from "../constants";
import getCrossFormQuestionOptions from "./getCrossFormQuestionOptions";

const LOADING = "…";

const resolveDynamic = (activeFilter, byParent, pointId, sourceFormId) => {
  if (!activeFilter) {
    return null;
  }
  const raw = byParent?.[pointId];
  // byParent[id] is an array of selected values; no row / empty array
  // means the datapoint has no answer → "_no_info".
  const values = Array.isArray(raw) && raw.length > 0 ? raw : ["_no_info"];
  if (activeFilter.formula) {
    const value = values[0];
    const buckets = activeFilter.formula.buckets || [];
    const found = buckets.find((b) => b.value === value);
    if (found) {
      return found.label;
    }
    if (activeFilter.formula.default?.value === value) {
      return activeFilter.formula.default.label;
    }
    return value;
  }
  if (activeFilter.question_name) {
    const opts = getCrossFormQuestionOptions(
      sourceFormId,
      activeFilter.question_name
    );
    const labels = values
      .filter((v) => v !== "_no_info")
      .map((v) => {
        const found = opts.find((o) => String(o.value) === String(v));
        return found ? found.label : v;
      });
    return labels.length > 0 ? labels.join(", ") : "_no_info";
  }
  return values[0];
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

  const detailHref = useMemo(
    () => buildSiteDetailHref(sourceFormId, point.id),
    [sourceFormId, point.id]
  );

  const dynamicValue = useMemo(() => {
    const answerValue = resolveDynamic(
      activeFilter,
      byParent,
      String(point.id),
      sourceFormId
    );

    return answerValue === "_no_info"
      ? uiText.en.noInformationAvailable
      : answerValue;
  }, [activeFilter, byParent, point.id, sourceFormId]);

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
  sourceFormId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  cache: PropTypes.object.isRequired,
};

export default MapPopupCard;
