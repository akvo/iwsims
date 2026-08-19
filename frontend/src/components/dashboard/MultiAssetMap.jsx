import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { divIcon } from "leaflet";
import { Alert, Skeleton, Space, Tabs, Tag } from "antd";
import "leaflet/dist/leaflet.css";
import { api, geo } from "../../lib";
import { UNKNOWN, valuesByParent } from "./compute/assetStatus";
import { resolveFamilyFormula } from "./compute/complianceFormula";
import {
  buildModePoints,
  latestByParent,
  modeBuckets,
  resolveFamilies,
  resolveModes,
  toneColor,
  verdictsByParent,
} from "./compute/mapModes";
import FormulaInfo from "./widgets/FormulaInfo";
import "./DashboardMap/styles.scss";

const markerIcon = (color) =>
  divIcon({
    className: "dashboard-map-marker",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span class="dashboard-map-marker-dot" style="background:${color};"></span>`,
  });

/** One family's registered sites. Independent of the mode, so fetched once. */
const fetchPoints = (family, administrationId) => {
  const query = new URLSearchParams();
  if (administrationId) {
    query.set("administration", administrationId);
  }
  const qs = query.toString();
  const path = qs
    ? `/maps/geolocation/${family.form_id}?${qs}`
    : `/maps/geolocation/${family.form_id}`;
  return api.get(path).then((res) => res?.data || []);
};

/**
 * What the active mode needs to know about one family, as parent_id → answer.
 *
 * Three shapes, because three kinds of question: an option value, a date, and
 * a compliance verdict. The verdict comes from the formula endpoint using the
 * rule the family's own dashboard declares — the same call the National
 * Compliance Snapshot makes, so a pin cannot disagree with the ring.
 */
const fetchModeAnswers = (mode, source, administrationId) => {
  if (mode.type === "formula") {
    const formula = resolveFamilyFormula(source);
    if (!formula) {
      return Promise.resolve({});
    }
    return api
      .get("visualization/values/formula", {
        params: {
          parent_form_id: source.form_id,
          group_by: "parent_id",
          monitoring: "latest",
          formula: JSON.stringify(formula),
        },
      })
      .then((res) => verdictsByParent(res?.data?.data || []));
  }
  if (!source.question_name) {
    return Promise.resolve({});
  }
  return api
    .get("visualization/values", {
      params: {
        question_name: source.question_name,
        parent_form_id: source.form_id,
        group_by: "parent_id",
        monitoring: "latest",
        ...(administrationId ? { administration_id: administrationId } : {}),
      },
    })
    .then((res) =>
      mode.type === "recency"
        ? latestByParent(res?.data?.data || [])
        : valuesByParent(res?.data?.data || [])
    );
};

/**
 * A national map of every registered asset, coloured by whatever the active
 * mode asks of it.
 *
 * `DashboardMap` takes one `source_form_id`; a cross-asset page has no single
 * form, so this takes a list of families and merges. Colour comes from the
 * reserved status palette rather than a per-question colour map, because the
 * question differs per family but the meaning does not.
 *
 * Points and verdicts are fetched separately: switching mode re-asks the
 * question, not where the sites are.
 */
const MultiAssetMap = ({ item, filterState, height = 480, today }) => {
  const modes = useMemo(() => resolveModes(item), [item]);
  const families = useMemo(() => resolveFamilies(item), [item]);
  const [modeKey, setModeKey] = useState(modes[0]?.key);
  const mode = useMemo(
    () => modes.find((m) => m.key === modeKey) || modes[0],
    [modes, modeKey]
  );

  const [pointsByFamily, setPointsByFamily] = useState({});
  const [failedFamilies, setFailedFamilies] = useState([]);
  const [pointsLoading, setPointsLoading] = useState(true);
  // Answers are stamped with the mode that fetched them. Switching mode
  // re-renders before the new fetch lands, and the previous mode's answers
  // are not merely stale — they are a different shape. A date read as an
  // option value is not a wrong colour but a crash, so the stamp is checked
  // before they are used.
  const [answers, setAnswers] = useState({ modeKey: null, byFamily: {} });
  const [answersLoading, setAnswersLoading] = useState(true);
  const [error, setError] = useState(null);

  const administrationId = filterState?.administration_id;

  useEffect(() => {
    let cancelled = false;
    setPointsLoading(true);
    setError(null);
    // One asset failing must not blank the national map — the rest is still a
    // valid, if partial, picture, so a rejected family becomes no points
    // rather than a rejected batch.
    Promise.all(
      families.map((family) =>
        fetchPoints(family, administrationId)
          .then((points) => ({ family, points }))
          .catch(() => ({ family, points: [], failed: true }))
      )
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const next = {};
      results.forEach(({ family, points }) => {
        next[family.key] = points;
      });
      setPointsByFamily(next);
      setFailedFamilies(
        results
          .filter((r) => r.failed)
          .map((r) => r.family.label || r.family.key)
      );
      if (results.length > 0 && results.every((r) => r.failed)) {
        setError(new Error("No asset could be loaded"));
      }
      setPointsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [families, administrationId]);

  useEffect(() => {
    let cancelled = false;
    setAnswersLoading(true);
    const sources = mode?.sources || [];
    Promise.all(
      sources.map((source) =>
        fetchModeAnswers(mode, source, administrationId)
          .then((byParent) => ({ source, byParent }))
          .catch(() => ({ source, byParent: {} }))
      )
    ).then((results) => {
      if (cancelled) {
        return;
      }
      const next = {};
      results.forEach(({ source, byParent }) => {
        next[source.key] = byParent;
      });
      setAnswers({ modeKey: mode?.key, byFamily: next });
      setAnswersLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, administrationId]);

  const buckets = useMemo(() => modeBuckets(mode), [mode]);
  const colorOf = useMemo(() => {
    const byKey = {};
    buckets.forEach((bucket) => {
      byKey[bucket.key] = bucket.color;
    });
    return (key) => byKey[key] || toneColor("noData");
  }, [buckets]);

  // A mode's answers are only its own. Anything left over from the mode you
  // switched away from is discarded rather than classified.
  const answersForMode = useMemo(
    () => (answers.modeKey === mode?.key ? answers.byFamily : {}),
    [answers, mode]
  );

  const points = useMemo(
    () =>
      buildModePoints(families, pointsByFamily, mode, answersForMode, today),
    [families, pointsByFamily, mode, answersForMode, today]
  );

  const counts = useMemo(() => {
    const tally = {};
    buckets.forEach((bucket) => {
      tally[bucket.key] = 0;
    });
    points.forEach((point) => {
      const key = point.__status || UNKNOWN;
      tally[key] = (tally[key] || 0) + 1;
    });
    return tally;
  }, [points, buckets]);

  const center = useMemo(() => {
    const d = geo?.defaultPos?.();
    return d?.coordinates || [0, 0];
  }, []);

  const loading = pointsLoading || answersLoading;

  if (error) {
    return <Alert type="error" showIcon message="Could not load the map." />;
  }

  return (
    <div className="dashboard-map">
      {failedFamilies.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`${failedFamilies.join(
            ", "
          )} could not be loaded; showing the rest.`}
        />
      )}
      {modes.length > 1 && (
        // Nav only — the panes stay empty and the map below re-reads. Tabs
        // rather than a button strip so switching what the pins mean looks
        // like every other view switch on the dashboards.
        <Tabs
          className="compliance-snapshot-nav"
          activeKey={mode?.key}
          onChange={setModeKey}
          items={modes.map((m) => ({
            key: m.key,
            label: (
              <>
                {m.label}
                <FormulaInfo info={m.info} title={m.label} />
              </>
            ),
          }))}
        />
      )}
      {mode?.description && (
        <div className="dashboard-map-note">{mode.description}</div>
      )}
      <Space wrap style={{ marginBottom: 8 }}>
        {buckets.map((bucket) => (
          <Tag key={bucket.key} className="status-pill" color="default">
            <span
              className="dashboard-map-legend-dot"
              style={{ background: bucket.color }}
            />
            {bucket.label} · {counts[bucket.key] || 0}
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
                icon={markerIcon(colorOf(point.__status))}
              >
                <Popup>
                  <div className="dashboard-map-popup">
                    <strong>{point.name}</strong>
                    <div>
                      <Tag className="status-pill">{point.__asset}</Tag>
                    </div>
                    <div>{point.administration_full_name}</div>
                    <div>
                      {buckets.find((b) => b.key === point.__status)?.label}
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
  today: PropTypes.instanceOf(Date),
};

export default MultiAssetMap;
