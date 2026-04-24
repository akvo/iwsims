import React from "react";
import { render, screen } from "@testing-library/react";
import axios from "axios";
import KPICard from "../KPICard";
import { __clearVisualizationCache } from "../../../../util/hooks/useVisualizationRequest";

jest.mock("axios");

const emptyFilters = {
  from_date: null,
  to_date: null,
  administration_id: null,
  custom: [],
};

const axiosValue = (value) =>
  axios.mockResolvedValueOnce({ data: { data: [{ value }] } });

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
});

describe("KPICard — legacy paths (unchanged behavior)", () => {
  test("scalar value renders as-is", async () => {
    axiosValue(42);
    render(
      <KPICard
        item={{
          id: "kpi1",
          chart_type: "card",
          label: "Total",
          api: { form_id: 1 },
        }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("42")).toBeInTheDocument();
  });

  test("percentage value_type renders '{value}%'", async () => {
    axiosValue(85);
    render(
      <KPICard
        item={{
          id: "kpi2",
          chart_type: "card",
          label: "Coverage",
          api: { form_id: 1, value_type: "percentage" },
        }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("85%")).toBeInTheDocument();
  });
});

describe("KPICard — value_type: ratio_percentage (ratio KPI)", () => {
  test("renders 'N/M (P%)' when both api and denominator_api resolve", async () => {
    // numerator first, then denominator (useDashboardValues runs in call order)
    axiosValue(42); // numerator
    axiosValue(50); // denominator
    render(
      <KPICard
        item={{
          id: "kpi_ops",
          chart_type: "card",
          label: "Operational",
          api: {
            form_id: 1749631041125,
            question_id: 1749631041155,
            option_value: "operational",
            value_type: "ratio_percentage",
          },
          denominator_api: { form_id: 1749621221728 },
        }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("42/50 (84%)")).toBeInTheDocument();
  });

  test("strips frontend-only value_type: ratio_percentage before sending to /values (regression — akvo-mis-err)", async () => {
    axiosValue(42);
    axiosValue(50);
    render(
      <KPICard
        item={{
          id: "kpi_committees",
          chart_type: "card",
          label: "Active Water Committees",
          api: {
            form_id: 1749621221728,
            question_id: 1749622715678,
            option_value: "yes",
            sum_by: "parent_id",
            value_type: "ratio_percentage",
          },
          denominator_api: { form_id: 1749621221728 },
        }}
        filterState={emptyFilters}
      />
    );
    await screen.findByText("42/50 (84%)");
    // Inspect the axios GET — the ratio_percentage marker must not leak.
    const calls = axios.mock.calls.map(([cfg]) => cfg);
    const primaryCall = calls.find((c) =>
      String(c?.url || c?.path || "").includes("visualization/values")
    );
    const params = primaryCall?.params || {};
    expect(params.value_type).not.toBe("ratio_percentage");
  });

  test("M === 0 renders '—' (no div-by-zero)", async () => {
    axiosValue(0); // numerator
    axiosValue(0); // denominator
    render(
      <KPICard
        item={{
          id: "kpi_ops_zero",
          chart_type: "card",
          label: "Operational",
          api: {
            form_id: 1,
            question_id: 2,
            value_type: "ratio_percentage",
          },
          denominator_api: { form_id: 99 },
        }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});

describe("KPICard — compute: compliance_kpi", () => {
  test("reuses complianceResponses + getCompliantCount for numerator", async () => {
    axiosValue(50); // denominator only; numerator is computed from complianceResponses
    const param1 = {
      id: "param_e_coli",
      chart_type: "histogram",
      label: "E. coli",
      threshold: { max: 0 },
    };
    const definitionsById = new Map([["param_e_coli", param1]]);
    const computeResponses = {
      compliance: {
        param_e_coli: {
          data: [
            { group: "1", label: "A", value: 0 }, // compliant
            { group: "2", label: "B", value: 5 }, // non-compliant
            { group: "3", label: "C", value: 0 }, // compliant
          ],
        },
      },
    };
    render(
      <KPICard
        item={{
          id: "kpi_compliance",
          chart_type: "card",
          label: "Drinking Water Compliance",
          compute: "compliance_kpi",
          params_ref: ["param_e_coli"],
          denominator_api: { form_id: 1749621221728 },
        }}
        filterState={emptyFilters}
        definitionsById={definitionsById}
        computeResponses={computeResponses}
      />
    );
    // 2 compliant / 50 total = 4%
    expect(await screen.findByText("2/50 (4%)")).toBeInTheDocument();
  });

  test("renders '—' when complianceResponses not yet populated", async () => {
    axiosValue(50); // denominator
    const param1 = {
      id: "param_e_coli",
      label: "E. coli",
      threshold: { max: 0 },
    };
    render(
      <KPICard
        item={{
          id: "kpi_compliance",
          chart_type: "card",
          label: "Drinking Water Compliance",
          compute: "compliance_kpi",
          params_ref: ["param_e_coli"],
          denominator_api: { form_id: 1 },
        }}
        filterState={emptyFilters}
        definitionsById={new Map([["param_e_coli", param1]])}
        computeResponses={{ compliance: {} }}
      />
    );
    // computeResponses.compliance has no entry for the param → numerator
    // is null (not 0) → KPICard renders "—" via formatRatio's null guard
    // (akvo-mis-ddw).
    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});

describe("KPICard — compute: accessibility_no_issues_kpi", () => {
  test("counts easily_accessible bucket as numerator", async () => {
    axiosValue(50); // denominator
    const computeResponses = {
      accessibility_no_issues_kpi: {
        kpi_acc: {
          sample: {
            data: [
              { label: "A", group: 1, Yes: 1, No: 0 }, // easily accessible
              { label: "B", group: 2, Yes: 1, No: 0 }, // accessible w/ issues
              { label: "C", group: 3, Yes: 0, No: 1 }, // not accessible
            ],
          },
          issues: {
            data: [
              { label: "A", group: 1, Yes: 0, No: 1 },
              { label: "B", group: 2, Yes: 1, No: 0 },
              { label: "C", group: 3, Yes: 0, No: 1 },
            ],
          },
        },
      },
    };
    render(
      <KPICard
        item={{
          id: "kpi_acc",
          chart_type: "card",
          label: "Accessibility — No Issues",
          compute: "accessibility_no_issues_kpi",
          sample_api: { form_id: 1, question_id: 2 },
          issues_api: { form_id: 3, question_id: 4 },
          denominator_api: { form_id: 1749621221728 },
        }}
        filterState={emptyFilters}
        computeResponses={computeResponses}
      />
    );
    // Only 1 parent (A) is easily_accessible
    expect(await screen.findByText("1/50 (2%)")).toBeInTheDocument();
  });

  test("renders '—' when response not yet loaded", async () => {
    axiosValue(50); // denominator
    render(
      <KPICard
        item={{
          id: "kpi_acc",
          chart_type: "card",
          label: "Accessibility — No Issues",
          compute: "accessibility_no_issues_kpi",
          sample_api: { form_id: 1, question_id: 2 },
          issues_api: { form_id: 3, question_id: 4 },
          denominator_api: { form_id: 1 },
        }}
        filterState={emptyFilters}
        computeResponses={{}}
      />
    );
    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});
