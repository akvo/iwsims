/* global L */
import React, { useCallback, useEffect, useRef } from "react";
import { Button, Space } from "antd";
import { Map } from "akvo-charts";
import takeRight from "lodash/takeRight";
import { store, geo, config } from "../../lib";

import {
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
} from "@ant-design/icons";
import "./style.scss";

// Distance threshold for considering markers overlapping (~11 meters)
const OVERLAP_THRESHOLD = 0.0001;
// Spiral offset distance (~22 meters)
const OVERLAP_OFFSET_DISTANCE = 0.0002;

const applySpiralOffset = (coordinates, offsetIndex) => {
  if (offsetIndex <= 0) {
    return coordinates;
  }
  const angle = offsetIndex * 60 * (Math.PI / 180);
  const radius = OVERLAP_OFFSET_DISTANCE * Math.ceil(offsetIndex / 6);
  return [
    coordinates[0] + radius * Math.cos(angle),
    coordinates[1] + radius * Math.sin(angle),
  ];
};

// O(N) overlap detection via spatial hash bucket — replaces an O(N^2) scan
const buildOffsetCoordinates = (filteredDataset) => {
  const buckets = {};
  return filteredDataset.map((d) => {
    const key = `${Math.round(d.geo[0] / OVERLAP_THRESHOLD)}_${Math.round(
      d.geo[1] / OVERLAP_THRESHOLD
    )}`;
    const offsetIndex = buckets[key] || 0;
    buckets[key] = offsetIndex + 1;
    return applySpiralOffset(d.geo, offsetIndex);
  });
};

const MapView = ({ dataset, loading, position }) => {
  const selectedForm = store.useState((s) => s.selectedForm);
  const selectedAdm = store.useState((s) => s.administration);

  const mapInstance = useRef(null);
  const lg = useRef(null);
  const defPos = geo.defaultPos();

  const renderMarker = (d) => {
    if (d?.values?.length) {
      return `<span style="background: conic-gradient(${d.values
        .map(
          (v, i) =>
            `${v.color} ${i * (100 / d.values.length)}% ${
              (i + 1) * (100 / d.values.length)
            }%`
        )
        .join(", ")})"></span>`;
    }
    const bgColor = d?.color || "#64A73B";
    return `<span class="custom-marker" style="background-color:${bgColor};">${
      d?.value === null ||
      typeof d?.value === "undefined" ||
      !isNaN(d.value) === false
        ? ""
        : d.value >= 1000
        ? `${Math.floor(d.value / 1000)}k`
        : d.value
    }</span>`;
  };

  const mapStyle = (feature) => {
    const activeAdm = takeRight(selectedAdm, 1)[0];
    return {
      fillColor:
        feature.properties?.[activeAdm?.level_name] === activeAdm?.name
          ? "#01137C"
          : "#D2EDFF",
      color: "#01137C",
      weight: 2,
      opacity: 0.6,
      fillOpacity: 0.7,
    };
  };

  const disableScrollWheelZoom = useCallback(() => {
    const map = mapInstance.current?.getMap();
    if (map && !loading) {
      map.scrollWheelZoom.disable();
      map.zoomControl.remove();
      lg.current = L.layerGroup().addTo(map);
    }
  }, [loading]);

  const fitToBounds = useCallback(() => {
    if (mapInstance.current && position?.bbox && !loading) {
      const map = mapInstance.current.getMap();
      if (map) {
        map.fitBounds(position.bbox);
      }
    }
  }, [position, loading]);

  useEffect(() => {
    fitToBounds();
  }, [fitToBounds]);

  useEffect(() => {
    disableScrollWheelZoom();
  }, [disableScrollWheelZoom]);

  useEffect(() => {
    if (lg.current && !loading) {
      lg.current.clearLayers();
    }

    return () => {
      if (lg.current) {
        lg.current.clearLayers();
        lg.current = null;
      }
    };
  }, [lg, loading]);

  useEffect(() => {
    if (lg.current && !loading) {
      lg.current.clearLayers();

      const filteredDataset = dataset.filter(
        (d) =>
          !d?.hidden && d?.geo && Array.isArray(d.geo) && d.geo.length === 2
      );

      const offsets = buildOffsetCoordinates(filteredDataset);

      filteredDataset.forEach((d, index) => {
        const offsetCoords = offsets[index];
        const finalCoords = geo.fixCoordinates(offsetCoords);

        const marker = L.marker(finalCoords, {
          icon: L.divIcon({
            className: `custom-marker ${
              d?.values?.length > 1 ? "multiple-option" : ""
            }`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            html: renderMarker(d),
          }),
        }).bindPopup(
          `<a href="/control-center/data/${selectedForm}/monitoring/${d.id}" target="_blank" rel="noopener noreferrer" style="padding: 0;">${d.name}</a>`
        );
        lg.current.addLayer(marker);
      });
    }
  }, [lg, selectedForm, dataset, loading]);

  return (
    <div className="map-container">
      <div className="map-buttons">
        <Space size="small" direction="vertical">
          <Button
            type="secondary"
            icon={<FullscreenOutlined />}
            onClick={() => {
              const maps = mapInstance.current.getMap();
              maps.fitBounds(defPos.bbox);
            }}
          />
          <Button
            type="secondary"
            icon={<ZoomOutOutlined />}
            onClick={() => {
              const currentZoom = mapInstance.current.getMap().getZoom() - 1;
              mapInstance.current.getMap().setZoom(currentZoom);
            }}
          />
          <Button
            // disabled={zoomLevel >= mapMaxZoom}
            type="secondary"
            icon={<ZoomInOutlined />}
            onClick={() => {
              const maps = mapInstance.current.getMap();
              const currentZoom = maps.getZoom() + 1;
              maps.setZoom(currentZoom);
            }}
          />
        </Space>
      </div>
      <Map.Container
        tile={geo.tile}
        config={{
          center: config.mapConfig.defaultCenter,
          zoom: 8,
          height: 600,
          width: "100%",
        }}
        ref={(el) => {
          mapInstance.current = el;
        }}
      >
        {Map.getGeoJSONList(window?.topojson).map((sd, sx) => (
          <Map.GeoJson
            key={sx}
            data={sd}
            mapData={dataset}
            onClick={({ target }) => {
              mapInstance.current?.getMap()?.fitBounds(target._bounds);
            }}
            style={mapStyle}
          />
        ))}
      </Map.Container>
    </div>
  );
};

export default MapView;
