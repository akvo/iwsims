import { collectSiteProfileQueries } from "../utils";

describe("collectSiteProfileQueries", () => {
  test("collects question, history, and record fields from the children config", () => {
    const config = {
      header: {
        photo: "site_photo",
        meta: [{ question: "commissioned_year" }, { value_key: "assetType" }],
      },
      tabs: [{ key: "main", label_key: "main" }],
      children: [
        {
          chart_type: "record",
          source: "rows",
          tab: "main",
          rows: [
            {
              question: "ground_condition",
              photo: "ground_photo",
              notes: "ground_notes",
            },
          ],
        },
        {
          chart_type: "field",
          tab: "main",
          questions: ["staff_count"],
          rows: [{ question: "supervisor" }],
        },
        { chart_type: "line", tab: "main", question: "bod" },
        {
          chart_type: "record",
          source: "submissions",
          tab: "main",
          cols: [
            { dataIndex: "date", render: "date" },
            { dataIndex: "inspector" },
            { dataIndex: "status" },
          ],
        },
        {
          chart_type: "photo",
          source: "submissions",
          tab: "main",
          question: "repeat_photo",
        },
      ],
    };

    expect(collectSiteProfileQueries(config)).toEqual({
      questions: [
        "site_photo",
        "commissioned_year",
        "ground_condition",
        "ground_photo",
        "ground_notes",
        "staff_count",
        "supervisor",
      ],
      history: ["bod"],
      records: ["date", "inspector", "status", "repeat_photo"],
    });
  });
});
