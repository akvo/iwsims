import { rotateToFiscalOrder } from "../fiscalMonthRotation";
import {
  computeComplianceStackData,
  fails,
  getCompliantCount,
} from "../compliance";
import { computeCrossTab } from "../crossTab";
import {
  computeAccessibilityBucket,
  deriveAccessibilityBucket,
} from "../accessibility";
import { computeKpiStack } from "../kpiStack";
import { computeProcessCounts } from "../processCounts";
import { computeCapacityCompare } from "../capacityCompare";
import { computeDateHistogram } from "../dateHistogram";
import { computeStageFlow } from "../stageFlow";
import { computeValueBuckets } from "../valueBuckets";
import { computeGroupedStack } from "../groupedStack";
import { computeBucketBar } from "../bucketBar";
import { computeConditionField } from "../conditionMatrix";
import { CONDITION_TONE_COLORS } from "../../constants";
import {
  computeProcessBars,
  processToneColor,
  distinctParentCount,
} from "../processStatus";
import { computeComplianceTrend, monthLabelToKey } from "../complianceTrend";

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

  test("uses ordered formula buckets for Yes, No, no-info, and N/A", () => {
    const formulaParameters = [
      {
        key: "method",
        api: { question_name: "water_testing_method" },
      },
      {
        key: "e_coli",
        api: { question_name: "e_coli" },
      },
      {
        key: "ph_formula",
        api: { question_name: "ph" },
      },
    ];
    const formula = {
      buckets: [
        {
          value: "not_applicable",
          label: "N/A",
          all_of: [
            {
              question_name: "water_testing_method",
              op: "option_not_contains",
              value: "lab_test",
            },
          ],
        },
        {
          value: "non_compliant",
          label: "No",
          any_of: [
            {
              question_name: "e_coli",
              op: ">",
              value: 0,
              label: "E-coli",
            },
            {
              question_name: "ph",
              op: ">",
              value: 8.5,
              label: "pH",
            },
          ],
        },
        {
          value: "_no_info",
          label: "No information available",
          any_of: [{ question_name: "e_coli", op: "is_empty" }],
        },
      ],
      default: { value: "compliant", label: "Yes" },
    };
    const responses = {
      method: {
        data: [
          { group: "1", value: ["lab_test"] },
          { group: "2", value: ["lab_test"] },
          { group: "3", value: ["lab_test"] },
          { group: "4", value: ["cbt_test"] },
        ],
      },
      e_coli: {
        data: [
          { group: "1", value: 0 },
          { group: "2", value: 1 },
        ],
      },
      ph: {
        data: [{ group: "2", value: 9 }],
      },
    };

    const out = computeComplianceStackData(formulaParameters, responses, {
      formula,
      totalRegistered: 5,
    });

    expect(out.yesCount).toBe(1);
    expect(out.noCount).toBe(1);
    expect(out.noInfoCount).toBe(1);
    expect(out.notApplicableCount).toBe(2);
    expect(out.data).toEqual([
      { compliance: "Yes", Compliant: 1 },
      { compliance: "No", "E-coli": 1, pH: 0 },
      {
        compliance: "No information available",
        "No information available": 1,
      },
      { compliance: "N/A", "N/A": 2 },
    ]);
  });

  describe("include_unanswered support", () => {
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

    test("2-arg signature unchanged when options omitted", () => {
      const out = computeComplianceStackData(parameters, responses);
      expect(out.data).toHaveLength(2);
      expect(out.stackLabels).toEqual(["Compliant", "E. coli", "pH"]);
      expect(out.noInfoCount).toBe(0);
    });

    test("appends third row when totalRegistered exceeds yes+no", () => {
      const out = computeComplianceStackData(parameters, responses, {
        totalRegistered: 10,
      });
      expect(out.yesCount).toBe(1);
      expect(out.noCount).toBe(2);
      expect(out.noInfoCount).toBe(7);
      expect(out.data).toHaveLength(3);
      expect(out.data[2]).toEqual({
        compliance: "No information available",
        "No information available": 7,
      });
      expect(out.stackLabels).toEqual([
        "Compliant",
        "E. coli",
        "pH",
        "No information available",
      ]);
    });

    test("omits third row when totalRegistered equals yes+no", () => {
      const out = computeComplianceStackData(parameters, responses, {
        totalRegistered: 3,
      });
      expect(out.noInfoCount).toBe(0);
      expect(out.data).toHaveLength(2);
      expect(out.stackLabels).toEqual(["Compliant", "E. coli", "pH"]);
    });

    test("clamps to zero when totalRegistered is less than yes+no", () => {
      const out = computeComplianceStackData(parameters, responses, {
        totalRegistered: 1,
      });
      expect(out.noInfoCount).toBe(0);
      expect(out.data).toHaveLength(2);
    });

    test("respects custom noInfoLabel from i18n", () => {
      const out = computeComplianceStackData(parameters, responses, {
        totalRegistered: 10,
        noInfoLabel: "Sin información",
      });
      expect(out.data[2].compliance).toBe("Sin información");
    });

    test("does nothing when totalRegistered is undefined", () => {
      const out = computeComplianceStackData(parameters, responses, {});
      expect(out.data).toHaveLength(2);
      expect(out.noInfoCount).toBe(0);
      expect(out.stackLabels).not.toContain("No information available");
    });

    test("does nothing when totalRegistered is non-number", () => {
      const cases = [null, "10", NaN, true, []];
      cases.forEach((bad) => {
        const out = computeComplianceStackData(parameters, responses, {
          totalRegistered: bad,
        });
        expect(out.data).toHaveLength(2);
        expect(out.noInfoCount).toBe(0);
      });
    });
  });
});

describe("getCompliantCount", () => {
  const parameters = [
    { key: "e_coli", label: "E. coli", threshold: { max: 0 } },
    { key: "ph", label: "pH", threshold: { min: 6.5, max: 8.5 } },
    { key: "hidden_one", label: "Hidden", threshold: { max: 0 }, hide: true },
  ];

  test("returns 0 when responses are empty", () => {
    expect(getCompliantCount(parameters, {})).toBe(0);
    expect(getCompliantCount(parameters, null)).toBe(0);
  });

  test("returns 0 when parameters list is empty", () => {
    expect(getCompliantCount([], { e_coli: { data: [] } })).toBe(0);
    expect(getCompliantCount(null, { e_coli: { data: [] } })).toBe(0);
  });

  test("counts only parents whose active params are all within threshold", () => {
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
    expect(getCompliantCount(parameters, responses)).toBe(1);
  });

  test("skips hidden parameters (agrees with computeComplianceStackData)", () => {
    const responses = {
      e_coli: { data: [{ group: "1", label: "A", value: 0 }] },
      ph: { data: [{ group: "1", label: "A", value: 7.0 }] },
      hidden_one: { data: [{ group: "1", label: "A", value: 999 }] },
    };
    expect(getCompliantCount(parameters, responses)).toBe(1);
  });

  test("missing value for a parameter is treated as no-data, not violation", () => {
    const responses = {
      e_coli: { data: [{ group: "1", label: "A", value: 0 }] },
      // ph intentionally has no entry for group "1"
    };
    expect(getCompliantCount(parameters, responses)).toBe(1);
  });

  test("matches computeComplianceStackData.yesCount across fixtures", () => {
    const responses = {
      e_coli: {
        data: [
          { group: "10", label: "A", value: 0 },
          { group: "11", label: "B", value: 1 },
        ],
      },
      ph: {
        data: [
          { group: "10", label: "A", value: 7.0 },
          { group: "11", label: "B", value: 7.0 },
        ],
      },
    };
    const stack = computeComplianceStackData(parameters, responses);
    expect(getCompliantCount(parameters, responses)).toBe(stack.yesCount);
  });
});

describe("getCompliantCount (formula mode)", () => {
  // Params carry api.question_name so buildByEps populates _answers, which
  // the formula reads. The fecal param is hidden but MUST still count.
  const parameters = [
    { key: "e_coli", api: { question_name: "lab_ecoli_count" } },
    { key: "turbidity", api: { question_name: "lab_turbidity_ntu" } },
    {
      key: "fecal",
      hide: true,
      api: { question_name: "lab_fecal_coliform" },
    },
  ];
  const formula = {
    buckets: [
      {
        value: "non_compliant",
        label: "No",
        any_of: [
          { question_name: "lab_ecoli_count", op: ">", value: 0 },
          { question_name: "lab_turbidity_ntu", op: ">", value: 5 },
          { question_name: "lab_fecal_coliform", op: ">", value: 0 },
        ],
      },
      {
        value: "_no_info",
        label: "No information available",
        all_of: [
          { question_name: "lab_ecoli_count", op: "is_empty" },
          { question_name: "lab_turbidity_ntu", op: "is_empty" },
          { question_name: "lab_fecal_coliform", op: "is_empty" },
        ],
      },
    ],
    default: { value: "compliant", label: "Yes" },
  };

  test("missing-but-present-others counts compliant; all-empty does not", () => {
    const responses = {
      // P1: turbidity ok, e_coli/fecal missing -> compliant (1)
      // P2: turbidity violation -> non_compliant
      // P3: all empty (no rows) -> _no_info, not counted
      turbidity: {
        data: [
          { group: "1", value: 1.0 },
          { group: "2", value: 20 },
        ],
      },
    };
    expect(getCompliantCount(parameters, responses, formula)).toBe(1);
  });

  test("hidden fecal param violation flips a plant to non-compliant", () => {
    const responses = {
      turbidity: { data: [{ group: "1", value: 1.0 }] },
      fecal: { data: [{ group: "1", value: 3 }] },
    };
    // Threshold mode would drop the hidden fecal param and call it compliant;
    // formula mode honours it -> 0 compliant.
    expect(getCompliantCount(parameters, responses, formula)).toBe(0);
    expect(getCompliantCount(parameters, responses)).toBe(1);
  });
});

describe("computeCrossTab (column-per-option shape)", () => {
  // Backend response shape after akvo-mis-bvt:
  //   {data: [{label: parent_name, group: parent_id, [opt_label]: count}]}
  // One row per parent; option columns carry 0|1 for single-select,
  // 0|N for multi-select. stack_labels lists option columns.

  test("empty responses → []", () => {
    expect(computeCrossTab({ category: null, series: null })).toEqual([]);
    expect(
      computeCrossTab({ category: { data: [] }, series: { data: [] } })
    ).toEqual([]);
    expect(computeCrossTab(null)).toEqual([]);
  });

  test("single parent single-select category, single-select series → 1-row 1-cell", () => {
    const out = computeCrossTab({
      category: {
        data: [
          {
            label: "Site Alpha",
            group: 42,
            Borehole: 1,
            "Surface Water Project": 0,
          },
        ],
      },
      series: {
        data: [{ label: "Site Alpha", group: 42, WAF: 1, Rotary: 0 }],
      },
    });
    expect(out).toEqual([{ category: "Borehole", WAF: 1 }]);
  });

  test("multiple parents under same category tally up", () => {
    const out = computeCrossTab({
      category: {
        data: [
          { label: "A", group: 1, Borehole: 1, Desalination: 0 },
          { label: "B", group: 2, Borehole: 1, Desalination: 0 },
          { label: "C", group: 3, Borehole: 0, Desalination: 1 },
        ],
      },
      series: {
        data: [
          { label: "A", group: 1, WAF: 1, Rotary: 0 },
          { label: "B", group: 2, WAF: 1, Rotary: 0 },
          { label: "C", group: 3, WAF: 0, Rotary: 1 },
        ],
      },
    });
    const row = (c) => out.find((r) => r.category === c);
    expect(row("Borehole").WAF).toBe(2);
    expect(row("Desalination").Rotary).toBe(1);
  });

  test("multi-option series: one parent with two agencies increments both cells", () => {
    const out = computeCrossTab({
      category: {
        data: [
          {
            label: "A",
            group: 7,
            "Surface Water Project": 1,
            Borehole: 0,
          },
        ],
      },
      series: {
        data: [{ label: "A", group: 7, WAF: 1, Rotary: 1, Habitat: 0 }],
      },
    });
    expect(out).toEqual([
      { category: "Surface Water Project", WAF: 1, Rotary: 1 },
    ]);
  });

  test("parent in series but not in category is dropped (no inferred category)", () => {
    const out = computeCrossTab({
      category: {
        data: [{ label: "A", group: 1, Borehole: 1 }],
      },
      series: {
        data: [
          { label: "A", group: 1, WAF: 1 },
          { label: "Ghost", group: 99, WAF: 1 },
        ],
      },
    });
    expect(out).toEqual([{ category: "Borehole", WAF: 1 }]);
  });

  test("parent in category but not in series creates row with just category", () => {
    const out = computeCrossTab({
      category: { data: [{ label: "A", group: 1, Borehole: 1 }] },
      series: { data: [] },
    });
    expect(out).toEqual([{ category: "Borehole" }]);
  });

  test("parent with no option selected (all zeros) is skipped — no category inferred", () => {
    const out = computeCrossTab({
      category: {
        data: [
          { label: "A", group: 1, Borehole: 0, Desalination: 0 },
          { label: "B", group: 2, Borehole: 1, Desalination: 0 },
        ],
      },
      series: {
        data: [
          { label: "A", group: 1, WAF: 1 },
          { label: "B", group: 2, WAF: 1 },
        ],
      },
    });
    // Only B contributes — A has no category answer.
    expect(out).toEqual([{ category: "Borehole", WAF: 1 }]);
  });

  test("category with 0 count in series row leaves cell absent (not 0)", () => {
    const out = computeCrossTab({
      category: { data: [{ label: "A", group: 1, Borehole: 1 }] },
      series: { data: [{ label: "A", group: 1, WAF: 0, Rotary: 0 }] },
    });
    expect(out).toEqual([{ category: "Borehole" }]);
  });

  test("handles missing .data arrays", () => {
    expect(computeCrossTab({ category: {}, series: {} })).toEqual([]);
  });
});

describe("deriveAccessibilityBucket (A.2 rule)", () => {
  test("sample=yes ∧ issues=no → easily_accessible", () => {
    expect(deriveAccessibilityBucket("yes", "no")).toBe("easily_accessible");
  });
  test("sample=yes ∧ issues missing → easily_accessible", () => {
    let u;
    expect(deriveAccessibilityBucket("yes", u)).toBe("easily_accessible");
    expect(deriveAccessibilityBucket("yes", null)).toBe("easily_accessible");
  });
  test("sample=yes ∧ issues=yes → accessible_with_issues", () => {
    expect(deriveAccessibilityBucket("yes", "yes")).toBe(
      "accessible_with_issues"
    );
  });
  test("sample=no → not_accessible (regardless of issues)", () => {
    let u;
    expect(deriveAccessibilityBucket("no", "yes")).toBe("not_accessible");
    expect(deriveAccessibilityBucket("no", "no")).toBe("not_accessible");
    expect(deriveAccessibilityBucket("no", u)).toBe("not_accessible");
  });
  test("no sample record → null (EXCLUDED per US-4 AC)", () => {
    let u;
    expect(deriveAccessibilityBucket(u, "yes")).toBeNull();
    expect(deriveAccessibilityBucket(null, "no")).toBeNull();
  });
});

describe("computeAccessibilityBucket", () => {
  const labels = {
    easily_accessible: "Easily accessible",
    accessible_with_issues: "Accessible with issues",
    not_accessible: "Not accessible",
  };

  test("empty inputs → single row with 0 counts", () => {
    expect(computeAccessibilityBucket(null, labels)).toEqual([
      {
        category: "Accessibility",
        "Easily accessible": 0,
        "Accessible with issues": 0,
        "Not accessible": 0,
      },
    ]);
    expect(
      computeAccessibilityBucket(
        { sample: { data: [] }, issues: { data: [] } },
        labels
      )
    ).toEqual([
      {
        category: "Accessibility",
        "Easily accessible": 0,
        "Accessible with issues": 0,
        "Not accessible": 0,
      },
    ]);
  });

  test("tallies all 3 A.2 buckets across multiple parents", () => {
    const out = computeAccessibilityBucket(
      {
        sample: {
          data: [
            { label: "A", group: 1, Yes: 1, No: 0 }, // easily accessible
            { label: "B", group: 2, Yes: 1, No: 0 }, // accessible with issues
            { label: "C", group: 3, Yes: 0, No: 1 }, // not accessible
            // parent 4 has no sample record → excluded
          ],
        },
        issues: {
          data: [
            { label: "A", group: 1, Yes: 0, No: 1 },
            { label: "B", group: 2, Yes: 1, No: 0 },
            { label: "C", group: 3, Yes: 1, No: 0 },
            { label: "D", group: 4, Yes: 1, No: 0 }, // parent w/o sample → excluded
          ],
        },
      },
      labels
    );
    expect(out).toEqual([
      {
        category: "Accessibility",
        "Easily accessible": 1,
        "Accessible with issues": 1,
        "Not accessible": 1,
      },
    ]);
  });

  test("supports cross-form value-array responses", () => {
    const out = computeAccessibilityBucket(
      {
        sample: {
          data: [
            { label: "A", group: "1", value: ["yes"] },
            { label: "B", group: "2", value: ["YES"] },
            { label: "C", group: "3", value: ["no"] },
          ],
        },
        issues: {
          data: [
            { label: "A", group: "1", value: ["no"] },
            { label: "B", group: "2", value: ["yes"] },
          ],
        },
      },
      labels
    );
    expect(out).toEqual([
      {
        category: "Accessibility",
        "Easily accessible": 1,
        "Accessible with issues": 1,
        "Not accessible": 1,
      },
    ]);
  });

  test("parent with sample=yes but no issues record → easily_accessible", () => {
    const out = computeAccessibilityBucket(
      {
        sample: { data: [{ label: "A", group: 1, Yes: 1, No: 0 }] },
        issues: { data: [] },
      },
      labels
    );
    expect(out[0]["Easily accessible"]).toBe(1);
    expect(out[0]["Accessible with issues"]).toBe(0);
  });

  test("sample=no wins over issues=yes → not_accessible", () => {
    const out = computeAccessibilityBucket(
      {
        sample: { data: [{ label: "A", group: 1, Yes: 0, No: 1 }] },
        issues: { data: [{ label: "A", group: 1, Yes: 1, No: 0 }] },
      },
      labels
    );
    expect(out[0]["Not accessible"]).toBe(1);
    expect(out[0]["Accessible with issues"]).toBe(0);
  });

  test("respects custom labels", () => {
    const customLabels = {
      easily_accessible: "Bagus",
      accessible_with_issues: "Oke lah",
      not_accessible: "Gagal",
    };
    const out = computeAccessibilityBucket(
      {
        sample: { data: [{ label: "A", group: 1, Yes: 0, No: 1 }] },
        issues: { data: [] },
      },
      customLabels
    );
    expect(out[0].Gagal).toBe(1);
    expect(out[0].Bagus).toBe(0);
  });

  test("parent with all-zero sample row is excluded (no clear answer)", () => {
    const out = computeAccessibilityBucket(
      {
        sample: { data: [{ label: "A", group: 1, Yes: 0, No: 0 }] },
        issues: { data: [] },
      },
      labels
    );
    expect(out[0]["Easily accessible"]).toBe(0);
    expect(out[0]["Accessible with issues"]).toBe(0);
    expect(out[0]["Not accessible"]).toBe(0);
  });

  test("handles missing .data arrays", () => {
    expect(
      computeAccessibilityBucket({ sample: {}, issues: {} }, labels)
    ).toEqual([
      {
        category: "Accessibility",
        "Easily accessible": 0,
        "Accessible with issues": 0,
        "Not accessible": 0,
      },
    ]);
  });
});

describe("computeKpiStack", () => {
  const segments2 = [
    { key: "operational", label: "Operational" },
    { key: "issues", label: "Issues with the system" },
  ];

  test("empty segments → row with just the category", () => {
    expect(computeKpiStack([], {}, "Status")).toEqual([{ category: "Status" }]);
    expect(computeKpiStack(null, {}, "Status")).toEqual([
      { category: "Status" },
    ]);
  });

  test("two segments with scalar responses tally into single row", () => {
    const responses = {
      operational: { data: [{ value: 85 }] },
      issues: { data: [{ value: 16 }] },
    };
    expect(computeKpiStack(segments2, responses, "Operational Status")).toEqual(
      [
        {
          category: "Operational Status",
          Operational: 85,
          "Issues with the system": 16,
        },
      ]
    );
  });

  test("missing response → 0 for that segment", () => {
    const responses = {
      operational: { data: [{ value: 85 }] },
      // issues missing
    };
    expect(computeKpiStack(segments2, responses, "Status")).toEqual([
      {
        category: "Status",
        Operational: 85,
        "Issues with the system": 0,
      },
    ]);
  });

  test("empty data array → 0", () => {
    const responses = {
      operational: { data: [] },
      issues: { data: [{ value: 10 }] },
    };
    expect(computeKpiStack(segments2, responses, "Status")).toEqual([
      {
        category: "Status",
        Operational: 0,
        "Issues with the system": 10,
      },
    ]);
  });

  test("supports N=3 segments", () => {
    const segments3 = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ];
    const responses = {
      a: { data: [{ value: 1 }] },
      b: { data: [{ value: 2 }] },
      c: { data: [{ value: 3 }] },
    };
    expect(computeKpiStack(segments3, responses, "X")).toEqual([
      { category: "X", A: 1, B: 2, C: 3 },
    ]);
  });

  test("null responses object → all segments 0", () => {
    expect(computeKpiStack(segments2, null, "Status")).toEqual([
      {
        category: "Status",
        Operational: 0,
        "Issues with the system": 0,
      },
    ]);
  });

  test("defaults category when not provided", () => {
    const responses = { operational: { data: [{ value: 1 }] } };
    const out = computeKpiStack(segments2, responses);
    expect(typeof out[0].category).toBe("string");
  });
});

describe("computeProcessCounts", () => {
  const segments = [
    { key: "flocculation", label: "Coagulation/Flocculation" },
    { key: "sedimentation", label: "Sedimentation/Clarification" },
    { key: "filtration", label: "Filtration" },
  ];

  test("maps scalar segment responses into horizontal bar rows", () => {
    const responses = {
      flocculation: { data: [{ value: 18 }] },
      sedimentation: { data: [{ value: 7 }] },
      filtration: { data: [{ value: 9 }] },
    };
    expect(computeProcessCounts(segments, responses)).toEqual([
      { label: "Coagulation/Flocculation", value: 18 },
      { label: "Sedimentation/Clarification", value: 7 },
      { label: "Filtration", value: 9 },
    ]);
  });

  test("missing responses default to zero", () => {
    const responses = {
      flocculation: { data: [{ value: 18 }] },
      filtration: { data: [] },
    };
    expect(computeProcessCounts(segments, responses)).toEqual([
      { label: "Coagulation/Flocculation", value: 18 },
      { label: "Sedimentation/Clarification", value: 0 },
      { label: "Filtration", value: 0 },
    ]);
  });

  test("can sort descending for top-process bars", () => {
    const responses = {
      flocculation: { data: [{ value: 18 }] },
      sedimentation: { data: [{ value: 7 }] },
      filtration: { data: [{ value: 9 }] },
    };
    expect(computeProcessCounts(segments, responses, { sort: "desc" })).toEqual(
      [
        { label: "Coagulation/Flocculation", value: 18 },
        { label: "Filtration", value: 9 },
        { label: "Sedimentation/Clarification", value: 7 },
      ]
    );
  });
});

describe("computeCapacityCompare", () => {
  const measures = [
    { key: "design", label: "Design capacity" },
    { key: "production", label: "Production" },
  ];

  test("maps scalar measure responses into comparison rows", () => {
    const responses = {
      design: { data: [{ value: 120.25 }] },
      production: { data: [{ value: 98.5 }] },
    };
    expect(computeCapacityCompare(measures, responses)).toEqual([
      { label: "Design capacity", value: 120.25 },
      { label: "Production", value: 98.5 },
    ]);
  });

  test("sums grouped rows and coerces numeric strings", () => {
    const responses = {
      design: { data: [{ value: "10.5" }, { value: 20 }] },
      production: { data: [{ value: 3.333 }, { value: 4.333 }] },
    };
    expect(computeCapacityCompare(measures, responses)).toEqual([
      { label: "Design capacity", value: 30.5 },
      { label: "Production", value: 7.67 },
    ]);
  });

  test("missing responses default to zero", () => {
    expect(computeCapacityCompare(measures, { design: { data: [] } })).toEqual([
      { label: "Design capacity", value: 0 },
      { label: "Production", value: 0 },
    ]);
  });
});

describe("computeDateHistogram", () => {
  const today = new Date(Date.UTC(2026, 5, 19));

  test("buckets dates into overdue plus recent monthly buckets", () => {
    const out = computeDateHistogram(
      [
        { value: "2026-06-01" },
        { value: "2026-05-15" },
        { value: "2025-12-01" },
        { value: "2024-11-30" },
      ],
      today,
      { months: 3, overdue_label: "> 3 mo" }
    );
    expect(out).toEqual([
      { label: "> 3 mo", value: 2, color: "#d93c35" },
      { label: "Apr '26", value: 0, color: "#2fb36d" },
      { label: "May '26", value: 1, color: "#2fb36d" },
      { label: "Jun '26", value: 1, color: "#2fb36d" },
    ]);
  });

  test("colors older visible months amber and red by recency", () => {
    const out = computeDateHistogram([], today, { months: 14 });
    const jan2026 = out.find((row) => row.label === "Jan '26");
    const jun2025 = out.find((row) => row.label === "Jun '25");
    const may2025 = out.find((row) => row.label === "May '25");
    expect(jan2026.color).toBe("#2fb36d");
    expect(jun2025.color).toBe("#f5a623");
    expect(may2025.color).toBe("#d93c35");
    expect(out[0].color).toBe("#d93c35");
  });
});

describe("computeValueBuckets", () => {
  const buckets = [
    { label: "0", value: 0 },
    { label: "1", value: 1 },
    { label: "2", value: 2 },
    { label: "3", value: 3 },
    { label: "4+", min: 4 },
  ];

  test("counts exact numeric buckets and open-ended final bucket", () => {
    const rows = [
      { value: 0 },
      { value: 1 },
      { value: 2 },
      { value: "2" },
      { value: 3 },
      { value: 4 },
      { value: 6 },
      { value: null },
      { value: "not-a-number" },
    ];
    expect(computeValueBuckets(rows, buckets)).toEqual([
      { label: "0", value: 1 },
      { label: "1", value: 1 },
      { label: "2", value: 2 },
      { label: "3", value: 1 },
      { label: "4+", value: 2 },
    ]);
  });

  test("emits configured buckets even when counts are zero", () => {
    expect(computeValueBuckets([], buckets)).toEqual([
      { label: "0", value: 0 },
      { label: "1", value: 0 },
      { label: "2", value: 0 },
      { label: "3", value: 0 },
      { label: "4+", value: 0 },
    ]);
  });
});

describe("computeStageFlow", () => {
  test("computes sequential positive-response stage intersections", () => {
    const flow = computeStageFlow({
      total: 5,
      rootLabel: "All WTPs",
      stages: [
        {
          key: "policy",
          label: "Has policy",
          fail_label: "No policy",
        },
        {
          key: "use",
          label: "Staff use",
          fail_label: "Does not use",
        },
        {
          key: "comply",
          label: "Staff comply",
          fail_label: "Not complying",
        },
      ],
      responses: {
        policy: {
          data: [
            { group: 1, value: ["yes"] },
            { group: 2, value: ["yes"] },
            { group: 3, value: ["yes"] },
            { group: 4, value: ["no"] },
          ],
        },
        use: {
          data: [
            { group: 1, value: ["yes"] },
            { group: 2, value: ["no"] },
            { group: 3, value: ["yes"] },
          ],
        },
        comply: {
          data: [
            { group: 1, value: ["yes"] },
            { group: 2, value: ["yes"] },
            { group: 3, value: ["no"] },
          ],
        },
      },
    });

    expect(flow.counts).toEqual({ all: 5 });
    expect(flow.steps).toEqual([
      {
        key: "policy",
        label: "Has policy",
        passed: 3,
        failed: 2,
        failLabel: "No policy",
      },
      {
        key: "use",
        label: "Staff use",
        passed: 2,
        failed: 1,
        failLabel: "Does not use",
      },
      {
        key: "comply",
        label: "Staff comply",
        passed: 1,
        failed: 1,
        failLabel: "Not complying",
      },
    ]);
    expect(flow.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "Staff use",
          target: "Staff comply",
          value: 1,
        }),
        expect.objectContaining({
          source: "Staff use",
          target: "Not complying",
          value: 1,
        }),
      ])
    );
  });
});

describe("computeGroupedStack", () => {
  const stacks = [
    { key: "working", label: "In use · working" },
    { key: "issue", label: "In use · issue logged" },
  ];
  const segments = [
    {
      key: "chlorine__working",
      group: "chlorine",
      group_label: "Chlorine",
      stack: "working",
    },
    {
      key: "chlorine__issue",
      group: "chlorine",
      group_label: "Chlorine",
      stack: "issue",
    },
    {
      key: "lime__working",
      group: "lime",
      group_label: "Lime",
      stack: "working",
    },
    { key: "lime__issue", group: "lime", group_label: "Lime", stack: "issue" },
  ];

  test("collapses segments into one row per group with stack labels as keys", () => {
    const responses = {
      chlorine__working: { data: [{ value: 5, label: "chlorine" }] },
      chlorine__issue: { data: [{ value: 2, label: "chlorine" }] },
      lime__working: { data: [{ value: 3, label: "lime" }] },
      lime__issue: { data: [] },
    };
    const out = computeGroupedStack(segments, stacks, responses);
    expect(out).toEqual([
      {
        category: "Chlorine",
        "In use · working": 5,
        "In use · issue logged": 2,
      },
      { category: "Lime", "In use · working": 3, "In use · issue logged": 0 },
    ]);
  });

  test("preserves first-seen group order", () => {
    const responses = {};
    const out = computeGroupedStack(segments, stacks, responses);
    expect(out.map((r) => r.category)).toEqual(["Chlorine", "Lime"]);
  });

  test("defaults every stack to 0 when responses are missing", () => {
    const out = computeGroupedStack(segments, stacks, {});
    expect(out[0]).toEqual({
      category: "Chlorine",
      "In use · working": 0,
      "In use · issue logged": 0,
    });
  });

  test("returns [] for empty segments", () => {
    expect(computeGroupedStack([], stacks, {})).toEqual([]);
  });
});

describe("computeBucketBar", () => {
  const buckets = [
    { label: "No meter", segment: "no_meter" },
    { label: "Inflow", subtract: ["inflow_total", "both"] },
    { label: "Outflow", subtract: ["outflow_total", "both"] },
    { label: "Both", segment: "both" },
  ];
  const responses = {
    no_meter: { data: [{ value: 11, label: "no" }] },
    inflow_total: { data: [{ value: 17, label: "inflow" }] },
    outflow_total: { data: [{ value: 36, label: "outflow" }] },
    both: { data: [{ value: 15, label: "inflow" }] },
  };

  test("resolves direct segments and subtraction buckets", () => {
    expect(computeBucketBar(buckets, responses)).toEqual([
      { label: "No meter", value: 11 },
      { label: "Inflow", value: 2 },
      { label: "Outflow", value: 21 },
      { label: "Both", value: 15 },
    ]);
  });

  test("floors subtraction at zero", () => {
    const out = computeBucketBar([{ label: "X", subtract: ["a", "b"] }], {
      a: { data: [{ value: 1 }] },
      b: { data: [{ value: 5 }] },
    });
    expect(out).toEqual([{ label: "X", value: 0 }]);
  });

  test("treats missing responses as zero", () => {
    expect(computeBucketBar(buckets, {})).toEqual([
      { label: "No meter", value: 0 },
      { label: "Inflow", value: 0 },
      { label: "Outflow", value: 0 },
      { label: "Both", value: 0 },
    ]);
  });

  test("returns [] for empty buckets", () => {
    expect(computeBucketBar([], responses)).toEqual([]);
  });
});

describe("computeConditionField", () => {
  const groundOptions = [
    { value: "good", label: "Good", tone: "good" },
    { value: "satisfactory", label: "Satisfactory", tone: "good" },
    {
      value: "maintenance_in_progress",
      label: "Maintenance in progress",
      tone: "mid",
    },
    { value: "poor", label: "Poor", tone: "bad" },
  ];
  const response = {
    data: [
      { group: "good", label: "Good", value: 36 },
      { group: "satisfactory", label: "Satisfactory", value: 18 },
      {
        group: "maintenance_in_progress",
        label: "Maintenance in progress",
        value: 7,
      },
      { group: "poor", label: "Poor", value: 3 },
    ],
  };

  test("counts options, resolves tone colors, and rounds % good", () => {
    const out = computeConditionField(groundOptions, response);
    expect(out.total).toBe(64);
    expect(out.goodCount).toBe(54);
    expect(out.goodPct).toBe(84);
    expect(out.options.map((o) => o.count)).toEqual([36, 18, 7, 3]);
    expect(out.options[0].color).toBe(CONDITION_TONE_COLORS.good);
    expect(out.options[2].color).toBe(CONDITION_TONE_COLORS.mid);
    expect(out.options[3].color).toBe(CONDITION_TONE_COLORS.bad);
  });

  test("preserves config order even when the response is unordered", () => {
    const shuffled = { data: [...response.data].reverse() };
    const out = computeConditionField(groundOptions, shuffled);
    expect(out.options.map((o) => o.value)).toEqual([
      "good",
      "satisfactory",
      "maintenance_in_progress",
      "poor",
    ]);
  });

  test("excludes _no_info from the bar and the denominator", () => {
    const withNoInfo = {
      data: [
        ...response.data,
        { group: "_no_info", label: "No information", value: 10 },
      ],
    };
    const out = computeConditionField(groundOptions, withNoInfo);
    expect(out.total).toBe(64);
    expect(out.options.find((o) => o.value === "_no_info")).toBeUndefined();
  });

  test("appends unknown option groups with the neutral tone", () => {
    const withExtra = {
      data: [
        ...response.data,
        { group: "mystery", label: "Mystery", value: 5 },
      ],
    };
    const out = computeConditionField(groundOptions, withExtra);
    const extra = out.options.find((o) => o.value === "mystery");
    expect(extra).toMatchObject({
      tone: "neutral",
      color: CONDITION_TONE_COLORS.neutral,
      count: 5,
    });
    expect(out.total).toBe(69);
  });

  test("returns null % good for empty/missing data", () => {
    expect(computeConditionField(groundOptions, null).goodPct).toBeNull();
    expect(computeConditionField(groundOptions, { data: [] }).total).toBe(0);
  });

  test("primaryCount is the first option's count (yes/no readout numerator)", () => {
    const yesNo = [
      { value: "yes", label: "Yes", tone: "good" },
      { value: "no", label: "No", tone: "bad" },
    ];
    const out = computeConditionField(yesNo, {
      data: [
        { group: "yes", label: "Yes", value: 31 },
        { group: "no", label: "No", value: 11 },
      ],
    });
    expect(out.primaryCount).toBe(31);
    expect(out.total).toBe(42);
  });
});

describe("processStatus", () => {
  test("processToneColor: normal/operational green, non-operational red, else amber", () => {
    expect(processToneColor("normal")).toBe(CONDITION_TONE_COLORS.good);
    expect(processToneColor("normal_operation")).toBe(
      CONDITION_TONE_COLORS.good
    );
    expect(processToneColor("operational")).toBe(CONDITION_TONE_COLORS.good);
    expect(processToneColor("not_operational")).toBe(CONDITION_TONE_COLORS.bad);
    expect(processToneColor("bad_odor")).toBe(CONDITION_TONE_COLORS.mid);
  });

  test("computeProcessBars maps counts in config order with rule/override colors", () => {
    const options = [
      { value: "normal", label: "Normal" },
      { value: "bad_odor", label: "Bad odor" },
      { value: "no_station", label: "No station", tone: "neutral" },
    ];
    const bars = computeProcessBars(options, {
      data: [
        { group: "bad_odor", label: "Bad odor", value: 2 },
        { group: "normal", label: "Normal", value: 9 },
      ],
    });
    expect(bars.map((b) => [b.label, b.count])).toEqual([
      ["Normal", 9],
      ["Bad odor", 2],
      ["No station", 0],
    ]);
    expect(bars[0].color).toBe(CONDITION_TONE_COLORS.good);
    expect(bars[1].color).toBe(CONDITION_TONE_COLORS.mid);
    expect(bars[2].color).toBe(CONDITION_TONE_COLORS.neutral);
  });

  test("distinctParentCount counts per-parent rows", () => {
    expect(distinctParentCount({ data: [{}, {}, {}] })).toBe(3);
    expect(distinctParentCount(null)).toBe(0);
  });
});

describe("computeComplianceTrend", () => {
  test("monthLabelToKey parses 'Mon YYYY' to YYYY-MM", () => {
    expect(monthLabelToKey("Jun 2025")).toBe("2025-06");
    expect(monthLabelToKey("Dec 2025")).toBe("2025-12");
    expect(monthLabelToKey("bogus")).toBeNull();
  });

  const axis = [
    { key: "2025-05", label: "May" },
    { key: "2025-06", label: "Jun" },
  ];

  test("option_share = pass option over all answered, per month, aligned to axis", () => {
    const out = computeComplianceTrend(
      [
        {
          key: "ohs",
          label: "OHS",
          color: "#f0ad4e",
          type: "option_share",
          question_name: "ohs_equipment_available",
          pass_value: "yes",
        },
      ],
      axis,
      {
        ohs__share: {
          data: [
            { month: "May 2025", Yes: 1, No: 3 },
            { month: "Jun 2025", Yes: 3, No: 1 },
          ],
        },
      }
    );
    expect(out.months).toEqual(["May", "Jun"]);
    expect(out.series[0].data).toEqual([25, 75]);
  });

  test("threshold_all passes a parent only if all present params satisfy", () => {
    const domain = {
      key: "effluent",
      label: "Effluent",
      type: "threshold_all",
      params: [
        { question_name: "bod", op: "<", value: 40 },
        { question_name: "cod", op: "<", value: 100 },
      ],
    };
    const out = computeComplianceTrend([domain], axis, {
      // May: P1 passes (30,90); P2 fails cod (10,150) -> 1/2 = 50%
      effluent__bod: {
        data: [{ month: "May 2025", P1: 30, P2: 10 }],
      },
      effluent__cod: {
        data: [{ month: "May 2025", P1: 90, P2: 150 }],
      },
    });
    expect(out.series[0].data[0]).toBe(50);
    // Jun has no data -> null gap
    expect(out.series[0].data[1]).toBeNull();
  });

  test("missing param value is no-data, not a failure", () => {
    const domain = {
      key: "effluent",
      label: "Effluent",
      type: "threshold_all",
      params: [
        { question_name: "bod", op: "<", value: 40 },
        { question_name: "cod", op: "<", value: 100 },
      ],
    };
    // P1 only has bod (passes); cod missing -> still counts as pass
    const out = computeComplianceTrend(
      [domain],
      [{ key: "2025-05", label: "May" }],
      {
        effluent__bod: { data: [{ month: "May 2025", P1: 30 }] },
        effluent__cod: { data: [{ month: "May 2025" }] },
      }
    );
    expect(out.series[0].data[0]).toBe(100);
  });
});
