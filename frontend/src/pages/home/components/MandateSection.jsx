import React from "react";

const MandateSection = ({ text }) => (
  <section className="page-section mandate-section" id="mandate">
    <div className="section-eyebrow reveal">{text.homeMandateTitle}</div>
    <h2 className="section-title reveal d1">{text.homeMandateHeadline}</h2>
    <p className="section-caption reveal d2">{text.homeMandateText}</p>

    <div className="mandate-grid">
      <figure className="mandate-media reveal">
        <span className="mandate-tag">{text.homeStructureTitle}</span>
        <img
          src={text?.homeStructureImage?.src}
          alt={text?.homeStructureImage?.alt}
        />
      </figure>
      <div className="mandate-body reveal d1">
        <h3>{text.homeStructureTitle}</h3>
        <p>{text.homeStructureText}</p>
      </div>
    </div>
  </section>
);

export default MandateSection;
