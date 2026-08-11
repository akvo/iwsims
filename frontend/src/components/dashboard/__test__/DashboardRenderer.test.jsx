import React from "react";
import { render, screen } from "@testing-library/react";
import axios from "axios";
import { __clearVisualizationCache } from "../../../util/hooks/useVisualizationRequest";

jest.mock("axios");
jest.mock("antd", () => {
  const ReactMock = require("react");
  const actual = jest.requireActual("antd");
  return {
    ...actual,
    Row: ({ children }) =>
      ReactMock.createElement(
        "div",
        { "data-testid": "dashboard-row" },
        children
      ),
    Col: ({ children }) =>
      ReactMock.createElement(
        "div",
        { "data-testid": "dashboard-col" },
        children
      ),
  };
});

const emptyFilters = {
  from_date: null,
  to_date: null,
  administration_id: null,
  custom: [],
};

let DashboardRenderer;

beforeAll(() => {
  // window.matchMedia is stubbed globally in setupTests.js. It must NOT be
  // re-stubbed here with a jest.fn(): react-scripts enables `resetMocks`, which
  // clears the implementation before every test and makes matchMedia() return
  // undefined — AntD's responsive observer then throws on `.addListener`.
  // eslint-disable-next-line global-require
  DashboardRenderer = require("../DashboardRenderer").default;
});

beforeEach(() => {
  axios.mockReset();
  __clearVisualizationCache();
});

describe("DashboardRenderer", () => {
  test("dispatches chart_type=ranking to RankingWidget", async () => {
    axios.mockResolvedValueOnce({
      data: {
        data: [
          {
            group: "1",
            label: "Site Alpha",
            value: "2025-01-10T00:00:00.000Z",
          },
        ],
      },
    });

    render(
      <DashboardRenderer
        items={[
          {
            id: "rank_most_recently_monitored",
            chart_type: "ranking",
            label: "Most recently monitored",
            api: {
              question_name: "inspection_date",
              sort: "desc",
              limit: 8,
              monitoring: "latest",
            },
          },
        ]}
        filterState={emptyFilters}
        parentFormId={1748903240763}
      />
    );

    expect(await screen.findByText("Site Alpha")).toBeInTheDocument();
    expect(
      screen.getByTestId("ranking-widget-rank_most_recently_monitored")
    ).toBeInTheDocument();
  });
});
