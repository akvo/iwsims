import React from "react";

// Configurable: change the landing-page intro video here.
// Supports youtube.com/watch?v=, youtu.be/, and youtube.com/embed/ URLs.
export const VIDEO_URL = "https://www.youtube.com/watch?v=kuM2l717A0w";

const YOUTUBE_ID_PATTERNS = [
  /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
  /(?:youtu\.be\/)([\w-]{11})/,
  /(?:youtube\.com\/embed\/)([\w-]{11})/,
];

const extractYouTubeId = (url) => {
  if (!url) {
    return null;
  }
  const match = YOUTUBE_ID_PATTERNS.map((p) => url.match(p)).find((m) => m);
  return match ? match[1] : null;
};

const VideoSection = ({ text, videoUrl = VIDEO_URL }) => {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) {
    return null;
  }
  const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`;
  return (
    <section className="page-section video-section" id="video">
      <div className="section-eyebrow reveal">{text.homeVideoTitle}</div>
      <h2 className="section-title reveal d1">{text.homeVideoHeadline}</h2>
      <p className="section-caption reveal d2">{text.homeVideoText}</p>

      <figure className="video-frame reveal d3">
        <div className="video-frame-inner">
          <iframe
            src={embedSrc}
            title={text.homeVideoIframeTitle}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      </figure>
    </section>
  );
};

export default VideoSection;
