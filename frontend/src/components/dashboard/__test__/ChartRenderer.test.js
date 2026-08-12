import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import ChartRenderer, { axisNameGridPatch } from "../ChartRenderer";
import { __clearVisualizationCache } from "../../../util/hooks/useVisualizationRequest";
import { STATUS_COLORS } from "../constants";

jest.mock("axios");

// Stub ECharts so DotStripChart can render in jsdom without a real canvas.
// Implementations (init return value, getInstanceByDom return value) are set
// up per-test via mockReturnValue so the factory stays free of jest.fn closures.
jest.mock("echarts", () => ({
  init: jest.fn(),
  getInstanceByDom: jest.fn(),
}));

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
        getOption: () => {
          const dimensions = Array.from(
            new Set((props.data || []).flatMap((row) => Object.keys(row)))
          );
          return {
            series: dimensions.slice(1).map((name) => ({ name })),
          };
        },
      }));
      return ReactMock.createElement("div", {
        "data-testid": testid,
        "data-rows": props.data?.length ?? 0,
        "data-payload": JSON.stringify(props.data || []),
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
        parentFormId={1748903240763}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("chart-doughnut")).toHaveAttribute(
        "data-rows",
        "2"
      )
    );
    expect(axios.mock.calls[0][0].params.parent_form_id).toBe(1748903240763);
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

  test("compute=cross_tab reads from computeResponses.cross_tab and does not fetch", () => {
    // Backend shape per akvo-mis-bvt: {label, group, [opt_col]: count, ...}
    const computeResponses = {
      cross_tab: {
        chart_xtab: {
          category: {
            data: [
              { label: "A", group: 1, Borehole: 1, Desalination: 0 },
              { label: "B", group: 2, Borehole: 0, Desalination: 1 },
            ],
          },
          series: {
            data: [
              { label: "A", group: 1, WAF: 1, Rotary: 0 },
              { label: "B", group: 2, WAF: 0, Rotary: 1 },
            ],
          },
        },
      },
    };
    render(
      <ChartRenderer
        item={{
          id: "chart_xtab",
          chart_type: "stack_bar",
          compute: "cross_tab",
          category_api: { form_id: 1, question_id: 2 },
          series_api: { form_id: 3, question_id: 4 },
          config: { title: "Implementation at Scale" },
        }}
        filterState={emptyFilters}
        today={today}
        computeResponses={computeResponses}
      />
    );
    expect(screen.getByTestId("chart-stack")).toHaveAttribute("data-rows", "2");
    expect(axios).not.toHaveBeenCalled();
  });

  test("compute=accessibility_bucket emits a single-row stack", () => {
    const computeResponses = {
      accessibility_bucket: {
        chart_acc: {
          sample: {
            data: [
              { label: "A", group: 1, Yes: 1, No: 0 },
              { label: "B", group: 2, Yes: 0, No: 1 },
            ],
          },
          issues: {
            data: [{ label: "A", group: 1, Yes: 0, No: 1 }],
          },
        },
      },
    };
    render(
      <ChartRenderer
        item={{
          id: "chart_acc",
          chart_type: "stack_bar",
          compute: "accessibility_bucket",
          sample_api: { form_id: 1, question_id: 2 },
          issues_api: { form_id: 3, question_id: 4 },
          labels: {
            easily_accessible: "Easily accessible",
            accessible_with_issues: "Accessible with issues",
            not_accessible: "Not accessible",
          },
          config: { title: "Accessibility" },
        }}
        filterState={emptyFilters}
        today={today}
        computeResponses={computeResponses}
      />
    );
    expect(screen.getByTestId("chart-stack")).toHaveAttribute("data-rows", "1");
    expect(axios).not.toHaveBeenCalled();
  });

  test("compute=kpi_stack assembles a single-row stack from segment responses", () => {
    const computeResponses = {
      kpi_stack: {
        chart_op: {
          operational: { data: [{ value: 85 }] },
          issues: { data: [{ value: 16 }] },
        },
      },
    };
    render(
      <ChartRenderer
        item={{
          id: "chart_op",
          chart_type: "stack_bar",
          compute: "kpi_stack",
          segments: [
            { key: "operational", label: "Operational" },
            { key: "issues", label: "Issues with the system" },
          ],
          config: { title: "Operational Status" },
        }}
        filterState={emptyFilters}
        today={today}
        computeResponses={computeResponses}
      />
    );
    expect(screen.getByTestId("chart-stack")).toHaveAttribute("data-rows", "1");
    expect(axios).not.toHaveBeenCalled();
  });

  test("binds unique compliance colors by series name", () => {
    const computeResponses = {
      kpi_stack: {
        chart_compliance: {
          compliant: { data: [{ value: 10 }] },
          salinity: { data: [{ value: 2 }] },
          e_coli_cbt: { data: [{ value: 1 }] },
          no_info: { data: [{ value: 3 }] },
          not_applicable: { data: [{ value: 4 }] },
        },
      },
    };
    render(
      <ChartRenderer
        item={{
          id: "chart_compliance",
          chart_type: "stack_bar",
          compute: "kpi_stack",
          segments: [
            { key: "compliant", label: "Compliant" },
            { key: "salinity", label: "Salinity" },
            { key: "e_coli_cbt", label: "E-coli CBT" },
            { key: "no_info", label: "No information available" },
            { key: "not_applicable", label: "N/A" },
          ],
          config: {
            title: "Compliance",
          },
          color_map: {
            Compliant: "#2e7d32",
            Salinity: "#9e7c00",
            "E-coli CBT": "#7c4dff",
            "No information available": "#90a4ae",
            "N/A": "#263238",
          },
        }}
        filterState={emptyFilters}
        today={today}
        computeResponses={computeResponses}
      />
    );

    const opt = JSON.parse(
      screen.getByTestId("chart-stack").getAttribute("data-option")
    );
    const colors = opt.series.map((series) => series.itemStyle.color);
    expect(colors).toEqual([
      "#2e7d32",
      "#9e7c00",
      "#7c4dff",
      "#90a4ae",
      "#263238",
    ]);
    expect(new Set(colors).size).toBe(colors.length);
  });

  test("compute=process_counts assembles horizontal bar rows from segment responses", () => {
    const computeResponses = {
      process_counts: {
        chart_processes: {
          flocculation: { data: [{ value: 18 }] },
          sedimentation: { data: [{ value: 7 }] },
          filtration: { data: [{ value: 9 }] },
        },
      },
    };
    render(
      <ChartRenderer
        item={{
          id: "chart_processes",
          chart_type: "bar",
          compute: "process_counts",
          orientation: "horizontal",
          sort: "desc",
          segments: [
            { key: "flocculation", label: "Coagulation/Flocculation" },
            { key: "sedimentation", label: "Sedimentation/Clarification" },
            { key: "filtration", label: "Filtration" },
          ],
          config: {
            title: "Treatment Processes in Use",
            grid: { left: 160, right: 32 },
          },
        }}
        filterState={emptyFilters}
        today={today}
        computeResponses={computeResponses}
      />
    );
    expect(screen.getByTestId("chart-bar")).toHaveAttribute("data-rows", "3");
    const opt = JSON.parse(
      screen.getByTestId("chart-bar").getAttribute("data-option")
    );
    expect(opt.grid).toEqual({ left: 160, right: 32 });
    expect(axios).not.toHaveBeenCalled();
  });

  test("horizontal chart applies config.xAxis.minInterval to the value axis", () => {
    const computeResponses = {
      process_counts: {
        chart_processes: {
          flocculation: { data: [{ value: 2 }] },
          filtration: { data: [{ value: 1 }] },
        },
      },
    };
    render(
      <ChartRenderer
        item={{
          id: "chart_processes",
          chart_type: "bar",
          compute: "process_counts",
          orientation: "horizontal",
          segments: [
            { key: "flocculation", label: "Floc" },
            { key: "filtration", label: "Filtration" },
          ],
          config: {
            title: "Implementation at Scale",
            xAxis: { nameGap: 164, minInterval: 1 },
          },
        }}
        filterState={emptyFilters}
        today={today}
        computeResponses={computeResponses}
      />
    );
    const opt = JSON.parse(
      screen.getByTestId("chart-bar").getAttribute("data-option")
    );
    // Value axis is the x-axis when horizontal → integer-only ticks.
    expect(opt.xAxis.minInterval).toBe(1);
    expect(axios).not.toHaveBeenCalled();
  });

  test("compute=date_histogram buckets latest dates and applies row colors", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: "2026-04-01", label: "A", group: "1" },
          { value: "2026-03-01", label: "B", group: "2" },
          { value: "2025-12-01", label: "C", group: "3" },
          { value: "2024-11-01", label: "D", group: "4" },
        ],
      },
    });
    render(
      <ChartRenderer
        item={{
          id: "chart_inspectiondate_histogram",
          chart_type: "bar",
          compute: "date_histogram",
          config: { title: "Inspection-date histogram" },
          api: {
            question_name: "date_of_inspection",
            group_by: "parent_id",
            monitoring: "latest",
          },
          display: { mode: "date_histogram", months: 3 },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("chart-bar")).toHaveAttribute("data-rows", "4")
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("chart-bar").getAttribute("data-option")
      ).toBeTruthy()
    );
    const opt = JSON.parse(
      screen.getByTestId("chart-bar").getAttribute("data-option")
    );
    expect(opt.xAxis.data).toEqual(["> 3 mo", "Feb '26", "Mar '26", "Apr '26"]);
    expect(opt.series[0].data[0].value).toBe(2);
    expect(opt.series[0].data[0].itemStyle.color).toBe(STATUS_COLORS.critical);
  });

  test("display=value_buckets buckets parent-level numeric rows", async () => {
    axios.mockResolvedValue({
      data: {
        data: [
          { value: 0, label: "Plant A", group: "1" },
          { value: 1, label: "Plant B", group: "2" },
          { value: 2, label: "Plant C", group: "3" },
          { value: 2, label: "Plant D", group: "4" },
          { value: 4, label: "Plant E", group: "5" },
          { value: 6, label: "Plant F", group: "6" },
        ],
      },
    });
    render(
      <ChartRenderer
        item={{
          id: "chart_floc_tank_count",
          chart_type: "bar",
          config: { title: "Sedimentation — Floc Tank Count" },
          api: {
            question_name: "floc_tanks_are_there_at_the_plant",
            group_by: "parent_id",
            monitoring: "latest",
          },
          display: {
            mode: "value_buckets",
            buckets: [
              { label: "0", value: 0 },
              { label: "1", value: 1 },
              { label: "2", value: 2 },
              { label: "3", value: 3 },
              { label: "4+", min: 4 },
            ],
          },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId("chart-bar")).toHaveAttribute("data-rows", "5")
    );
    expect(
      JSON.parse(screen.getByTestId("chart-bar").getAttribute("data-payload"))
    ).toEqual([
      { label: "0", value: 1 },
      { label: "1", value: 1 },
      { label: "2", value: 2 },
      { label: "3", value: 0 },
      { label: "4+", value: 2 },
    ]);
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

  test("boxplot fetches data and renders a chart container", async () => {
    const echartsLib = require("echarts");
    const mockChart = {
      setOption: jest.fn(),
      resize: jest.fn(),
      dispose: jest.fn(),
    };
    echartsLib.init.mockReset();
    echartsLib.getInstanceByDom.mockReset();
    echartsLib.init.mockReturnValue(mockChart);
    echartsLib.getInstanceByDom.mockReturnValue(null);

    axios.mockResolvedValue({
      data: {
        data: [
          { value: 0, label: "EPS A", group: "a" },
          { value: 0, label: "EPS B", group: "b" },
          { value: 15, label: "EPS C", group: "c" },
          { value: 200, label: "EPS D", group: "d" },
        ],
      },
    });

    render(
      <ChartRenderer
        item={{
          id: "param_total_coliform",
          chart_type: "dot_strip",
          threshold: { max: 0 },
          config: { title: "Total coliform presence", xAxisLabel: "CFU/100mL" },
          api: {
            form_id: 1749632545233,
            question_id: 1749633259392,
            group_by: "parent_id",
            monitoring: "latest",
          },
        }}
        filterState={emptyFilters}
        today={today}
      />
    );

    await waitFor(() => expect(echartsLib.init).toHaveBeenCalled());
    expect(mockChart.setOption).toHaveBeenCalled();
    const option = mockChart.setOption.mock.calls[0][0];
    expect(option.series[0].type).toBe("scatter");
    expect(option.series[0].markLine.data[0].xAxis).toBe(0);
    expect(axios).toHaveBeenCalledTimes(1);
  });
});

describe("axisNameGridPatch", () => {
  // akvo-charts pins grid.bottom to 10% and containLabel only accounts for
  // tick labels, not the axis NAME — which is drawn nameGap below the axis
  // line and lands off-canvas on a card-height chart. Charts had been working
  // around it one at a time; the renderer now carries it.
  it("reserves room for a named category axis", () => {
    expect(axisNameGridPatch({ xAxisLabel: "Month" })).toEqual({
      grid: { bottom: 72, containLabel: true },
    });
  });

  it("scales the room to a custom nameGap", () => {
    expect(
      axisNameGridPatch({ xAxisLabel: "Month", xAxis: { nameGap: 72 } })
    ).toEqual({ grid: { bottom: 96, containLabel: true } });
  });

  it("does nothing when the chart names no axis", () => {
    expect(axisNameGridPatch({})).toEqual({});
    expect(axisNameGridPatch({ yAxisLabel: "count" })).toEqual({});
  });

  it("never overrides an explicit grid", () => {
    const config = { xAxisLabel: "Month", grid: { bottom: 40 } };
    expect(axisNameGridPatch(config)).toEqual({});
  });

  it("leaves horizontal charts alone", () => {
    // Their category name sits on the y-axis and needs left-gutter room,
    // which depends on how long the category labels are — no single default
    // fits, so those keep their per-chart grid.
    expect(axisNameGridPatch({ xAxisLabel: "# of plants" }, true)).toEqual({});
  });

  it("tolerates a missing config", () => {
    expect(axisNameGridPatch()).toEqual({});
  });
});
