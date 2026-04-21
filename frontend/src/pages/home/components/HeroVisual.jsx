import React from "react";

const HeroVisual = ({ image, captionEyebrow, captionTitle }) => (
  <div className="hero-visual-wrap">
    <div className="ripples" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
    <div className="hero-visual">
      <img src={image?.src} alt={image?.alt} />
      <div className="hero-visual-overlay" />
      <div className="hero-visual-caption">
        <div className="hv-eyebrow">{captionEyebrow}</div>
        <div className="hv-title">{captionTitle}</div>
      </div>
    </div>
  </div>
);

export default HeroVisual;
