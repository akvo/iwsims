import React from "react";
import PropTypes from "prop-types";
import { Card, Descriptions, Empty, Image } from "antd";

import {
  answerValue,
  formatAnswer,
  imageUrlsFromValue,
  latestEntry,
  getText,
} from "../profile/lib/utils";

const ProfileHeader = ({ header, recordContext }) => {
  if (!header) {
    return null;
  }
  const text = recordContext?.text || {};
  const titleEntry = latestEntry(recordContext, header.title_question);
  const title =
    getText(text, header.title_key, header.title) ||
    formatAnswer(titleEntry, header.title_question);
  const photoEntry = latestEntry(recordContext, header.photo_question);
  const photos = imageUrlsFromValue(answerValue(photoEntry));

  return (
    <Card className="site-profile-header" bordered>
      <div className="site-profile-header-layout">
        <div>
          <h2>{title}</h2>
          {Array.isArray(header.fields) && header.fields.length ? (
            <Descriptions column={1} size="small">
              {header.fields.map((field) => (
                <Descriptions.Item
                  key={field.question}
                  label={getText(text, field.label_key, field.label)}
                >
                  {formatAnswer(
                    latestEntry(recordContext, field.question),
                    field.question
                  ) || "—"}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : null}
        </div>
        {photos.length ? (
          <Image.PreviewGroup>
            <Image src={photos[0]} alt={title} width={220} />
          </Image.PreviewGroup>
        ) : (
          <Empty description={text.siteProfileNoPhoto} />
        )}
      </div>
    </Card>
  );
};

ProfileHeader.propTypes = {
  header: PropTypes.object,
  recordContext: PropTypes.object,
};

export default ProfileHeader;
