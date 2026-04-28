/**
 * Accessibility bucket transform for dashboard stack_bar widgets with
 * `compute: "accessibility_bucket"`. Joins two per-parent
 * option-question /values responses (sample question + issues question)
 * by parent_id (row.group) and emits a single StackBar row with three
 * bucket counts.
 *
 * Pure function — no fetching. Caller fans out sample_api + issues_api
 * calls upstream and passes both responses in.
 *
 * Expected response shape (per akvo-mis-bvt backend patch):
 *
 *   {
 *     data: [
 *       { label: parent_name, group: parent_id, Yes: 0|1, No: 0|1 },
 *       ...
 *     ]
 *   }
 *
 * The exact column labels ("Yes" / "No") come from the question's
 * QuestionOptions. We treat any case-insensitive match of "yes" / "no"
 * as the sample/issues answer so this function stays tolerant of
 * localisation ("Yes" vs "yes" vs "YES").
 *
 * Derivation rule (requirements.md §A.2):
 *   sample=yes ∧ issues≠yes → easily_accessible
 *   sample=yes ∧ issues=yes → accessible_with_issues
 *   sample=no                → not_accessible
 *   no sample record OR all-zero sample row → EXCLUDED
 */

const BUCKETS = [
  "easily_accessible",
  "accessible_with_issues",
  "not_accessible",
];

/**
 * Return "yes" / "no" / null for a per-parent row by inspecting which
 * option column has count > 0. Column label match is case-insensitive.
 */
const rowAnswer = (row) => {
  if (!row) {
    return null;
  }
  const keys = Object.keys(row);
  const hit = keys.find((k) => k !== "label" && k !== "group" && row[k] > 0);
  if (!hit) {
    return null;
  }
  const lower = hit.toLowerCase();
  if (lower === "yes") {
    return "yes";
  }
  if (lower === "no") {
    return "no";
  }
  return null;
};

/**
 * Given a parent's latest sample answer and issues answer, return the
 * bucket key or null if the parent should be excluded.
 *
 * @param {"yes"|"no"|null} sampleAnswer
 * @param {"yes"|"no"|null} issuesAnswer
 * @returns {"easily_accessible"|"accessible_with_issues"|"not_accessible"|null}
 */
export const deriveAccessibilityBucket = (sampleAnswer, issuesAnswer) => {
  if (sampleAnswer === null || typeof sampleAnswer === "undefined") {
    return null;
  }
  if (sampleAnswer === "no") {
    return "not_accessible";
  }
  if (sampleAnswer === "yes") {
    return issuesAnswer === "yes"
      ? "accessible_with_issues"
      : "easily_accessible";
  }
  return null;
};

/**
 * Tally accessibility buckets across all parents and return a single
 * StackBar row.
 *
 * @param {{
 *   sample: {data: Array<object>}|null,
 *   issues: {data: Array<object>}|null,
 * }} responses
 * @param {{easily_accessible:string, accessible_with_issues:string, not_accessible:string}} labels
 * @returns {Array<object>} single-row StackBar data
 */
export const computeAccessibilityBucket = (responses, labels) => {
  const row = { category: "Accessibility" };
  BUCKETS.forEach((key) => {
    row[labels[key]] = 0;
  });

  const sampleRows = responses?.sample?.data || [];
  const issuesRows = responses?.issues?.data || [];

  const issuesByParent = new Map();
  issuesRows.forEach((r) => {
    issuesByParent.set(r.group, rowAnswer(r));
  });

  sampleRows.forEach((r) => {
    const sample = rowAnswer(r);
    const issues = issuesByParent.get(r.group);
    const bucket = deriveAccessibilityBucket(sample, issues);
    if (bucket) {
      row[labels[bucket]] += 1;
    }
  });

  return [row];
};

export default computeAccessibilityBucket;
