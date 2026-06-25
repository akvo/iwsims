import React from "react";
import { render, screen } from "@testing-library/react";

import ProfileRenderer from "../ProfileRenderer";
import uiText from "../../../../../lib/ui-text";

jest.mock("antd", () => {
  const ReactMock = require("react");
  return {
    Card: ({ title, children }) =>
      ReactMock.createElement("section", null, title, children),
    Col: ({ children }) => ReactMock.createElement("div", null, children),
    Empty: ({ description }) =>
      ReactMock.createElement("div", null, description),
    Image: Object.assign(({ alt }) => ReactMock.createElement("img", { alt }), {
      PreviewGroup: ({ children }) =>
        ReactMock.createElement("div", null, children),
    }),
    Row: ({ children }) => ReactMock.createElement("div", null, children),
    Statistic: ({ title, value }) =>
      ReactMock.createElement("div", null, title, value),
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
            (columns || []).map((column) =>
              ReactMock.createElement(
                "th",
                { key: column.dataIndex },
                column.title
              )
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
              (columns || []).map((column) =>
                ReactMock.createElement(
                  "td",
                  { key: column.dataIndex },
                  column.render
                    ? column.render(row[column.dataIndex], row)
                    : row[column.dataIndex]
                )
              )
            )
          )
        )
      ),
    Tag: ({ children }) => ReactMock.createElement("span", null, children),
    Typography: {
      Text: ({ children }) => ReactMock.createElement("span", null, children),
    },
  };
});

jest.mock("echarts-for-react", () => {
  const ReactMock = require("react");
  return () => ReactMock.createElement("div", null, "chart");
});

jest.mock("../../../../../components/dashboard/widgets/TabsWidget", () => {
  const ReactMock = require("react");
  return ({ item, renderItems }) =>
    ReactMock.createElement("div", null, renderItems(item.items || []));
});

jest.mock(
  "../../../../../components/dashboard/widgets/SectionTitleWidget",
  () => {
    const ReactMock = require("react");
    return ({ item }) => ReactMock.createElement("h4", null, item.label);
  }
);

describe("ProfileRenderer", () => {
  beforeEach(() => {
    window.forms = [
      {
        content: {
          question_group: [
            {
              question: [
                {
                  name: "staff_count",
                  label: "Staff count question",
                  type: "number",
                },
                {
                  name: "inspector",
                  label: "Inspector question",
                  type: "input",
                },
              ],
            },
          ],
        },
      },
    ];
  });

  test("renders localized field lists and record tables from site-profile payload", () => {
    render(
      <ProfileRenderer
        items={[
          {
            id: "staff",
            chart_type: "field_list",
            label_key: "siteProfileStaffOhs",
            rows: [
              {
                label_key: "siteProfileNumberOfStaff",
                question: "staff_count",
              },
            ],
          },
          {
            id: "history",
            chart_type: "record_table",
            label_key: "siteProfileInspectionHistory",
            columns: [
              { title_key: "siteProfileInspectorCol", question: "inspector" },
            ],
          },
        ]}
        recordContext={{
          text: uiText.en,
          payload: {
            latest: {
              staff_count: { value: 7 },
            },
            submissions: [
              {
                data_id: 1,
                answers: {
                  inspector: "E. Bola",
                },
              },
            ],
          },
        }}
      />
    );

    expect(screen.getByText("Staff & OHS")).toBeInTheDocument();
    expect(screen.getByText("Number of staff")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Inspection History")).toBeInTheDocument();
    expect(screen.getByText("Inspector")).toBeInTheDocument();
    expect(screen.getByText("E. Bola")).toBeInTheDocument();
  });
});
