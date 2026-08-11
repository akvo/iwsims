import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import ProfilePage, { resolveSpan } from "../ProfilePage";
import uiText from "../../../../../lib/ui-text";
import { api } from "../../../../../lib";

jest.mock("../../../../../lib", () => {
  const reg = [
    { question: 111, value: 1998 },
    { question: 222, value: "Fiji|Western" },
  ];
  const dataPointDetails = { id: 500, data: reg };
  return {
    api: { get: jest.fn() },
    store: {
      useState: (selector) => selector({ dataPointDetails }),
      getRawState: () => ({ dataPointDetails }),
      update: () => {},
    },
    getDataPointDetails: () => Promise.resolve(reg),
  };
});

jest.mock("akvo-charts", () => ({
  Line: () => null,
}));

jest.mock("antd", () => {
  const ReactMock = require("react");
  const Passthrough = ({ children }) =>
    ReactMock.createElement("div", null, children);
  const Tabs = ({ children }) => ReactMock.createElement("div", null, children);
  Tabs.TabPane = ({ tab, children }) =>
    ReactMock.createElement("div", null, tab, children);
  return {
    Alert: ({ message }) => ReactMock.createElement("div", null, message),
    // The header's Word Report action. This antd mock is intentionally
    // partial, so each newly used component has to be added here.
    Button: ({ children, onClick }) =>
      ReactMock.createElement("button", { onClick, type: "button" }, children),
    Spin: ({ children }) => ReactMock.createElement("div", null, children),
    Card: ({ title, extra, children }) =>
      ReactMock.createElement("section", null, title, extra, children),
    Row: Passthrough,
    Col: Passthrough,
    Empty: ({ description }) =>
      ReactMock.createElement("div", null, description),
    Image: Object.assign(({ alt }) => ReactMock.createElement("img", { alt }), {
      PreviewGroup: Passthrough,
    }),
    Tag: ({ children }) => ReactMock.createElement("span", null, children),
    Tabs,
    Table: ({ columns, dataSource }) =>
      ReactMock.createElement(
        "table",
        null,
        ReactMock.createElement(
          "thead",
          null,
          ReactMock.createElement(
            "tr",
            null,
            (columns || []).map((column, idx) =>
              ReactMock.createElement("th", { key: idx }, column.title)
            )
          )
        ),
        ReactMock.createElement(
          "tbody",
          null,
          (dataSource || []).map((row) =>
            ReactMock.createElement(
              "tr",
              { key: row.key },
              (columns || []).map((column, idx) =>
                ReactMock.createElement(
                  "td",
                  { key: idx },
                  column.render
                    ? column.render(row[column.dataIndex], row)
                    : row[column.dataIndex]
                )
              )
            )
          )
        )
      ),
  };
});

const config = {
  name_key: "siteProfilePlantCharacteristics",
  header: {
    location: "division",
    meta: [
      { label_key: "siteProfileCommissioned", question: "commissioned_year" },
      { label_key: "siteProfileLastInspection", source: "last_inspection" },
    ],
  },
  tabs: [{ key: "main", label_key: "siteProfileStaffOhs" }],
  children: [
    {
      id: 1,
      tab: "main",
      position: "left",
      order: 1,
      chart_type: "record",
      source: "rows",
      label_key: "siteProfileInfrastructureAssessment",
      rows: [{ question: "ground_conditions" }],
      cols: [
        {
          title_key: "siteProfileComponentCol",
          field: "question",
          render: "question_label",
        },
        {
          title_key: "siteProfileConditionCol",
          field: "question",
          render: "text",
        },
      ],
    },
    {
      id: 2,
      tab: "main",
      position: "right",
      order: 1,
      chart_type: "field",
      label_key: "siteProfileTreatmentProcessesInUse",
      rows: [
        { label_key: "siteProfileNumberOfStaff", question: "staff_count" },
      ],
    },
  ],
};

describe("ProfilePage", () => {
  beforeEach(() => {
    window.forms = [
      {
        content: {
          question_group: [
            {
              question: [
                {
                  name: "ground_conditions",
                  label: "Ground conditions",
                  type: "option",
                  option: [{ value: "good", label: "Good", color: "#009b77" }],
                },
                { name: "staff_count", label: "Staff count", type: "number" },
                {
                  id: 111,
                  name: "commissioned_year",
                  label: "Commissioned year",
                  type: "number",
                },
                {
                  id: 222,
                  name: "division",
                  label: "Division",
                  type: "administration",
                },
              ],
            },
          ],
        },
      },
    ];
    api.get.mockResolvedValue({
      data: {
        name: "Olosara WWTP",
        latest: {
          ground_conditions: {
            value: "good",
            options: ["good"],
            created: "2026-04-30T00:00:00Z",
          },
          staff_count: { value: 7, created: "2026-01-10T00:00:00Z" },
        },
        history: {},
        submissions: [],
      },
    });
  });

  test("renders header (meta + location), a record table and a field list", async () => {
    // MemoryRouter: the header's Word Report button uses useNavigate, and in
    // the app the profile always renders under a route.
    render(
      <MemoryRouter>
        <ProfilePage
          parentId={500}
          parentFormId={1748903240763}
          config={config}
          text={uiText.en}
          enabled
        />
      </MemoryRouter>
    );

    expect(await screen.findByText("Olosara WWTP")).toBeInTheDocument();
    // location from the registration administration answer "Fiji|Western"
    expect(screen.getByText("Western")).toBeInTheDocument();
    // meta: registration field + derived last inspection
    expect(screen.getByText("Commissioned")).toBeInTheDocument();
    expect(screen.getByText("1998")).toBeInTheDocument();
    expect(screen.getByText("Apr 30, 2026")).toBeInTheDocument();
    // widgets
    expect(screen.getByText("Infrastructure Assessment")).toBeInTheDocument();
    expect(screen.getByText("Ground conditions")).toBeInTheDocument();
    expect(screen.getByText("Number of staff")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });
});

describe("resolveSpan", () => {
  it("gives tables the full row", () => {
    // Tables carry several columns; the old fixed 10/24 side column squeezed
    // them badly.
    expect(resolveSpan({ chart_type: "record" })).toBe(24);
  });

  it("pairs field lists and puts trend charts three to a row", () => {
    expect(resolveSpan({ chart_type: "field" })).toBe(12);
    expect(resolveSpan({ chart_type: "line" })).toBe(8);
  });

  it("lets config override the default", () => {
    expect(resolveSpan({ chart_type: "line", col_span: 24 })).toBe(24);
    expect(resolveSpan({ chart_type: "record", col_span: 12 })).toBe(12);
  });

  it("ignores a col_span outside the 1-24 grid", () => {
    expect(resolveSpan({ chart_type: "field", col_span: 0 })).toBe(12);
    expect(resolveSpan({ chart_type: "field", col_span: 30 })).toBe(12);
    expect(resolveSpan({ chart_type: "field", col_span: "wide" })).toBe(12);
  });

  it("falls back to full width for an unknown type", () => {
    expect(resolveSpan({ chart_type: "mystery" })).toBe(24);
    expect(resolveSpan()).toBe(24);
  });
});
