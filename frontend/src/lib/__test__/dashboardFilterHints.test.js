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
        date_question_name: "inspection_date",
      },
      { today }
    );
    expect(out.from_date).toBe("2025-04-14");
    expect(out.to_date).toBe("2026-04-14");
    expect(out.rolling_months).toBeUndefined();
    expect(out.date_question_name).toBe("inspection_date");
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
        completion_question_name: "is_project_completed",
        deadline_question_name: "proposed_completion_date",
        monitoring: "latest",
        sum_by: "parent_id",
        value_type: "percentage",
      },
      { today }
    );
    expect(out.question_name).toBe("is_project_completed");
    expect(out.option_value).toBe("no");
    expect(out.date_question_name).toBe("proposed_completion_date");
    expect(out.to_date).toBe("2026-04-13");
    expect(out.past_due).toBeUndefined();
    expect(out.completion_question_name).toBeUndefined();
    expect(out.deadline_question_name).toBeUndefined();
    expect(out.value_type).toBe("percentage");
  });

  test("past_due uses completion_incomplete_value when provided", () => {
    const out = expandApiHints(
      {
        past_due: true,
        completion_question_name: "infrastructure_status",
        completion_incomplete_value: "non_operational",
        deadline_question_name: "proposed_completion_date",
        monitoring: "latest",
        sum_by: "parent_id",
      },
      { today }
    );
    expect(out.question_name).toBe("infrastructure_status");
    expect(out.option_value).toBe("non_operational");
    expect(out.date_question_name).toBe("proposed_completion_date");
    expect(out.to_date).toBe("2026-04-13");
    // The hint key is consumed, never forwarded to the backend.
    expect(out.completion_incomplete_value).toBeUndefined();
  });

  test("past_due with completion_incomplete_op=lt emits a threshold criterion", () => {
    const out = expandApiHints(
      {
        form_id: 1749621962296,
        past_due: true,
        completion_question_name: "project_completion_percentage",
        completion_incomplete_value: 100,
        completion_incomplete_op: "lt",
        deadline_question_name: "proposed_completion_date",
        monitoring: "latest",
        sum_by: "parent_id",
      },
      { today }
    );
    // Numeric completion → criteria, not an option_value.
    expect(out.criteria).toBe("threshold_lt:project_completion_percentage:100");
    expect(out.question_name).toBeUndefined();
    expect(out.option_value).toBeUndefined();
    expect(out.date_question_name).toBe("proposed_completion_date");
    expect(out.to_date).toBe("2026-04-13");
    expect(out.form_id).toBe(1749621962296);
    expect(out.completion_incomplete_op).toBeUndefined();
  });

  test("no-hint block is passed through unchanged", () => {
    const input = {
      form_id: 1,
      question_name: "q2",
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
      question_name: "water_committee",
      form_id: 1749623934933,
    },
    {
      key: "implementing_agency",
      chart_type: "filter_multi_option",
      question_name: "implementing_agency",
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

  test("ignore_date_filter drops the date range but keeps administration", () => {
    const out = applyDashboardFilters(
      { form_id: 1, ignore_date_filter: true },
      {
        from_date: "2026-01-01",
        to_date: "2026-03-31",
        administration_id: 7,
      }
    );
    // Fleet-scope queries opt out of the monitoring-period window.
    expect(out.from_date).toBeUndefined();
    expect(out.to_date).toBeUndefined();
    // The flag itself must not leak to the backend.
    expect("ignore_date_filter" in out).toBe(false);
    // Administration scope still applies.
    expect(out.administration_id).toBe(7);
  });

  test("dashboard filter overrides widget-expanded defaults (fiscal_year/rolling_months)", () => {
    // A widget with fiscal_year:true hint would have expanded dates
    // pinned by expandApiHints. The user's filter must still win.
    const out = applyDashboardFilters(
      { form_id: 1, from_date: "2025-07-01", to_date: "2026-06-30" },
      { from_date: "2026-01-01", to_date: "2026-03-31" }
    );
    expect(out.from_date).toBe("2026-01-01");
    expect(out.to_date).toBe("2026-03-31");
  });

  test("widget-expanded defaults kept when no dashboard filter", () => {
    const out = applyDashboardFilters(
      { form_id: 1, from_date: "2025-07-01", to_date: "2026-06-30" },
      {}
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
    expect(out.criteria).toBe("option_equals:water_committee:yes");
    expect(out.option_value).toBeUndefined();
  });

  test("multi_option filter with single value uses option_contains", () => {
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      { custom: [{ key: "implementing_agency", value: ["akvo"] }] },
      customDefs
    );
    expect(out.criteria).toBe("option_contains:implementing_agency:akvo");
  });

  test("multi_option filter with multiple values uses option_in", () => {
    const out = applyDashboardFilters(
      { form_id: 1749623934933 },
      {
        custom: [{ key: "implementing_agency", value: ["akvo", "oxfam"] }],
      },
      customDefs
    );
    expect(out.criteria).toBe("option_in:implementing_agency:akvo|oxfam");
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
      "option_contains:implementing_agency:akvo," +
        "option_equals:water_committee:yes"
    );
  });

  test("cross-form filter emits criteria (backend auto-splits)", () => {
    const out = applyDashboardFilters(
      { form_id: 9999 },
      { custom: [{ key: "water_committee", value: "yes" }] },
      customDefs
    );
    expect(out.criteria).toBe("option_equals:water_committee:yes");
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

  test("widget's own criteria is preserved when no custom filters apply", () => {
    const out = applyDashboardFilters(
      {
        form_id: 1749652214711,
        criteria: "option_equals:has_chlorine_gas_risks:no",
      },
      {},
      customDefs
    );
    expect(out.criteria).toBe("option_equals:has_chlorine_gas_risks:no");
  });

  test("custom filter criteria AND-joins after the widget's own criteria", () => {
    const out = applyDashboardFilters(
      {
        form_id: 1749652214711,
        criteria: "option_equals:has_chlorine_gas_risks:no",
      },
      { custom: [{ key: "water_committee", value: "yes" }] },
      customDefs
    );
    expect(out.criteria).toBe(
      "option_equals:has_chlorine_gas_risks:no," +
        "option_equals:water_committee:yes"
    );
  });
});
