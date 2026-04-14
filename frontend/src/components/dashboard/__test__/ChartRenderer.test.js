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
        chartKey="bogus"
        chart={{ chart_type: "tree_map", api: { form_id: 1 } }}
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
        chartKey="operational_status"
        chart={{
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

  test("source=progress reuses the passed progressResponses (no extra fetch)", () => {
    render(
      <ChartRenderer
        chartKey="construction_progression"
        chart={{
          chart_type: "bar",
          source: "progress",
          progress_ref: "construction",
          field: "histogram",
          config: { title: "Progression" },
        }}
        filterState={emptyFilters}
        today={today}
        progressResponses={{
          construction: {
            histogram: [
              { progress: "0-10%", count: 1 },
              { progress: "91-100%", count: 3 },
            ],
          },
        }}
      />
    );
    expect(screen.getByTestId("chart-bar")).toHaveAttribute("data-rows", "2");
    expect(axios).not.toHaveBeenCalled();
  });

  test("compute=compliance renders a StackBar built from complianceResponses", () => {
    const parameters = [
      { key: "e_coli", label: "E. coli", threshold: { max: 0 } },
    ];
    const responses = {
      e_coli: {
        data: [
          { group: "1", label: "A", value: 0 },
          { group: "2", label: "B", value: 5 },
        ],
      },
    };
    render(
      <ChartRenderer
        chartKey="drinking_water_compliance"
        chart={{
          chart_type: "stack_bar",
          compute: "compliance",
          config: { title: "Drinking Water Compliance" },
        }}
        filterState={emptyFilters}
        today={today}
        waterQualityParameters={parameters}
        complianceResponses={responses}
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
        chartKey="timeline"
        chart={{
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
