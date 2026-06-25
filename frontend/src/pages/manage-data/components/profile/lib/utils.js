import React from "react";
import { Image, Tag } from "antd";

export const findQuestionByName = (name) => {
  if (!name) {
    return null;
  }
  const forms = window.forms || [];
  for (let i = 0; i < forms.length; i += 1) {
    const groups = forms[i]?.content?.question_group || [];
    for (let j = 0; j < groups.length; j += 1) {
      const found = (groups[j]?.question || []).find((q) => q?.name === name);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

export const resolveOption = (question, value) => {
  const opt = (question?.option || question?.options || []).find(
    (o) => o?.value === value
  );
  return opt
    ? { label: opt.label || opt.value, color: opt.color || null }
    : { label: value, color: null };
};

const SEVERITY_BY_COLOR = {
  "#009b77": "green",
  "#64a73b": "green",
  "#4a90e2": "green",
  "#efc050": "amber",
  "#dd4124": "red",
  "#e41a1c": "red",
  "#666666": "red",
};

export const optionSeverity = (color) =>
  color
    ? SEVERITY_BY_COLOR[String(color).toLowerCase()] || "neutral"
    : "neutral";

export const severityTagColor = (sev) =>
  ({ green: "green", amber: "gold", red: "red", neutral: "default" }[sev] ||
  "default");

export const getText = (text, key, fallback = "") => {
  if (key && text?.[key]) {
    return text[key];
  }
  return fallback;
};

export const emptyMark = "—";

export const latestEntry = (recordContext, questionName) =>
  questionName ? recordContext?.payload?.latest?.[questionName] : null;

export const answerValue = (entry) => {
  if (!entry) {
    return null;
  }
  if (Array.isArray(entry.options) && entry.options.length) {
    return entry.options;
  }
  if (entry.value !== null && typeof entry.value !== "undefined") {
    return entry.value;
  }
  return entry.name || null;
};

export const formatDate = (value) => {
  if (!value) {
    return emptyMark;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const formatAnswer = (entry, questionName) => {
  const value = answerValue(entry);
  if (value === null || value === "") {
    return null;
  }
  const question = findQuestionByName(questionName);
  if (Array.isArray(value)) {
    if (question?.type === "multiple_option" || entry?.options) {
      return value.map((v) => {
        const option = resolveOption(question, v);
        return option.label;
      });
    }
    return value.join(", ");
  }
  if (question?.type === "option" || question?.type === "multiple_option") {
    return resolveOption(question, value).label;
  }
  if (question?.type === "date") {
    return formatDate(value);
  }
  return String(value);
};

export const renderOptionTags = (entry, questionName) => {
  const question = findQuestionByName(questionName);
  const value = answerValue(entry);
  const values = Array.isArray(value) ? value : [value];
  return values
    .filter((v) => v !== null && typeof v !== "undefined" && v !== "")
    .map((v) => {
      const option = resolveOption(question, v);
      return (
        <Tag key={v} color={severityTagColor(optionSeverity(option.color))}>
          {option.label}
        </Tag>
      );
    });
};

export const renderValue = (entry, questionName) => {
  const question = findQuestionByName(questionName);
  if (
    question?.type === "option" ||
    question?.type === "multiple_option" ||
    Array.isArray(entry?.options)
  ) {
    const tags = renderOptionTags(entry, questionName);
    return tags.length ? tags : emptyMark;
  }
  return formatAnswer(entry, questionName) || emptyMark;
};

export const getQuestionLabel = (text, item, keyName = "question") => {
  const questionName = item?.[keyName];
  const question = findQuestionByName(questionName);
  return getText(
    text,
    item?.label_key,
    item?.label || question?.label || questionName
  );
};

export const passThreshold = (rawValue, threshold) => {
  const numeric = Number(rawValue);
  if (!threshold || Number.isNaN(numeric)) {
    return null;
  }
  if (
    threshold.min !== null &&
    typeof threshold.min !== "undefined" &&
    numeric < Number(threshold.min)
  ) {
    return false;
  }
  if (
    threshold.max !== null &&
    typeof threshold.max !== "undefined" &&
    numeric > Number(threshold.max)
  ) {
    return false;
  }
  return true;
};

export const thresholdLabel = (threshold, unit = "") => {
  if (!threshold) {
    return emptyMark;
  }
  const suffix = unit ? ` ${unit}` : "";
  if (
    threshold.min !== null &&
    typeof threshold.min !== "undefined" &&
    threshold.max !== null &&
    typeof threshold.max !== "undefined"
  ) {
    return `${threshold.min}${suffix} - ${threshold.max}${suffix}`;
  }
  if (threshold.max !== null && typeof threshold.max !== "undefined") {
    return `< ${threshold.max}${suffix}`;
  }
  if (threshold.min !== null && typeof threshold.min !== "undefined") {
    return `> ${threshold.min}${suffix}`;
  }
  return emptyMark;
};

export const imageUrlsFromValue = (value) => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => {
      if (Array.isArray(entry)) {
        return entry;
      }
      return entry;
    })
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0);
};

export const renderPhotoThumb = (entry, questionName, text) => {
  const urls = imageUrlsFromValue(answerValue(entry));
  if (!urls.length) {
    return emptyMark;
  }
  return (
    <Image.PreviewGroup>
      {urls.map((url) => (
        <Image
          key={url}
          src={url}
          alt={getQuestionLabel(text, { question: questionName })}
          width={42}
          height={42}
          style={{ objectFit: "cover", borderRadius: 4 }}
        />
      ))}
    </Image.PreviewGroup>
  );
};
