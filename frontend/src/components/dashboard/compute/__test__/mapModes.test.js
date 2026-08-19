import {
  UNKNOWN,
  buildModePoints,
  classifyRecency,
  classifyVerdict,
  latestByParent,
  modeBuckets,
  monthsSince,
  resolveFamilies,
  resolveModes,
  verdictsByParent,
} from "../mapModes";
import { STATUS_COLORS } from "../../constants";

const TODAY = new Date("2026-08-19T00:00:00Z");

const BANDS = [
  { key: "recent", label: "≤ 6 months", max_months: 6, tone: "good" },
  { key: "watch", label: "7–12 months", max_months: 12, tone: "warning" },
  { key: "overdue", label: "> 12 months", tone: "critical" },
];

describe("resolveModes", () => {
  it("wraps a config that predates modes as its single mode", () => {
    // The per-asset maps still declare `sources` at the top level. Migrating
    // every one of them to say the same thing twice would be churn.
    const modes = resolveModes({
      label: "Asset status",
      sources: [{ key: "rws", question_name: "infrastructure_status" }],
    });
    expect(modes).toHaveLength(1);
    expect(modes[0].type).toBe("option");
    expect(modes[0].sources[0].key).toBe("rws");
  });

  it("prefers declared modes", () => {
    const modes = resolveModes({
      sources: [{ key: "rws" }],
      modes: [{ key: "a" }, { key: "b" }],
    });
    expect(modes.map((m) => m.key)).toEqual(["a", "b"]);
  });
});

describe("resolveFamilies", () => {
  it("falls back to the sources of a pre-modes config", () => {
    expect(
      resolveFamilies({
        sources: [{ key: "rws", label: "RWS", form_id: 1, extra: "ignored" }],
      })
    ).toEqual([{ key: "rws", label: "RWS", form_id: 1 }]);
  });
});

describe("modeBuckets", () => {
  it("names tones, never hexes", () => {
    const buckets = modeBuckets({
      buckets: [{ key: "compliant", label: "Compliant", tone: "good" }],
    });
    expect(buckets[0].color).toBe(STATUS_COLORS.good);
  });

  it("gives a recency mode an unknown bucket of its own", () => {
    // "Never inspected" and "overdue" are the same colour of bad news but not
    // the same fact, and only one of them is about the site.
    const buckets = modeBuckets({
      type: "recency",
      bands: BANDS,
      unknown_label: "Never inspected",
    });
    expect(buckets.map((b) => b.key)).toEqual([
      "recent",
      "watch",
      "overdue",
      UNKNOWN,
    ]);
    expect(buckets[3].color).toBe(STATUS_COLORS.noData);
  });
});

describe("classifyRecency", () => {
  it("uses the histogram's bands", () => {
    expect(classifyRecency("2026-07-01", BANDS, TODAY)).toBe("recent");
    // Six calendar months back is still inside the first band; seven is not.
    expect(classifyRecency("2026-02-15", BANDS, TODAY)).toBe("recent");
    expect(classifyRecency("2026-01-15", BANDS, TODAY)).toBe("watch");
    expect(classifyRecency("2025-08-31", BANDS, TODAY)).toBe("watch");
    expect(classifyRecency("2025-07-31", BANDS, TODAY)).toBe("overdue");
    expect(classifyRecency("2024-02-01", BANDS, TODAY)).toBe("overdue");
  });

  it("calls a missing or unparseable date unknown, not overdue", () => {
    expect(classifyRecency(null, BANDS, TODAY)).toBe(UNKNOWN);
    expect(classifyRecency("not a date", BANDS, TODAY)).toBe(UNKNOWN);
  });

  it("does not read a future date as ancient", () => {
    expect(monthsSince("2027-01-01", TODAY)).toBe(0);
    expect(classifyRecency("2027-01-01", BANDS, TODAY)).toBe("recent");
  });
});

describe("classifyVerdict", () => {
  it("colours only a real verdict", () => {
    expect(classifyVerdict("compliant")).toBe("compliant");
    expect(classifyVerdict("non_compliant")).toBe("non_compliant");
  });

  it("treats every no-verdict bucket as not assessed", () => {
    // An untested site, and an EPS sample that never went to a lab, are gaps
    // in monitoring — neither is a breach.
    expect(classifyVerdict("_no_info")).toBe(UNKNOWN);
    expect(classifyVerdict("not_applicable")).toBe(UNKNOWN);
    expect(classifyVerdict(null)).toBe(UNKNOWN);
  });
});

describe("row normalisers", () => {
  it("takes one date per site", () => {
    expect(latestByParent([{ group: 7, value: "2026-01-01" }])).toEqual({
      7: "2026-01-01",
    });
  });

  it("reads the verdict off the formula endpoint's label", () => {
    expect(
      verdictsByParent([{ group: 7, label: "compliant", value: 1 }])
    ).toEqual({ 7: "compliant" });
  });
});

describe("buildModePoints", () => {
  const families = [
    { key: "rws", label: "RWS" },
    { key: "wwtp", label: "WWTP" },
  ];
  const pointsByFamily = {
    rws: [{ id: 1, name: "Spring" }],
    wwtp: [{ id: 9, name: "Plant" }],
  };
  const mode = {
    type: "option",
    sources: [
      {
        key: "rws",
        question_name: "infrastructure_status",
        functional_values: ["operational"],
      },
    ],
  };

  it("classifies a family the mode covers", () => {
    const points = buildModePoints(families, pointsByFamily, mode, {
      rws: { 1: ["operational"] },
    });
    expect(points.find((p) => p.id === 1).__status).toBe("functional");
  });

  it("keeps a family the mode says nothing about, unclassified", () => {
    // Dropping it would make "we do not ask this here" look like "there is
    // nothing here".
    const points = buildModePoints(families, pointsByFamily, mode, {});
    const wwtp = points.find((p) => p.id === 9);
    expect(wwtp).toBeTruthy();
    expect(wwtp.__status).toBe(UNKNOWN);
    expect(wwtp.__asset).toBe("WWTP");
  });

  it("survives answers left over from another mode", () => {
    // Switching mode re-renders before the new fetch lands. The previous
    // mode's answers are not merely stale — a recency mode's are bare date
    // strings, and an option classifier reading one used to throw and blank
    // the page. The map now discards them, but nothing here may crash on a
    // shape it did not expect either.
    expect(() =>
      buildModePoints(families, pointsByFamily, mode, {
        rws: { 1: "2026-07-01T00:00:00Z" },
      })
    ).not.toThrow();
    const points = buildModePoints(families, pointsByFamily, mode, {
      rws: { 1: "2026-07-01T00:00:00Z" },
    });
    // A date is not one of the committee question's passing values, so the
    // honest answer is "not functional" — but it is a colour, not a crash.
    expect(points.find((p) => p.id === 1).__status).toBe("non_functional");
  });

  it("reads a single-option answer returned as a bare value", () => {
    const points = buildModePoints(families, pointsByFamily, mode, {
      rws: { 1: "operational" },
    });
    expect(points.find((p) => p.id === 1).__status).toBe("functional");
  });

  it("bands a recency mode by date", () => {
    const points = buildModePoints(
      families,
      pointsByFamily,
      {
        type: "recency",
        bands: BANDS,
        sources: [{ key: "rws", question_name: "inspection_date" }],
      },
      { rws: { 1: "2025-11-01" } },
      TODAY
    );
    expect(points.find((p) => p.id === 1).__status).toBe("watch");
  });
});
