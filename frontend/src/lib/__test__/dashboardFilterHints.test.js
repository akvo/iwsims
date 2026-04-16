import {
  toIsoDate,
  subtractMonths,
  subtractOneDay,
  fiscalYearRange,
  expandApiHints,
  applyDashboardFilters,
} from "../dashboardFilterHints";

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

describe("date utilities", () => {
  test("toIsoDate formats in UTC YYYY-MM-DD", () => {
    expect(toIsoDate(utc(2026, 4, 14))).toBe("2026-04-14");
    expect(toIsoDate(utc(2026, 1, 1))).toBe("2026-01-01");
    expect(toIsoDate(utc(2026, 12, 31))).toBe("2026-12-31");
  });

  test("subtractMonths rolls over year boundaries", () => {
    expect(toIsoDate(subtractMonths(utc(2026, 4, 14), 12))).toBe("2025-04-14");
    expect(toIsoDate(subtractMonths(utc(2026, 1, 15), 3))).toBe("2025-10-15");
  });

  test("subtractOneDay rolls over month and year", () => {
    expect(toIsoDate(subtractOneDay(utc(2026, 4, 1)))).toBe("2026-03-31");
    expect(toIsoDate(subtractOneDay(utc(2026, 1, 1)))).toBe("2025-12-31");
  });
});

describe("fiscalYearRange", () => {
  test("July-anchored FY containing April snaps to prior year", () => {
    const { from, to } = fiscalYearRange(utc(2026, 4, 14), 7);
    expect(toIsoDate(from)).toBe("2025-07-01");
    expect(toIsoDate(to)).toBe("2026-06-30");
  });

  test("July-anchored FY containing August snaps to current year", () => {
    const { from, to } = fiscalYearRange(utc(2026, 8, 1), 7);
    expect(toIsoDate(from)).toBe("2026-07-01");
    expect(toIsoDate(to)).toBe("2027-06-30");
  });

  test("January-anchored FY is the calendar year", () => {
    const { from, to } = fiscalYearRange(utc(2026, 4, 14), 1);
    expect(toIsoDate(from)).toBe("2026-01-01");
    expect(toIsoDate(to)).toBe("2026-12-31");
  });
});

describe("expandApiHints", () => {
  const today = utc(2026, 4, 14);

  test("rolling_months expands to from_date = today - N months, to_date = today", () => {
    const out = expandApiHints(
      {
        form_id: 1749632545233,
        rolling_months: 12,
        date_question_id: 1749632545235,
      },
      { today }
    );
    expect(out.from_date).toBe("2025-04-14");
    expect(out.to_date).toBe("2026-04-14");
    expect(out.rolling_months).toBeUndefined();
    expect(out.date_question_id).toBe(1749632545235);
  });

  test("fiscal_year expands using the fiscal_year_start_month", () => {
    const out = expandApiHints(
      { form_id: 1749632545233, fiscal_year: true },
      { today, fiscalYearStartMonth: 7 }
    );
    expect(out.from_date).toBe("2025-07-01");
    expect(out.to_date).toBe("2026-06-30");
    expect(out.fiscal_year).toBeUndefined();
  });

  test("past_due produces completion-flag + deadline filter with to_date = today-1", () => {
    const out = expandApiHints(
      {
        form_id: 1749624452908,
        past_due: true,
        completion_question_id: 1749630516826,
        deadline_question_id: 1749630516825,
        monitoring: "latest",
        sum_by: "parent_id",
        value_type: "percentage",
      },
      { today }
    );
    expect(out.question_id).toBe(1749630516826);
    expect(out.option_value).toBe("no");
    expect(out.date_question_id).toBe(1749630516825);
    expect(out.to_date).toBe("2026-04-13");
    expect(out.past_due).toBeUndefined();
    expect(out.completion_question_id).toBeUndefined();
    expect(out.deadline_question_id).toBeUndefined();
    expect(out.value_type).toBe("percentage");
  });

  test("no-hint block is passed through unchanged", () => {
    const input = {
      form_id: 1,
      question_id: 2,
      option_value: "x",
      monitoring: "latest",
    };
    const out = expandApiHints(input, { today });
    expect(out).toEqual(input);
    expect(out).not.toBe(input); // returns a fresh object
  });
});

describe("applyDashboardFilters", () => {
  const customDefs = [
    {
      key: "water_committee",
      chart_type: "filter_option",
      question_id: 1749624452105,
      form_id: 1749623934933,
    },
    {
      key: "implementing_agency",
      chart_type: "filter_multi_option",
      question_id: 1749624452993,
      form_id: 1749623934933,
    },
  ];

  test("propagates date range when widget didn't pin one", () => {
    const out = applyDashboardFilters(
      { form_id: 1 },
      { from_date: "2026-01-01", to_date: "2026-03-31" }
    );
    expect(out.from_date).toBe("2026-01-01");
    expect(out.to_date).toBe("2026-03-31");
  });

  test("widget-pinned dates win over dashboard filter", () => {
    const out = applyDashboardFilters(
      { form_id: 1, from_date: "2025-07-01", to_date: "2026-06-30" },
      { from_date: "2026-01-01", to_date: "2026-03-31" }
    );
    expect(out.from_date).toBe("2025-07-01");
    expect(out.to_date).toBe("2026-06-30");
  });

  test("administration_id propagates", () => {
    const out = applyDashboardFilters(
      { form_id: 1 },
      { administration_id: 42 }
    );
    expect(out.administration_id).toBe(42);
  });

  test("option filter emits option_equals criterion regardless of widget question", () => {
    // KPI widget (no question_id) now narrows via criteria.
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      { custom: [{ key: "water_committee", value: "yes" }] },
      customDefs
    );
    expect(out.criteria).toBe("option_equals:1749624452105:yes");
    expect(out.option_value).toBeUndefined();
  });

  test("multi_option filter with single value uses option_contains", () => {
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      { custom: [{ key: "implementing_agency", value: ["akvo"] }] },
      customDefs
    );
    expect(out.criteria).toBe("option_contains:1749624452993:akvo");
  });

  test("multi_option filter with multiple values uses option_in", () => {
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      {
        custom: [{ key: "implementing_agency", value: ["akvo", "oxfam"] }],
      },
      customDefs
    );
    expect(out.criteria).toBe("option_in:1749624452993:akvo|oxfam");
  });

  test("multiple custom filters AND-join into single criteria param", () => {
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      {
        custom: [
          { key: "implementing_agency", value: ["akvo"] },
          { key: "water_committee", value: "yes" },
        ],
      },
      customDefs
    );
    expect(out.criteria).toBe(
      "option_contains:1749624452993:akvo," + "option_equals:1749624452105:yes"
    );
  });

  test("cross-form filter emits criteria (backend auto-splits)", () => {
    const out = applyDashboardFilters(
      { form_id: 9999 },
      { custom: [{ key: "water_committee", value: "yes" }] },
      customDefs
    );
    expect(out.criteria).toBe("option_equals:1749624452105:yes");
  });

  test("empty custom selection is ignored", () => {
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      {
        custom: [
          { key: "water_committee", value: null },
          { key: "implementing_agency", value: [] },
        ],
      },
      customDefs
    );
    expect(out.criteria).toBeUndefined();
  });
});
