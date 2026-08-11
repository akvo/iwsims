import { buildSeries } from "../IndividualPlantOverview";
import * as wwtp from "../config/wwtp";
import * as wtp from "../config/wtp";

const row = (date, qid, value) => ({
  date,
  values: [{ question: qid, value }],
});

describe("buildSeries", () => {
  it("maps history rows to label/value points", () => {
    const history = [row("2026-01", 1, 12), row("2026-02", 1, 8)];
    expect(buildSeries(history, 1)).toEqual([
      { label: "2026-01", value: 12 },
      { label: "2026-02", value: 8 },
    ]);
  });

  it("drops empty strings rather than charting them as zero", () => {
    // Number("") and Number("   ") are both 0 — charting those would invent
    // datapoints at zero for a parameter that was simply not measured.
    const history = [row("a", 1, ""), row("b", 1, "   "), row("c", 1, 5)];
    expect(buildSeries(history, 1)).toEqual([{ label: "c", value: 5 }]);
  });

  it("keeps a genuine zero", () => {
    expect(buildSeries([row("a", 1, 0)], 1)).toEqual([
      { label: "a", value: 0 },
    ]);
  });

  it("drops null, missing and non-numeric answers", () => {
    const history = [
      row("a", 1, null),
      row("b", 2, 9), // different question
      row("c", 1, "abc"),
    ];
    expect(buildSeries(history, 1)).toEqual([]);
  });

  it("tolerates a missing or non-array history", () => {
    expect(buildSeries(null, 1)).toEqual([]);
    expect(buildSeries([], 1)).toEqual([]);
  });
});

describe("plant overview configs", () => {
  it.each([
    ["wwtp", wwtp],
    ["wtp", wtp],
  ])("%s declares everything the renderer requires", (_name, config) => {
    expect(typeof config.REGISTRATION_FORM_ID).toBe("number");
    expect(typeof config.MONITORING_FORM_ID).toBe("number");
    expect(typeof config.DATE_QID).toBe("number");
    expect(config.ENTITY_LABEL).toBeTruthy();
    expect(config.REGISTRATION_CHARACTERISTICS_QIDS.length).toBeGreaterThan(0);
    expect(config.MONITORING_DETAIL_QIDS.length).toBeGreaterThan(0);
    expect(config.PARAM_GROUPS.length).toBeGreaterThan(0);
  });

  it.each([
    ["wwtp", wwtp],
    ["wtp", wtp],
  ])(
    "%s gives every charted parameter a numeric qid and title",
    (_n, config) => {
      const params = config.PARAM_GROUPS.flatMap((g) => g.params);
      params.forEach((param) => {
        expect(typeof param.qid).toBe("number");
        expect(param.title).toBeTruthy();
      });
      // Keys must be unique — they are React list keys within a group.
      const keys = params.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  );

  it("only puts a threshold on the three mandatory WWTP effluent params", () => {
    // TSS, ammonia, nitrate and total phosphorus have no agreed DWS threshold
    // (issue #34), so they must chart without a reference band rather than
    // against an invented limit.
    const withThreshold = wwtp.PARAM_GROUPS.flatMap((g) => g.params)
      .filter(
        (p) =>
          typeof p.thresholdMax === "number" ||
          typeof p.thresholdMin === "number"
      )
      .map((p) => p.key);
    expect(withThreshold.sort()).toEqual(["bod", "cod", "ph", "tds"]);
  });
});
