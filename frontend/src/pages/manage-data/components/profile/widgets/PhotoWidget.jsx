import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Image } from "antd";

import {
  answerValue,
  imageUrlsFromValue,
  latestEntry,
  getText,
} from "../lib/utils";

const collectSubmissionPhotos = (submissions, question) =>
  (submissions || []).flatMap((submission) =>
    imageUrlsFromValue(submission.answers?.[question])
  );

const PhotoWidget = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const latestPhotos = imageUrlsFromValue(
    answerValue(latestEntry(recordContext, item.question))
  );
  const submissionPhotos =
    item.source === "submissions"
      ? collectSubmissionPhotos(
          recordContext?.payload?.submissions,
          item.question
        )
      : [];
  const photos =
    item.source === "submissions" ? submissionPhotos : latestPhotos;

  return (
    <Card
      title={getText(text, item.label_key, item.label || text.siteProfilePhoto)}
      bordered
    >
      {photos.length ? (
        <Image.PreviewGroup>
          <div className="site-profile-photo-grid">
            {photos.map((url) => (
              <Image
                key={url}
                src={url}
                alt={item.label || text.siteProfilePhoto}
              />
            ))}
          </div>
        </Image.PreviewGroup>
      ) : (
        <Empty description={text.siteProfileNoPhoto} />
      )}
    </Card>
  );
};

PhotoWidget.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default PhotoWidget;
