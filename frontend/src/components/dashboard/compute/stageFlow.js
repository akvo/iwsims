const DEFAULT_YES_VALUE = "yes";
const PASS_COLOR = "#2fb36d";
const FAIL_COLOR = "#e53935";
const NEUTRAL_COLOR = "#0d2b4c";
const MUTED_COLOR = "#9aa8b5";
const PASS_LINK = "#9bd8bb";
const FAIL_LINK = "#f2aaa6";
const MUTED_LINK = "#d8dee5";

const getRows = (response) => response?.data || [];

const selectedValues = (value) => {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).toLowerCase());
  }
  if (value === null || typeof value === "undefined") {
    return [];
  }
  return [String(value).toLowerCase()];
};

const positiveSet = (response, positiveValue = DEFAULT_YES_VALUE) => {
  const expected = String(positiveValue).toLowerCase();
  const out = new Set();
  getRows(response).forEach((row) => {
    if (selectedValues(row.value).includes(expected)) {
      out.add(String(row.group));
    }
  });
  return out;
};

const intersection = (left, right) => {
  const out = new Set();
  left.forEach((value) => {
    if (right.has(value)) {
      out.add(value);
    }
  });
  return out;
};

const differenceCount = (left, right) => {
  let count = 0;
  left.forEach((value) => {
    if (!right.has(value)) {
      count += 1;
    }
  });
  return count;
};

const fallbackTotal = (stageResponses) =>
  new Set(
    Object.values(stageResponses || {}).flatMap((response) =>
      getRows(response).map((row) => String(row.group))
    )
  ).size;

export const computeStageFlow = ({
  total,
  stages = [],
  responses = {},
  rootLabel = "All",
}) => {
  const stageSets = stages.map((stage) =>
    positiveSet(responses[stage.key], stage.positive_value)
  );
  const all = Math.max(
    Number(total) || 0,
    fallbackTotal(responses),
    stageSets[0]?.size || 0
  );

  const nodes = [
    {
      name: rootLabel,
      value: all,
      color: NEUTRAL_COLOR,
    },
  ];
  const links = [];
  const steps = [];

  let previousName = rootLabel;
  let previousSet = new Set(
    Array.from({ length: all }, (_, index) => `__all_${index}`)
  );

  stages.forEach((stage, index) => {
    const rawPositive = stageSets[index] || new Set();
    const passed =
      index === 0 ? rawPositive : intersection(previousSet, rawPositive);
    const failed =
      index === 0
        ? Math.max(0, all - passed.size)
        : differenceCount(previousSet, passed);
    const passLabel = stage.label;
    const failLabel =
      stage.fail_label ||
      (index === 0 ? `No ${stage.label}` : `Not ${stage.label}`);
    const passColor = stage.color || PASS_COLOR;
    const failColor =
      stage.fail_color || (index === 0 ? MUTED_COLOR : FAIL_COLOR);
    const passLinkColor = stage.link_color || PASS_LINK;
    const failLinkColor =
      stage.fail_link_color || (index === 0 ? MUTED_LINK : FAIL_LINK);

    nodes.push({ name: passLabel, value: passed.size, color: passColor });
    if (failed > 0) {
      nodes.push({ name: failLabel, value: failed, color: failColor });
    }

    if (passed.size > 0) {
      links.push({
        source: previousName,
        target: passLabel,
        value: passed.size,
        color: passLinkColor,
      });
    }
    if (failed > 0) {
      links.push({
        source: previousName,
        target: failLabel,
        value: failed,
        color: failLinkColor,
      });
    }

    steps.push({
      key: stage.key,
      label: passLabel,
      passed: passed.size,
      failed,
      failLabel,
    });
    previousName = passLabel;
    previousSet = passed;
  });

  return { counts: { all }, steps, nodes, links };
};

export default computeStageFlow;
