import React from "react";
import RoleCard from "./RoleCard";

const RolesSection = ({ text }) => (
  <div className="roles-shell">
    <section className="page-section" id="key-roles">
      <div className="section-eyebrow reveal">{text.homeKeyRolesTitle}</div>
      <h2 className="section-title reveal d1">{text.homeKeyRolesHeadline}</h2>
      <p className="section-caption reveal d2">{text.homeKeyRolesText}</p>

      <div className="roles">
        {text.homeKeyRolesItems.map((item, index) => (
          <RoleCard key={index} item={item} index={index} />
        ))}
      </div>
    </section>
  </div>
);

export default RolesSection;
