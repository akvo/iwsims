import { rotateToFiscalOrder } from "../fiscalMonthRotation";
import { toHistogramBarData } from "../progressHistogram";
import { computeComplianceStackData, fails } from "../compliance";

describe("rotateToFiscalOrder", () => {
  const rows = [
    { group: "2025-01", value: 1, label: "Jan" },
    { group: "2025-04", value: 4, label: "Apr" },
    { group: "2025-07", value: 7, label: "Jul" },
    { group: "2025-10", value: 10, label: "Oct" },
    { group: "2025-12", value: 12, label: "Dec" },
  ];

  test("startMonth=7 rotates Jan-Jun to the tail", () => {
    const out = rotateToFiscalOrder(rows, 7).map((r) => r.group);
    expect(out).toEqual([
      "2025-07",
      "2025-10",
      "2025-12",
      "2025-01",
      "2025-04",
    ]);
  });

  test("startMonth=1 is a no-op after sorting", () => {
    const shuffled = [rows[3], rows[0], rows[2], rows[1], rows[4]];
    const out = rotateToFiscalOrder(shuffled, 1).map((r) => r.group);
    expect(out).toEqual([
      "2025-01",
      "2025-04",
      "2025-07",
      "2025-10",
      "2025-12",
    ]);
  });

  test("handles empty input", () => {
    expect(rotateToFiscalOrder([], 7)).toEqual([]);
    expect(rotateToFiscalOrder(null, 7)).toEqual([]);
  });
});

describe("toHistogramBarData", () => {
  test("maps histogram buckets to { label, value, group }", () => {
    const resp = {
      histogram: [
        { progress: "0-10%", count: 1 },
        { progress: "41-50%", count: 3 },
      ],
    };
    expect(toHistogramBarData(resp)).toEqual([
      { label: "0-10%", value: 1, group: "0-10%" },
      { label: "41-50%", value: 3, group: "41-50%" },
    ]);
  });

  test("null/missing response returns empty array", () => {
    expect(toHistogramBarData(null)).toEqual([]);
    expect(toHistogramBarData({})).toEqual([]);
  });
});

describe("compliance.fails", () => {
  test("returns false for null/undefined (no data)", () => {
    expect(fails({ max: 0 }, null)).toBe(false);
    let u;
    expect(fails({ max: 0 }, u)).toBe(false);
  });
  test("respects max bound", () => {
    expect(fails({ max: 0 }, 0)).toBe(false);
    expect(fails({ max: 0 }, 1)).toBe(true);
  });
  test("respects min bound", () => {
    expect(fails({ min: 6.5, max: 8.5 }, 6.0)).toBe(true);
    expect(fails({ min: 6.5, max: 8.5 }, 7.0)).toBe(false);
    expect(fails({ min: 6.5, max: 8.5 }, 9.0)).toBe(true);
  });
});

describe("computeComplianceStackData", () => {
  const parameters = [
    { key: "e_coli", label: "E. coli", threshold: { max: 0 } },
    { key: "ph", label: "pH", threshold: { min: 6.5, max: 8.5 } },
    { key: "hidden_one", label: "Hidden", threshold: { max: 0 }, hide: true },
  ];

  test("classifies two EPS as Yes and one as No with failure tally", () => {
    const responses = {
      e_coli: {
        data: [
          { group: "1", label: "A", value: 0 },
          { group: "2", label: "B", value: 5 },
          { group: "3", label: "C", value: 0 },
        ],
      },
      ph: {
        data: [
          { group: "1", label: "A", value: 7.0 },
          { group: "2", label: "B", value: 7.0 },
          { group: "3", label: "C", value: 9.5 },
        ],
      },
    };

    const out = computeComplianceStackData(parameters, responses);
    expect(out.yesCount).toBe(1); // EPS 1 only
    expect(out.noCount).toBe(2); // EPS 2 (e_coli), EPS 3 (ph)
    expect(out.stackLabels).toEqual(["Compliant", "E. coli", "pH"]);

    const yesRow = out.data.find((d) => d.compliance === "Yes");
    const noRow = out.data.find((d) => d.compliance === "No");
    expect(yesRow.Compliant).toBe(1);
    expect(noRow["E. coli"]).toBe(1);
    expect(noRow.pH).toBe(1);
  });

  test("skips hidden parameters", () => {
    const out = computeComplianceStackData(parameters, {});
    expect(out.stackLabels).not.toContain("Hidden");
  });

  test("missing value for a parameter counts as no-data, not violation", () => {
    const responses = {
      e_coli: { data: [{ group: "1", label: "A", value: 0 }] },
      // ph intentionally has no entry for group "1"
    };
    const out = computeComplianceStackData(parameters, responses);
    expect(out.yesCount).toBe(1);
    expect(out.noCount).toBe(0);
  });
});
