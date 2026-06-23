import React from "react";
import { render, screen } from "@testing-library/react";
import DotsChart from "../DotsChart";

jest.mock("echarts-for-react", () => {
  const MockECharts = (props) => (
    <div data-testid="echarts" data-option={JSON.stringify(props.option)} />
  );
  MockECharts.displayName = "MockECharts";
  return MockECharts;
});

const renderedNodes = () => {
  const option = JSON.parse(screen.getByTestId("echarts").dataset.option);
  return option.series[0].data;
};

describe("DotsChart", () => {
  test("omits zero, negative, and non-numeric values", () => {
    render(
      <DotsChart
        data={[
          { label: "Water Authority", value: 15 },
          { label: "Department", value: 0 },
          { label: "Negative", value: -1 },
          { label: "Invalid", value: null },
          { label: "No information available", value: 266 },
        ]}
      />
    );

    expect(renderedNodes().map((node) => node.name)).toEqual([
      "Water Authority",
      "No information available",
    ]);
  });

  test("preserves the original category palette index after filtering", () => {
    const colors = ["#111111", "#222222", "#333333"];
    render(
      <DotsChart
        colors={colors}
        data={[
          { label: "Hidden", value: 0 },
          { label: "Visible", value: 10 },
        ]}
      />
    );

    expect(renderedNodes()[0].itemStyle.color).toBe("#222222");
  });
});
