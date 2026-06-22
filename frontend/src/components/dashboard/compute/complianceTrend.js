/**
 * Monthly compliance-trend transform (frontend compute, no backend changes).
 *
 * For each domain we want, per month, the % of WWTPs passing that domain's
 * rule. Two rule shapes are supported, each fed by an existing /values call:
 *
 *  - `option_share` — one `group_by:month` + `stack_by:option` response. Each
 *    row is a month with one numeric column per option label. The pass-rate is
 *    the pass option's count over the sum of all option columns (answered
 *    plants that month). Used for OHS (ohs_equipment_available = "yes").
 *
 *  - `threshold_all` — one `group_by:month` + `stack_by:parent_id` response per
 *    numeric param (each row is a month, each parent a column carrying that
 *    month's aggregated value). A parent passes if every param it has a value
 *    for satisfies its threshold (a missing param is "no data", not a fail —
 *    matching the latest-snapshot Effluent Compliance KPI). Denominator = the
 *    parents with at least one param value that month. Used for Effluent
 *    (BOD<40 & COD<100 & TDS<1000).
 *
 * Output aligns to a caller-supplied month axis so every series shares the same
 * x categories; a month with no answered plants yields `null` (gap in the line).
 */
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Parse a backend month label ("Jun 2025") into a "YYYY-MM" key. */
export const monthLabelToKey = (label = "") => {
  const [mon, year] = String(label).trim().split(/\s+/);
  const idx = MONTHS_SHORT.indexOf(mon);
  if (idx === -1 || !year) {
    return null;
  }
  return `${year}-${String(idx + 1).padStart(2, "0")}`;
};

const satisfies = (value, op, target) => {
  switch (op) {
    case "<":
      return value < target;
    case "<=":
      return value <= target;
    case ">":
      return value > target;
    case ">=":
      return value >= target;
    case "=":
      return value === target;
    case "<>":
      return value !== target;
    default:
      return false;
  }
};

const sumExcept = (row, exclude) =>
  Object.keys(row).reduce(
    (s, k) => (k === exclude || typeof row[k] !== "number" ? s : s + row[k]),
    0
  );

const optionShareByMonth = (domain, response) => {
  const byKey = {};
  (response?.data || []).forEach((row) => {
    const key = monthLabelToKey(row.month);
    if (!key) {
      return;
    }
    const passKey = Object.keys(row).find(
      (k) =>
        k !== "month" && k.toLowerCase() === domain.pass_value.toLowerCase()
    );
    const pass = passKey ? row[passKey] || 0 : 0;
    const total = sumExcept(row, "month");
    byKey[key] = total > 0 ? Math.round((pass / total) * 100) : null;
  });
  return byKey;
};

const thresholdAllByMonth = (domain, responsesByParam) => {
  // month -> parent -> { value per param }
  const monthParents = {};
  (domain.params || []).forEach((param) => {
    const resp = responsesByParam[param.question_name];
    (resp?.data || []).forEach((row) => {
      const key = monthLabelToKey(row.month);
      if (!key) {
        return;
      }
      const parents = (monthParents[key] = monthParents[key] || {});
      Object.keys(row).forEach((col) => {
        if (col === "month" || typeof row[col] !== "number") {
          return;
        }
        const cell = (parents[col] = parents[col] || {});
        cell[param.question_name] = row[col];
      });
    });
  });

  const byKey = {};
  Object.keys(monthParents).forEach((key) => {
    const parents = monthParents[key];
    let denom = 0;
    let pass = 0;
    Object.keys(parents).forEach((parent) => {
      const vals = parents[parent];
      const present = (domain.params || []).filter(
        (p) => typeof vals[p.question_name] === "number"
      );
      if (present.length === 0) {
        return;
      }
      denom += 1;
      const ok = present.every((p) =>
        satisfies(vals[p.question_name], p.op, p.value)
      );
      if (ok) {
        pass += 1;
      }
    });
    byKey[key] = denom > 0 ? Math.round((pass / denom) * 100) : null;
  });
  return byKey;
};

/**
 * @param {Array} domains  domain specs (type option_share | threshold_all)
 * @param {Array<{key:string,label:string}>} monthAxis  ordered month buckets
 * @param {Object} responses  { [fetchKey]: /values response }
 *   fetchKey = `${domain.key}__share` (option_share) or
 *              `${domain.key}__${question_name}` (threshold_all)
 * @returns {{months:string[], series:Array<{key,label,color,data:(number|null)[]}>}}
 */
export const computeComplianceTrend = (
  domains = [],
  monthAxis = [],
  responses = {}
) => {
  const series = (domains || []).map((domain) => {
    let byKey = {};
    if (domain.type === "option_share") {
      byKey = optionShareByMonth(domain, responses[`${domain.key}__share`]);
    } else if (domain.type === "threshold_all") {
      const responsesByParam = {};
      (domain.params || []).forEach((p) => {
        responsesByParam[p.question_name] =
          responses[`${domain.key}__${p.question_name}`];
      });
      byKey = thresholdAllByMonth(domain, responsesByParam);
    }
    return {
      key: domain.key,
      label: domain.label,
      color: domain.color,
      data: monthAxis.map((m) =>
        typeof byKey[m.key] === "number" ? byKey[m.key] : null
      ),
    };
  });

  return { months: monthAxis.map((m) => m.label), series };
};

export default computeComplianceTrend;
