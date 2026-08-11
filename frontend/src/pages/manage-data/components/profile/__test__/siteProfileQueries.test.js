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

describe("collectSiteProfileQueries — multi-form aliases", () => {
  // EPS and RWS record the same parameter under different names depending on
  // which monitoring form was used. Every alias has to be fetched, or the
  // widget resolves to a question the profile never asked the backend for.
  it("collects every alias of a record row", () => {
    const query = collectSiteProfileQueries({
      children: [
        {
          chart_type: "record",
          source: "rows",
          rows: [
            { id: "e_coli", questions: ["e_coli_level", "e_coli_lab_count"] },
            { question: "turbidity_ntu" },
          ],
        },
      ],
    });

    expect(query.questions).toEqual(
      expect.arrayContaining([
        "e_coli_level",
        "e_coli_lab_count",
        "turbidity_ntu",
      ])
    );
  });

  it("collects every alias of a trend line into history", () => {
    const query = collectSiteProfileQueries({
      children: [
        { chart_type: "line", questions: ["lab_ecoli", "lab_ecoli_count"] },
        { chart_type: "line", question: "ph" },
      ],
    });

    expect(query.history).toEqual(
      expect.arrayContaining(["lab_ecoli", "lab_ecoli_count", "ph"])
    );
  });

  it("still treats questions on a risk_score line as scoring inputs", () => {
    const query = collectSiteProfileQueries({
      children: [
        {
          chart_type: "line",
          source: "risk_score",
          questions: ["system_status"],
          date_question: "inspection_date",
        },
      ],
    });

    expect(query.records).toEqual(
      expect.arrayContaining(["system_status", "inspection_date"])
    );
    expect(query.history).toHaveLength(0);
  });
});
