/**
 * Rotate a chronologically-ordered `/values` response with `group_by=month`
 * to fiscal-year order. Input rows have `{ value, label, group: "YYYY-MM" }`.
 *
 * The backend returns groups sorted ascending by `YYYY-MM`. This helper
 * re-orders them so the first element is the fiscal-year anchor month
 * (e.g. July when `startMonth=7`).
 *
 * @param {Array<{value:number,label:string,group:string}>} rows
 * @param {number} startMonth  1..12 (January = 1)
 * @returns {Array} re-ordered copy
 */
export const rotateToFiscalOrder = (rows, startMonth = 1) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const parseMonth = (g) => {
    const [, m] = (g || "").split("-");
    return Number(m);
  };

  const sorted = [...rows].sort((a, b) =>
    (a.group || "").localeCompare(b.group || "")
  );

  const firstAfter = sorted.findIndex((r) => parseMonth(r.group) >= startMonth);
  if (firstAfter <= 0) {
    return sorted;
  }

  return [...sorted.slice(firstAfter), ...sorted.slice(0, firstAfter)];
};

export default rotateToFiscalOrder;
