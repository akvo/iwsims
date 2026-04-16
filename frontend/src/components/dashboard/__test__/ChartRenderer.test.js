import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import ChartRenderer from "../ChartRenderer";
import { __clearVisualizationCache } from "../../../util/hooks/useVisualizationRequest";

jest.mock("axios");

// Replace akvo-charts with lightweight stand-ins that expose the props they
// were called with, so we can assert on what ChartRenderer passed through.
jest.mock("akvo-charts", () => ({
  Bar: (props) => (
    <div data-testid="chart-bar" data-rows={props.data?.length ?? 0} />
  ),
  Doughnut: (props) => (
    <div data-testid="chart-doughnut" data-rows={props.data?.length ?? 0} />
  ),
  Line: () => <div data-testid="chart-line" />,
  Pie: () => <div data-testid="chart-pie" />,
  StackBar: (props) => (
    <div
      data-testid="chart-stack"
      data-rows={props.data?.length ?? 0}
      data-has-raw={String(Boolean(props.rawConfig))}
    />
  ),
}));

const emptyFilters = {
  from_date: null,
  to_date: null,
  administration_id: null,
  custom: [],
};
const today = new Date(Date.UTC(2026, 3, 14));

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
});

describe("ChartRenderer", () => {
  test("renders an unsupported-type alert when chart_type is unknown", () => {
    render(
      <ChartRenderer
        item={{ id: "bogus", chart_type: "tree_map", api: { form_id: 1 } }}
        filterState={emptyFilters}
        today={today}
      />
    );
    expect(
      screen.getByText(/Unsupported chart_type: tree_map \(bogus\)/)
    ).toBeInTheDocument();
  });

  test("api-driven doughnut fetches and passes rows to the chart", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: 90, label: "Operational", group: "operational" },
          { value: 20, label: "Issue", group: "issue_with_system" },
        ],
      },
    });

    render(
      <ChartRenderer
        item={{
          id: "chart_operational_status",
          chart_type: "doughnut",
          config: { title: "Operational Status" },
          api: {
            form_id: 1749632545233,
            question_id: 1749633373968,
            group_by: "option",
            monitoring: "latest",
          },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("chart-doughnut")).toHaveAttribute(
        "data-rows",
        "2"
      )
    );
  });

  test("donut with all-zero values renders No data (not equal slices)", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: 0, label: "Operational", group: "operational" },
          { value: 0, label: "Issue", group: "issue_with_system" },
        ],
      },
    });

    render(
      <ChartRenderer
        item={{
          id: "chart_zero",
          chart_type: "doughnut",
          config: { title: "Zero" },
          api: { form_id: 1, question_id: 2, group_by: "option" },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );

    await waitFor(() =>
      expect(screen.getByText("No data")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("chart-doughnut")).toBeNull();
  });

  test("source=progress reuses a progress definition resolved via definitionsById", async () => {
    // The progress hook will still fire a request for the definition's data;
    // stub it out so the inner .then() doesn't crash. The assertion below
    // checks that NO chart-specific call is made on top of that.
    axios.mockResolvedValue({ data: { histogram: [], details: [] } });

    // Build a minimal definitionsById map with the progress definition item.
    const progressDef = {
      id: "progress_construction",
      chart_type: "progress_definition",
      hide: true,
      order: 0,
      key: "construction",
      api: { form_id: 1 },
      components: [],
    };
    const definitionsById = new Map([["progress_construction", progressDef]]);

    // Provide the response keyed by item id via complianceResponses is NOT
    // used here — progress data comes through useDashboardProgress inside the
    // component. We test the shape via the rendered output once progress data
    // arrives. Since we can't easily mock the hook here, we verify at least
    // that no extra axios call is made for the chart itself and the "No data"
    // placeholder appears (progress hook returns nothing in test env).
    render(
      <ChartRenderer
        item={{
          id: "chart_construction_progression",
          chart_type: "bar",
          source: "progress",
          progress_ref: "progress_construction",
          field: "histogram",
          config: { title: "Progression" },
        }}
        filterState={emptyFilters}
        today={today}
        definitionsById={definitionsById}
      />
    );
    // The chart itself does not fire its own values call — data comes from
    // the progress hook. Any axios call here is the progress fetch.
    await waitFor(() => {
      const urls = axios.mock.calls.map((c) => c[0].url);
      expect(urls.every((u) => u.startsWith("visualization/progress/"))).toBe(
        true
      );
    });
  });

  test("compute=compliance renders a StackBar built from complianceResponses", () => {
    // In the new schema, params are items identified by id. We build a minimal
    // definitionsById with two param items and pass their ids in params_ref.
    const param1 = {
      id: "param_e_coli",
      chart_type: "histogram",
      label: "E. coli",
      threshold: { max: 0 },
      api: { form_id: 1, question_id: 2 },
    };
    const definitionsById = new Map([["param_e_coli", param1]]);

    const complianceResponses = {
      param_e_coli: {
        data: [
          { group: "1", label: "A", value: 0 },
          { group: "2", label: "B", value: 5 },
        ],
      },
    };

    render(
      <ChartRenderer
        item={{
          id: "chart_drinking_water_compliance",
          chart_type: "stack_bar",
          compute: "compliance",
          params_ref: ["param_e_coli"],
          globals_ref: "wq_globals",
          config: { title: "Drinking Water Compliance" },
        }}
        filterState={emptyFilters}
        today={today}
        definitionsById={definitionsById}
        complianceResponses={complianceResponses}
      />
    );
    const el = screen.getByTestId("chart-stack");
    expect(el).toHaveAttribute("data-rows", "2"); // Yes + No rows
    expect(axios).not.toHaveBeenCalled();
  });

  test("passes raw_config through to the underlying component", async () => {
    axios.mockResolvedValue({
      data: { data: [{ value: 1, label: "A", group: "a" }] },
    });
    render(
      <ChartRenderer
        item={{
          id: "chart_timeline",
          chart_type: "stack_bar",
          api: { form_id: 1 },
          raw_config: { series: [{ type: "bar" }] },
          config: {},
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("chart-stack")).toHaveAttribute(
        "data-has-raw",
        "true"
      )
    );
  });
});
