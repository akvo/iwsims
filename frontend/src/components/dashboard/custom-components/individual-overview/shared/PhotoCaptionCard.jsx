import React from "react";
import PropTypes from "prop-types";
import { Card, Empty, Image, Typography } from "antd";

const { Text } = Typography;

/**
 * Photo card with caption + AntD Image zoom. Renders <Empty> when no URL.
 */
const PhotoCaptionCard = ({
  photoUrl,
  caption,
  alt = "Photo",
  height = 240,
  title,
}) => {
  const cover = photoUrl ? (
    <Image
      src={photoUrl}
      alt={alt}
      height={height}
      style={{ objectFit: "cover", width: "100%" }}
      preview
    />
  ) : (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fafafa",
      }}
    >
      <Empty description="No photo available" />
    </div>
  );

  return (
    <Card title={title} cover={cover} bordered>
      {caption ? (
        <Text type="secondary">{caption}</Text>
      ) : (
        <Text type="secondary">No caption</Text>
      )}
    </Card>
  );
};

PhotoCaptionCard.propTypes = {
  photoUrl: PropTypes.string,
  caption: PropTypes.string,
  alt: PropTypes.string,
  height: PropTypes.number,
  title: PropTypes.string,
};

PhotoCaptionCard.defaultProps = {
  photoUrl: null,
  caption: null,
};

export default PhotoCaptionCard;
