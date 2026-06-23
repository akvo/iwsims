const numeric = (answer) =>
  typeof answer === "number" && Number.isFinite(answer) ? answer : null;

const options = (answer) => (Array.isArray(answer) ? answer : []);

const empty = (answer) =>
  answer === null ||
  typeof answer === "undefined" ||
  (Array.isArray(answer) && answer.length === 0);

export const matchesFormulaCondition = (condition, answers = {}) => {
  if (Array.isArray(condition?.all_of)) {
    return condition.all_of.every((child) =>
      matchesFormulaCondition(child, answers)
    );
  }
  if (Array.isArray(condition?.any_of)) {
    return condition.any_of.some((child) =>
      matchesFormulaCondition(child, answers)
    );
  }

  const answer = answers[condition?.question_name];
  const value = numeric(answer);
  switch (condition?.op) {
    case "is_empty":
      return empty(answer);
    case "is_not_empty":
      return !empty(answer);
    case "option_equals":
    case "option_contains":
      return options(answer).includes(condition.value);
    case "option_not_contains":
      return !options(answer).includes(condition.value);
    case "<":
      return value !== null && value < condition.value;
    case "<=":
      return value !== null && value <= condition.value;
    case ">":
      return value !== null && value > condition.value;
    case ">=":
      return value !== null && value >= condition.value;
    case "==":
      return value !== null && value === condition.value;
    case "!=":
      return value !== null && value !== condition.value;
    case "between":
      return value !== null && value >= condition.min && value <= condition.max;
    case "option_in":
      return (condition.values || []).some((candidate) =>
        options(answer).includes(candidate)
      );
    default:
      return false;
  }
};

export const evaluateFormula = (formula, answers = {}) => {
  const bucket = (formula?.buckets || []).find((candidate) =>
    matchesFormulaCondition(candidate, answers)
  );
  return bucket || formula?.default || null;
};

export const matchingFormulaLabels = (bucket, answers = {}) => {
  const conditions = bucket?.any_of || bucket?.all_of || [];
  return conditions
    .filter((condition) => matchesFormulaCondition(condition, answers))
    .map((condition) => condition.label)
    .filter(Boolean);
};
