import React from "react";

const RoleCard = ({ item, index }) => {
  const delayClass = index > 0 ? ` d${Math.min(index, 3)}` : "";
  const numLabel = `${String(index + 1).padStart(2, "0")} · ${item.title}`;

  return (
    <article className={`role reveal${delayClass}`}>
      <div className="role-media">
        <span className="role-num">{numLabel}</span>
        <img src={item.imgSrc} alt={item.imgAlt} />
      </div>
      <div className="role-body">
        <h3>{item.title}</h3>
        <p>{item.text}</p>
      </div>
    </article>
  );
};

export default RoleCard;
