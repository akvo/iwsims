import {
  daysSince,
  mergeInspectionRows,
  resolveSegmentColumns,
  rollingFromDate,
} from "../mergeInspections";

const COLUMNS = [
  { key: "last_inspected", source: "latest_date", title: "When" },
  { key: "asset", computed: true, title: "Type" },
  { key: "name", source: "parent_name", title: "Facility" },
  { key: "administration", source: "administration", title: "Division" },
  { key: "inspector", source: "answer", title: "Inspector" },
  { key: "days_ago", computed: true, title: "Days ago" },
];

const WTP = {
  key: "wtp",
  label: "WTP",
  questions: {
    last_inspected: "date_of_inspection",
    inspector: "dws_officer_name",
  },
};

describe("resolveSegmentColumns", () => {
  it("fills each question-backed column from the segment's own names", () => {
    const cols = resolveSegmentColumns(COLUMNS, WTP);
    expect(cols.find((c) => c.key === "last_inspected").question_name).toBe(
      "date_of_inspection"
    );
    expect(cols.find((c) => c.key === "inspector").question_name).toBe(
      "dws_officer_name"
    );
  });

  it("leaves fixed-source columns alone", () => {
    const cols = resolveSegmentColumns(COLUMNS, WTP);
    expect(cols.find((c) => c.key === "name")).toEqual({
      key: "name",
      source: "parent_name",
      title: "Facility",
    });
  });

  it("drops computed columns, which the backend cannot serve", () => {
    const keys = resolveSegmentColumns(COLUMNS, WTP).map((c) => c.key);
    expect(keys).not.toContain("asset");
    expect(keys).not.toContain("days_ago");
  });

  it("drops a question-backed column the segment does not ask", () => {
    // Asking for a question a form has no copy of does not blank one cell —
    // it makes the whole column resolve to nothing for every row.
    const keys = resolveSegmentColumns(COLUMNS, {
      key: "pump",
      questions: { last_inspected: "inspection_date" },
    }).map((c) => c.key);
    expect(keys).toContain("last_inspected");
    expect(keys).not.toContain("inspector");
  });
});

describe("mergeInspectionRows", () => {
  const responses = [
    {
      segment: { key: "wwtp", label: "WWTP" },
      rows: [
        { id: 1, name: "Kinoya", last_inspected: "2026-07-12" },
        { id: 2, name: "Natabua", last_inspected: "2026-01-04" },
      ],
    },
    {
      segment: { key: "wtp", label: "WTP" },
      rows: [{ id: 3, name: "Tamavua", last_inspected: "2026-07-15" }],
    },
    {
      segment: { key: "pump", label: "Pump Stations" },
      rows: [{ id: 4, name: "Station 4", last_inspected: "2026-06-11" }],
    },
  ];

  it("interleaves assets in date order, newest first", () => {
    const rows = mergeInspectionRows(responses, "last_inspected", 8);
    expect(rows.map((r) => r.name)).toEqual([
      "Tamavua",
      "Kinoya",
      "Station 4",
      "Natabua",
    ]);
  });

  it("labels each row with the asset it came from", () => {
    const rows = mergeInspectionRows(responses, "last_inspected", 8);
    expect(rows[0].__assetLabel).toBe("WTP");
    expect(rows[2].__segment).toBe("pump");
  });

  it("keeps only the newest `limit` rows across all assets", () => {
    const rows = mergeInspectionRows(responses, "last_inspected", 2);
    expect(rows.map((r) => r.name)).toEqual(["Tamavua", "Kinoya"]);
  });

  it("drops rows with no date rather than sorting them to an end", () => {
    // A dateless row placed at either end reads as the most or least recent
    // inspection, which is a claim the data does not support.
    const rows = mergeInspectionRows(
      [
        {
          segment: { key: "eps", label: "EPS" },
          rows: [
            { id: 9, name: "No date", last_inspected: null },
            { id: 10, name: "Dated", last_inspected: "2026-05-01" },
          ],
        },
      ],
      "last_inspected",
      8
    );
    expect(rows.map((r) => r.name)).toEqual(["Dated"]);
  });

  it("breaks ties by name so the order is stable between renders", () => {
    const sameDay = [
      {
        segment: { key: "a", label: "A" },
        rows: [{ id: 1, name: "Zulu", last_inspected: "2026-07-12" }],
      },
      {
        segment: { key: "b", label: "B" },
        rows: [{ id: 2, name: "Alpha", last_inspected: "2026-07-12" }],
      },
    ];
    expect(
      mergeInspectionRows(sameDay, "last_inspected", 8).map((r) => r.name)
    ).toEqual(["Alpha", "Zulu"]);
    expect(
      mergeInspectionRows([...sameDay].reverse(), "last_inspected", 8).map(
        (r) => r.name
      )
    ).toEqual(["Alpha", "Zulu"]);
  });

  it("compares dates by day, ignoring a time or timezone suffix", () => {
    const rows = mergeInspectionRows(
      [
        {
          segment: { key: "a", label: "A" },
          rows: [
            { id: 1, name: "Older", last_inspected: "2026-07-11T23:00:00Z" },
            { id: 2, name: "Newer", last_inspected: "2026-07-12T01:00:00Z" },
          ],
        },
      ],
      "last_inspected",
      8
    );
    expect(rows.map((r) => r.name)).toEqual(["Newer", "Older"]);
  });

  it("survives an asset that returned nothing", () => {
    const rows = mergeInspectionRows(
      [
        { segment: { key: "a", label: "A" }, rows: [] },
        {
          segment: { key: "b", label: "B" },
          rows: [{ id: 1, name: "Only", last_inspected: "2026-07-12" }],
        },
      ],
      "last_inspected",
      8
    );
    expect(rows).toHaveLength(1);
  });

  it("returns nothing before any asset has answered", () => {
    expect(mergeInspectionRows([], "last_inspected", 8)).toEqual([]);
  });
});

describe("daysSince", () => {
  const today = new Date("2026-08-12T09:00:00Z");

  it("counts whole days back to the inspection", () => {
    expect(daysSince("2026-08-12", today)).toBe(0);
    expect(daysSince("2026-08-11", today)).toBe(1);
    expect(daysSince("2026-07-12", today)).toBe(31);
  });

  it("ignores the time of day on both sides", () => {
    expect(daysSince("2026-08-11T23:59:00Z", today)).toBe(1);
  });

  it("returns null for a missing or unusable date", () => {
    expect(daysSince(null, today)).toBeNull();
    expect(daysSince("", today)).toBeNull();
    expect(daysSince("not-a-date", today)).toBeNull();
  });
});

describe("rollingFromDate", () => {
  const today = new Date("2026-08-12T09:00:00Z");

  it("walks back the requested number of months", () => {
    expect(rollingFromDate(12, today)).toBe("2025-08-12");
    expect(rollingFromDate(3, today)).toBe("2026-05-12");
  });

  it("omits the bound when the item declares no window", () => {
    expect(rollingFromDate(0, today)).toBeNull();
    expect(rollingFromDate(null, today)).toBeNull();
  });
});
