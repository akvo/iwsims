/**
 * Per-entity score histogram (frontend compute, no backend changes).
 *
 * Answers "how many of N checks did each entity pass?" and bins the resulting
 * scores into one bar per score. Each check is one `group_by: "parent_id"`
 * /values call, so the caller fans out one row-per-parent response per segment
 * and passes the response map in, keyed by segment.key.
 *
 * A segment passes when the parent's answer equals `pass_value` (default
 * "yes"). `pass_value` is declared per segment precisely so a check whose
 * healthy state is "no" can be scored without special-casing it here — the
 * WWTP OHS score relies on that, since "Do you have urgent maintenance
 * programs?" is a warning when answered yes, which is why the condition
 * matrix already tones it `yes: mid` rather than `yes: good`.
 *
 * Entities that did not answer every segment are excluded by default, because
 * a bar labelled `2/8` claims something about the other six. Set
 * `partial: true` to count every entity that answered at least one segment;
 * the axis then has to drop its denominator too, so that a bar reads "two
 * checks were confirmed" rather than "two of eight passed". The two flags go
 * together — `partial` with a `label_suffix` still prints the fraction it was
 * meant to retire.
 *
 * Excluding is the more costly option of the two, and how costly depends on
 * the dataset rather than on the chart: the WWTP OHS section is split across
 * two question groups, so the share of plants answering only one of them
 * moves with the data. That is the argument for counting — a chart whose
 * population swings with form-filling habits describes those habits, not the
 * fleet. Callers should surface `excluded` whenever they keep the default, so
 * a dropped population is never silently invisible.
 */

/** Normalise an answer cell for comparison. /values returns option answers as
 *  a single-element array (`["yes"]`); numbers and bare strings also appear. */
const normAnswer = (v) => {
  const raw = Array.isArray(v) ? v[0] : v;
  if (raw === null || typeof raw === "undefined") {
    return null;
  }
  return String(raw).trim().toLowerCase();
};

/**
 * Build parent -> { [segmentKey]: answer } from the per-segment responses.
 * Each row is one parent: `group` is the parent id, `value` the answer.
 * (`label` is the entity's display name, not the option label.)
 */
const buildByParent = (segments, responses) => {
  const byParent = {};
  (segments || []).forEach((segment) => {
    const rows = responses?.[segment.key]?.data || [];
    rows.forEach((row) => {
      const parent = row?.group;
      if (parent === null || typeof parent === "undefined") {
        return;
      }
      const answer = normAnswer(row.value);
      if (answer === null) {
        return;
      }
      const cell = (byParent[parent] = byParent[parent] || {});
      cell[segment.key] = answer;
    });
  });
  return byParent;
};

/**
 * @param {Array<{key:string,label?:string,pass_value?:string}>} segments
 * @param {Object.<string,object>} responses  { [segment.key]: /values response }
 * @param {object} [options]
 * @param {boolean} [options.partial]       score entities that answered only some segments
 * @param {string}  [options.label_suffix]  appended to each bar label, e.g. "/8"
 * @returns {{data: Array<{label:string,value:number}>, scored:number, excluded:number}}
 */
export const computeScoreHistogram = (
  segments = [],
  responses = {},
  options = {}
) => {
  const total = (segments || []).length;
  if (total === 0) {
    return { data: [], scored: 0, excluded: 0 };
  }

  const byParent = buildByParent(segments, responses);
  const counts = new Array(total + 1).fill(0);
  let scored = 0;
  let excluded = 0;

  Object.values(byParent).forEach((cells) => {
    const answered = segments.filter((s) => typeof cells[s.key] === "string");
    if (answered.length === 0) {
      return;
    }
    if (!options.partial && answered.length < total) {
      excluded += 1;
      return;
    }
    const score = segments.filter(
      (s) => cells[s.key] === String(s.pass_value ?? "yes").toLowerCase()
    ).length;
    counts[score] += 1;
    scored += 1;
  });

  const suffix = options.label_suffix || "";
  return {
    data: counts.map((value, score) => ({ label: `${score}${suffix}`, value })),
    scored,
    excluded,
  };
};

export default computeScoreHistogram;
