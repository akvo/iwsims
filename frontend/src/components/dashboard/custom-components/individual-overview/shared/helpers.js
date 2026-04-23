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
