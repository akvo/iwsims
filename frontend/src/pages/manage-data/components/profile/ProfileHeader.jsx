import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Image } from "antd";

import {
  answerValue,
  emptyMark,
  formatAnswer,
  getText,
  imageUrlsFromValue,
  lastInspectionDate,
  latestEntry,
  registrationAnswer,
  registrationRawValue,
} from "./utils";

// "Village Name · District · Division" from registration answers. The
// administration answer is a path like "Fiji|Western" — drop the country
// segment and join with " · ".
const formatLocation = (header, recordContext) => {
  const registration = recordContext?.registration;
  const parts = [];
  if (header.village) {
    const village = registrationAnswer(registration, header.village);
    if (village) {
      parts.push(village);
    }
  }
  if (header.location) {
    const raw = registrationRawValue(registration, header.location);
    if (typeof raw === "string" && raw) {
      const segments = raw.split("|").filter(Boolean);
      const trimmed = segments.length > 1 ? segments.slice(1) : segments;
      if (trimmed.length) {
        parts.push(trimmed.join(" · "));
      }
    }
  }
  return parts.join(" · ");
};

const metaValue = (meta, recordContext, text) => {
  if (meta.source === "last_inspection") {
    return lastInspectionDate(recordContext?.payload) || emptyMark;
  }
  if (meta.question) {
    // Registration field first, then monitoring latest.
    let value = registrationAnswer(recordContext?.registration, meta.question);
    if (value === null) {
      const formatted = formatAnswer(
        latestEntry(recordContext, meta.question),
        meta.question
      );
      value = Array.isArray(formatted) ? formatted.join(", ") : formatted;
    }
    if (!value) {
      return emptyMark;
    }
    return meta.unit ? `${value} ${meta.unit}` : value;
  }
  if (meta.value_key || meta.value) {
    return getText(text, meta.value_key, meta.value);
  }
  return emptyMark;
};

// `header.photo` is a question name or a list of candidate photo questions
// (e.g. project-type photos). Collect every answered one (registration +
// monitoring latest), deduped — the form/project type decides which exist.
const headerPhotos = (header, recordContext) => {
  const names = Array.isArray(header.photo)
    ? header.photo
    : header.photo
    ? [header.photo]
    : [];
  const urls = names.flatMap((name) => [
    ...imageUrlsFromValue(
      registrationRawValue(recordContext?.registration, name)
    ),
    ...imageUrlsFromValue(answerValue(latestEntry(recordContext, name))),
  ]);
  return [...new Set(urls)];
};

const ProfileHeader = ({ config, recordContext }) => {
  const text = recordContext?.text || {};
  const payload = recordContext?.payload;
  const header = config?.header || {};
  const title = payload?.name || getText(text, config?.name_key, config?.name);
  const subtitle =
    formatLocation(header, recordContext) ||
    getText(text, config?.subtitle_key, config?.subtitle);
  const photos = headerPhotos(header, recordContext);
  const meta = header.meta || [];

  if (!title && !meta.length) {
    return null;
  }

  return (
    <Card className="site-profile-header" bordered>
      <div className="site-profile-hero">
        <div className="site-profile-hero-photo">
          {photos.length ? (
            <Image.PreviewGroup>
              <Image src={photos[0]} alt={title} />
              {photos.slice(1).map((url) => (
                <Image key={url} src={url} style={{ display: "none" }} />
              ))}
              {photos.length > 1 ? (
                <span className="site-profile-hero-photo-count">
                  +{photos.length - 1}
                </span>
              ) : null}
            </Image.PreviewGroup>
          ) : (
            <Empty description={text.siteProfileNoPhoto} />
          )}
        </div>
        <div className="site-profile-hero-info">
          <h2>{title}</h2>
          {subtitle ? (
            <div className="site-profile-hero-subtitle">{subtitle}</div>
          ) : null}
          {meta.length ? (
            <div className="site-profile-hero-meta">
              {meta.map((item, idx) => (
                <div
                  key={item.label_key || item.question || idx}
                  className="site-profile-hero-meta-item"
                >
                  <span className="k">
                    {getText(text, item.label_key, item.label)}
                  </span>
                  <span className="v">
                    {metaValue(item, recordContext, text)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};

ProfileHeader.propTypes = {
  config: PropTypes.object,
  recordContext: PropTypes.object,
};

export default ProfileHeader;
