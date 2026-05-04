import React, { useMemo } from "react";
import PropTypes from "prop-types";
import getQuestionOptions from "./getQuestionOptions";

const NO_DATA = "No monitoring data";

/**
 * Resolve the dynamic row's display value for a clicked datapoint
 * given the active filter and the byParent table.
 */
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
}) => {
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

  return (
    <div className="map-popup-card">
      <div className="map-popup-row">
        <span className="map-popup-label">Name</span>
        <span className="map-popup-value">{point.name || "—"}</span>
      </div>
      <div className="map-popup-row">
        <span className="map-popup-label">Location</span>
        <span className="map-popup-value">
          {point.administration_full_name || "—"}
        </span>
      </div>
      <div className="map-popup-row">
        <span className="map-popup-label">Last update</span>
        <span className="map-popup-value">{formatUpdated(point.updated)}</span>
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
};

export default MapPopupCard;
