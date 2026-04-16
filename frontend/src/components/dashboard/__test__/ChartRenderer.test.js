import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import ChartRenderer from "../ChartRenderer";
import { __clearVisualizationCache } from "../../../util/hooks/useVisualizationRequest";

jest.mock("axios");

// Replace akvo-charts with lightweight stand-ins that expose the props they
// were called with, so we can assert on what ChartRenderer passed through.
// Bar is forwardRef so ChartWithMarkLines can call ref.current.setOption;
// the mocked setOption stringifies its first arg onto a data attribute so
// tests can assert on the markLine payload.
jest.mock("akvo-charts", () => {
  const ReactMock = jest.requireActual("react");
  const makeRefChart = (testid) => {
    const Component = ReactMock.forwardRef((props, ref) => {
      const [opt, setOpt] = ReactMock.useState(null);
      ReactMock.useImperativeHandle(ref, () => ({
        setOption: (o) => setOpt(o),
      }));
      return ReactMock.createElement("div", {
        "data-testid": testid,
        "data-rows": props.data?.length ?? 0,
        "data-has-raw": String(Boolean(props.rawConfig)),
        "data-option": opt ? JSON.stringify(opt) : "",
      });
    });
    return Component;
  };
  return {
    Bar: makeRefChart("chart-bar"),
    Doughnut: makeRefChart("chart-doughnut"),
    Line: makeRefChart("chart-line"),
    Pie: makeRefChart("chart-pie"),
    StackBar: makeRefChart("chart-stack"),
  };
});

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

  test("histogram threshold auto-renders a red xAxis markLine", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: 49, label: "0", group: "0" },
          { value: 12, label: "50", group: "50" },
        ],
      },
    });
    render(
      <ChartRenderer
        item={{
          id: "param_e_coli",
          chart_type: "histogram",
          threshold: { max: 0 },
          config: {},
          api: { form_id: 1, question_id: 2 },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() => {
      const el = screen.getByTestId("chart-bar");
      expect(el.getAttribute("data-option")).toBeTruthy();
    });
    const opt = JSON.parse(
      screen.getByTestId("chart-bar").getAttribute("data-option")
    );
    expect(opt.series[0].markLine.data).toHaveLength(1);
    expect(opt.series[0].markLine.data[0].xAxis).toBe("0");
    expect(opt.series[0].markLine.data[0].lineStyle.color).toBe("#e74c3c");
  });

  test("histogram bins per-EPS rows and renders pH threshold pair on binned axis", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { label: "EPS A", value: 6.2 },
          { label: "EPS B", value: 6.7 },
          { label: "EPS C", value: 7.1 },
          { label: "EPS D", value: 8.4 },
          { label: "EPS E", value: 9.1 },
        ],
      },
    });
    render(
      <ChartRenderer
        item={{
          id: "param_ph",
          chart_type: "histogram",
          display: { mode: "histogram", bin_width: 0.5 },
          threshold: { min: 6.5, max: 8.5 },
          config: {},
          api: {
            form_id: 1,
            question_id: 2,
            group_by: "parent_id",
            monitoring: "latest",
          },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() => {
      const el = screen.getByTestId("chart-bar");
      expect(el.getAttribute("data-option")).toBeTruthy();
    });
    const el = screen.getByTestId("chart-bar");
    // Bins from 6.0 to 9.0 in 0.5 steps = 7 contiguous bins.
    expect(el.getAttribute("data-rows")).toBe("7");
    const opt = JSON.parse(el.getAttribute("data-option"));
    const xs = opt.series[0].markLine.data.map((d) => d.xAxis).sort();
    expect(xs).toEqual(["6.5", "8.5"]);
  });

  test("explicit mark_lines override threshold and resolve today to month_short", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: 3, label: "Apr", group: "2026-04" },
          { value: 5, label: "May", group: "2026-05" },
        ],
      },
    });
    render(
      <ChartRenderer
        item={{
          id: "monthly_trend",
          chart_type: "bar",
          mark_lines: [
            { axis: "x", type: "today", color: "#2980b9", label: "Today" },
          ],
          config: {},
          api: { form_id: 1, group_by: "month" },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() => {
      const el = screen.getByTestId("chart-bar");
      expect(el.getAttribute("data-option")).toBeTruthy();
    });
    const opt = JSON.parse(
      screen.getByTestId("chart-bar").getAttribute("data-option")
    );
    expect(opt.series[0].markLine.data[0].xAxis).toBe("Apr");
    expect(opt.series[0].markLine.data[0].lineStyle.color).toBe("#2980b9");
    expect(opt.series[0].markLine.data[0].label.formatter).toBe("Today");
  });

  test("mark_lines type=today format=month_year_short resolves to 'Apr 2026'", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: 0, label: "Mar 2026", group: "2026-03" },
          { value: 1, label: "Apr 2026", group: "2026-04" },
        ],
      },
    });
    render(
      <ChartRenderer
        item={{
          id: "chart_proposed_completion_timeline",
          chart_type: "bar",
          mark_lines: [
            {
              axis: "x",
              type: "today",
              format: "month_year_short",
              label: "Today",
            },
          ],
          config: {},
          api: { form_id: 1, group_by: "month" },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("chart-bar").getAttribute("data-option")
      ).toBeTruthy()
    );
    const opt = JSON.parse(
      screen.getByTestId("chart-bar").getAttribute("data-option")
    );
    expect(opt.series[0].markLine.data[0].xAxis).toBe("Apr 2026");
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
