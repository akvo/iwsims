import React from "react";
import { render, screen } from "@testing-library/react";
import axios from "axios";
import MetricCard from "../MetricCard";
import { __clearVisualizationCache } from "../../../../util/hooks/useVisualizationRequest";

jest.mock("axios");

const emptyFilters = {
  from_date: null,
  to_date: null,
  administration_id: null,
  custom: [],
};

const axiosRows = (rows) =>
  axios.mockResolvedValueOnce({ data: { data: rows } });

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
});

const baseItem = {
  id: "kpi_test",
  chart_type: "metric_card",
  label: "Test KPI",
  api: { form_id: 1, question_id: 2, group_by: "option" },
};

describe("MetricCard — scalar mode (no target_group)", () => {
  test("renders raw value when show_percentage is absent", async () => {
    axiosRows([{ group: "total", value: 40 }]);
    render(<MetricCard item={baseItem} filterState={emptyFilters} />);
    expect(await screen.findByText("40")).toBeInTheDocument();
  });

  test("appends % suffix when show_percentage is true", async () => {
    axiosRows([{ group: "total", value: 75 }]);
    render(
      <MetricCard
        item={{ ...baseItem, show_percentage: true }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("75%")).toBeInTheDocument();
  });

  test("renders — when api returns no rows", async () => {
    axiosRows([]);
    render(<MetricCard item={baseItem} filterState={emptyFilters} />);
    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});

describe("MetricCard — share mode (target_group set)", () => {
  const shareItem = { ...baseItem, target_group: "operational" };

  test("renders N/M share when show_percentage is absent", async () => {
    axiosRows([
      { group: "operational", value: 3 },
      { group: "non_functional", value: 2 },
    ]);
    render(<MetricCard item={shareItem} filterState={emptyFilters} />);
    expect(await screen.findByText("3/5")).toBeInTheDocument();
  });

  test("renders N/M (P%) when show_percentage is true", async () => {
    axiosRows([
      { group: "operational", value: 2 },
      { group: "non_functional", value: 2 },
    ]);
    render(
      <MetricCard
        item={{ ...shareItem, show_percentage: true }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("2/4 (50%)")).toBeInTheDocument();
  });

  test("strips trailing zeros, up to 2 dp when non-zero", async () => {
    axiosRows([
      { group: "operational", value: 1 },
      { group: "non_functional", value: 2 },
    ]);
    render(
      <MetricCard
        item={{ ...shareItem, show_percentage: true }}
        filterState={emptyFilters}
      />
    );
    // 1/3 = 33.33...%
    expect(await screen.findByText("1/3 (33.33%)")).toBeInTheDocument();
  });

  test("renders — when denominator is zero (all values zero)", async () => {
    axiosRows([
      { group: "operational", value: 0 },
      { group: "non_functional", value: 0 },
    ]);
    render(
      <MetricCard
        item={{ ...shareItem, show_percentage: true }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  test("renders — when target_group row is missing from response", async () => {
    // Misconfigured target_group key: no row matches 'operational'
    axiosRows([
      { group: "functional", value: 5 },
      { group: "broken", value: 2 },
    ]);
    render(<MetricCard item={shareItem} filterState={emptyFilters} />);
    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  test("includes _no_info row in denominator (include_unanswered)", async () => {
    axiosRows([
      { group: "operational", value: 3 },
      { group: "non_functional", value: 1 },
      { group: "_no_info", value: 2 },
    ]);
    render(
      <MetricCard
        item={{ ...shareItem, show_percentage: true }}
        filterState={emptyFilters}
      />
    );
    // denominator = 3+1+2 = 6; operational = 3/6 = 50%
    expect(await screen.findByText("3/6 (50%)")).toBeInTheDocument();
  });
});

describe("MetricCard — label and color", () => {
  test("renders the item label as the statistic title", async () => {
    axiosRows([{ group: "total", value: 10 }]);
    render(
      <MetricCard
        item={{ ...baseItem, label: "Total RWS" }}
        filterState={emptyFilters}
      />
    );
    expect(await screen.findByText("Total RWS")).toBeInTheDocument();
  });
});
