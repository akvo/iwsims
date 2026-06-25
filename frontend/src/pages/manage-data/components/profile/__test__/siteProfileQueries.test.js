import { collectSiteProfileQueries } from "../lib/site-profile-queries";

describe("collectSiteProfileQueries", () => {
  test("collects latest, history, and submission fields from nested config", () => {
    const config = {
      items: [
        {
          chart_type: "tabs",
          items: [
            {
              items: [
                {
                  chart_type: "field_list",
                  questions: ["staff_count"],
                  rows: [{ question: "supervisor" }],
                },
                {
                  chart_type: "assessment",
                  rows: [
                    {
                      question: "ground_condition",
                      photo: "ground_photo",
                      notes: "ground_notes",
                    },
                  ],
                },
                { chart_type: "trend", question: "bod" },
                {
                  chart_type: "record_table",
                  columns: [
                    { source: "date" },
                    { question: "inspector" },
                    { question: "status" },
                  ],
                },
                {
                  chart_type: "photo",
                  source: "submissions",
                  question: "repeat_photo",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(collectSiteProfileQueries(config)).toEqual({
      questions: [
        "staff_count",
        "supervisor",
        "ground_condition",
        "ground_photo",
        "ground_notes",
      ],
      history: ["bod"],
      records: ["inspector", "status", "repeat_photo"],
    });
  });
});
