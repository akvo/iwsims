import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Image } from "antd";

import {
  answerValue,
  getText,
  imageUrlsFromValue,
  latestEntry,
} from "../utils";

const Photo = ({ item, recordContext }) => {
  const text = recordContext?.text || {};
  const submissions = recordContext?.payload?.submissions || [];
  const photos =
    item.source === "submissions"
      ? submissions.flatMap((submission) =>
          imageUrlsFromValue(submission.answers?.[item.question])
        )
      : imageUrlsFromValue(
          answerValue(latestEntry(recordContext, item.question))
        );

  return (
    <Card
      title={getText(text, item.label_key, item.label || text.siteProfilePhoto)}
      bordered
    >
      {photos.length ? (
        <Image.PreviewGroup>
          <div className="site-profile-photo-grid">
            {photos.map((url) => (
              <Image key={url} src={url} />
            ))}
          </div>
        </Image.PreviewGroup>
      ) : (
        <Empty description={text.siteProfileNoPhoto} />
      )}
    </Card>
  );
};

Photo.propTypes = {
  item: PropTypes.object.isRequired,
  recordContext: PropTypes.object,
};

export default Photo;
