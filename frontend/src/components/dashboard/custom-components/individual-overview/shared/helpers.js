/**
 * Pure lookup + formatting helpers for the Individual Overview pattern.
 *
 * Centralises every walk over `window.forms` and every transform applied to
 * a `/data/<id>` answer payload, so shell components stay free of
 * form-walking code.
 */

const toNumericId = (id) => {
  if (typeof id === "number") {
    return id;
  }
  const n = Number(id);
  return Number.isNaN(n) ? id : n;
};

/**
 * Find a question definition by id across every form in `window.forms`.
 *
 * `window.forms` shape (set at app startup):
 *   [{ id, name, content: { question_group: [{ question: [{ id, label, type, option }] }] } }]
 *
 * @param {number|string} questionId
 * @returns {object|null}
 */
export const findQuestion = (questionId) => {
  if (questionId === null || typeof questionId === "undefined") {
    return null;
  }
  const target = toNumericId(questionId);
  const forms = window.forms || [];
  for (let i = 0; i < forms.length; i += 1) {
    const groups = forms[i]?.content?.question_group || [];
    for (let j = 0; j < groups.length; j += 1) {
      const questions = groups[j]?.question || [];
      const found = questions.find((q) => q?.id === target);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

/**
 * Find an answer entry for `questionId` from a /data/<id> response.
 *
 * @param {Array} values
 * @param {number|string} questionId
 * @returns {object|null}
 */
export const findAnswer = (values, questionId) => {
  if (
    !Array.isArray(values) ||
    questionId === null ||
    typeof questionId === "undefined"
  ) {
    return null;
  }
  const target = toNumericId(questionId);
  return values.find((v) => v?.question === target) || null;
};

const formatOptionAnswer = (value, question) => {
  const options = question?.option || [];
  const lookup = new Map(options.map((o) => [o?.value, o?.label || o?.value]));
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((v) => v !== null && typeof v !== "undefined" && v !== "")
    .map((v) => lookup.get(v) || v)
    .join(", ");
};

const formatGeoAnswer = (value) => {
  if (Array.isArray(value) && value.length >= 2) {
    return `${value[0]}, ${value[1]}`;
  }
  if (value && typeof value === "object" && "lat" in value && "lng" in value) {
    return `${value.lat}, ${value.lng}`;
  }
  return null;
};

/**
 * Pretty-print an answer value for display in tables. Returns null for
 * empty/missing values so callers can skip rendering.
 *
 * @param {object|null} answer
 * @param {object|null} question
 * @returns {string|null}
 */
export const formatAnswerValue = (answer, question) => {
  if (!answer) {
    return null;
  }
  const value = answer.value;
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }
  const type = question?.type;
  if (type === "option" || type === "multiple_option") {
    const text = formatOptionAnswer(value, question);
    return text || null;
  }
  if (type === "geo") {
    return formatGeoAnswer(value);
  }
  if (Array.isArray(value)) {
    const items = value.filter(
      (v) => v !== null && typeof v !== "undefined" && v !== ""
    );
    if (!items.length) {
      return null;
    }
    return items.join(", ");
  }
  return String(value);
};

/**
 * Extract a photo URL from an answer. Photo answers store the URL directly
 * in `value`. Non-string / blank values resolve to null.
 *
 * @param {Array} values
 * @param {number|string} questionId
 * @returns {string|null}
 */
export const extractPhotoUrl = (values, questionId) => {
  const answer = findAnswer(values, questionId);
  if (!answer) {
    return null;
  }
  const v = answer.value;
  if (typeof v === "string" && v.trim().length > 0) {
    return v;
  }
  return null;
};

/**
 * Find a question group definition by its id across every form in
 * `window.forms`. Returns null when not found.
 *
 * @param {number|string} groupId
 * @returns {object|null}
 */
export const findQuestionGroup = (groupId) => {
  if (groupId === null || typeof groupId === "undefined") {
    return null;
  }
  const target = toNumericId(groupId);
  const forms = window.forms || [];
  for (let i = 0; i < forms.length; i += 1) {
    const groups = forms[i]?.content?.question_group || [];
    const found = groups.find((g) => g?.id === target);
    if (found) {
      return found;
    }
  }
  return null;
};

/**
 * Walk every question in a question group, drop `type: "photo"`
 * questions and any whose answer resolves to null/empty, then join the
 * surviving formatted answers with `separator`. Used to combine all
 * answers inside a scope question group into a single cell (e.g. the
 * EPS Construction Information "Implementation / Construction" column).
 *
 * @param {number|string} groupId
 * @param {Array} values
 * @param {object} [options]
 * @param {string} [options.separator=", "]
 * @returns {string}            Empty string when the group is unknown
 *                               or every answer is empty.
 */
export const collectGroupAnswers = (groupId, values, options) => {
  const separator = options?.separator || ", ";
  const group = findQuestionGroup(groupId);
  if (!group) {
    return "";
  }
  const questions = group.question || [];
  const parts = [];
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    if (!q || q.type === "photo") {
      continue;
    }
    const answer = findAnswer(values, q.id);
    const formatted = formatAnswerValue(answer, q);
    if (formatted !== null && formatted !== "") {
      parts.push(formatted);
    }
  }
  return parts.join(separator);
};

/**
 * Convenience: findAnswer + findQuestion + formatAnswerValue.
 *
 * @param {Array} values
 * @param {number|string} questionId
 * @returns {string|null}
 */
export const resolveAnswerLabel = (values, questionId) => {
  const answer = findAnswer(values, questionId);
  if (!answer) {
    return null;
  }
  const question = findQuestion(questionId);
  return formatAnswerValue(answer, question);
};

/**
 * Sort an array of `{ date, ...rest }` ascending by date. Stable; entries
 * with null/missing dates sort first.
 *
 * @param {Array<{date: string|null}>} rows
 * @returns {Array}
 */
export const sortByDateAscending = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const ad = a.row?.date;
      const bd = b.row?.date;
      if (!ad && !bd) {
        return a.idx - b.idx;
      }
      if (!ad) {
        return -1;
      }
      if (!bd) {
        return 1;
      }
      const at = new Date(ad).getTime();
      const bt = new Date(bd).getTime();
      if (at === bt) {
        return a.idx - b.idx;
      }
      return at - bt;
    })
    .map((entry) => entry.row);
};
