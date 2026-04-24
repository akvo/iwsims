/**
 * Cross-tab transform for dashboard stack_bar widgets with
 * `compute: "cross_tab"`. Joins two per-parent option-question /values
 * responses by parent_id (row.group) and emits one StackBar row per
 * category_label with a numeric field per series_label.
 *
 * Pure function — no fetching. Caller fans out category_api +
 * series_api calls upstream and passes both responses in.
 *
 * Expected response shape (per akvo-mis-bvt backend patch):
 *
 *   {
 *     data: [
 *       { label: parent_name, group: parent_id,
 *         [option_label_1]: count, [option_label_2]: count, ... },
 *       ...
 *     ]
 *   }
 *
 * Option columns carry 0|1 for single-select questions and 0|N for
 * multi-select. Non-option keys on each row are `label` and `group`;
 * everything else is treated as an option column.
 *
 * Semantics:
 *  - For each parent, the category is the option column with count > 0.
 *    If multiple (shouldn't happen for single-select question types, but
 *    a multi-select would take the first), the first option column wins.
 *    A parent with all-zero category row is dropped (no category).
 *  - For each parent, every series option column with count > 0
 *    contributes +1 to the (category, series_option) cell.
 *  - Parents present in series but absent from category are dropped
 *    (no inferred category).
 *
 * @param {{
 *   category: {data: Array<object>}|null,
 *   series:   {data: Array<object>}|null,
 * }} responses
 * @returns {Array<object>} StackBar-shaped rows
 */
const NON_OPTION_KEYS = new Set(["label", "group"]);

const optionColumnsWithCount = (row) =>
  Object.keys(row).filter((k) => !NON_OPTION_KEYS.has(k) && row[k] > 0);

export const computeCrossTab = (responses) => {
  if (!responses) {
    return [];
  }
  const categoryRows = responses.category?.data || [];
  const seriesRows = responses.series?.data || [];
  if (categoryRows.length === 0) {
    return [];
  }

  const categoryByParent = new Map();
  const orderedCategories = [];
  categoryRows.forEach((row) => {
    const cols = optionColumnsWithCount(row);
    if (cols.length === 0) {
      return;
    }
    const catLabel = cols[0];
    categoryByParent.set(row.group, catLabel);
    if (!orderedCategories.includes(catLabel)) {
      orderedCategories.push(catLabel);
    }
  });

  const byCategory = new Map();
  orderedCategories.forEach((catLabel) => {
    byCategory.set(catLabel, { category: catLabel });
  });

  seriesRows.forEach((row) => {
    const catLabel = categoryByParent.get(row.group);
    if (typeof catLabel === "undefined") {
      return;
    }
    const bucket = byCategory.get(catLabel);
    optionColumnsWithCount(row).forEach((optLabel) => {
      bucket[optLabel] = (bucket[optLabel] || 0) + 1;
    });
  });

  return Array.from(byCategory.values());
};

export default computeCrossTab;
