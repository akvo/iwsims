import {
  collectRuleQuestionNames,
  conditionMatches,
  getRulesMatchCount,
} from "../rulesKpi";

const resp = (rows) => ({ data: rows });

// Pump "Critical issues" rule set.
const CRITICAL_RULES = [
  {
    all_of: [
      {
        question_name: "station_status",
        op: "option_in",
        values: ["not_operational", "overflowing", "blocked"],
      },
    ],
  },
  {
    all_of: [
      {
        question_name: "electrical_panel",
        op: "option_in",
        values: ["broken", "electrical_hazard"],
      },
      {
        question_name: "pump_station_lid",
        op: "option_equals",
        value: "missing",
      },
      {
        question_name: "non_return_valve",
        op: "option_equals",
        value: "faulty",
      },
      { question_name: "sluice_valve", op: "option_equals", value: "faulty" },
      {
        question_name: "guardrails_pump_station",
        op: "option_equals",
        value: "missing",
      },
      {
        question_name: "ohs_equipment",
        op: "option_equals",
        value: "not_available",
      },
    ],
  },
];

describe("rulesKpi — collectRuleQuestionNames", () => {
  it("returns the distinct question_names referenced", () => {
    expect(collectRuleQuestionNames(CRITICAL_RULES).sort()).toEqual(
      [
        "electrical_panel",
        "guardrails_pump_station",
        "non_return_valve",
        "ohs_equipment",
        "pump_station_lid",
        "sluice_valve",
        "station_status",
      ].sort()
    );
  });
});

describe("rulesKpi — conditionMatches", () => {
  it("option_in passes when the array intersects values", () => {
    expect(
      conditionMatches({ op: "option_in", values: ["a", "b"] }, ["b"])
    ).toBe(true);
    expect(conditionMatches({ op: "option_in", values: ["a"] }, ["x"])).toBe(
      false
    );
  });
  it("option_equals matches the contained value; missing fails", () => {
    expect(
      conditionMatches({ op: "option_equals", value: "missing" }, ["missing"])
    ).toBe(true);
    expect(
      conditionMatches({ op: "option_equals", value: "missing" }, ["covered"])
    ).toBe(false);
    expect(conditionMatches({ op: "option_equals", value: "missing" })).toBe(
      false
    );
  });
  it("numeric ops compare against the value", () => {
    expect(conditionMatches({ op: "gt", value: 0 }, 1)).toBe(true);
    expect(conditionMatches({ op: "lte", value: 0 }, 0)).toBe(true);
    expect(conditionMatches({ op: "between", min: 1, max: 3 }, 2)).toBe(true);
  });
});

describe("rulesKpi — getRulesMatchCount (critical)", () => {
  it("counts a station matching group 1 (status in set)", () => {
    const count = getRulesMatchCount(CRITICAL_RULES, {
      station_status: resp([
        { group: "1", value: ["overflowing"] }, // critical via group 1
        { group: "2", value: ["operational"] }, // not via group 1
      ]),
    });
    expect(count).toBe(1);
  });

  it("counts a station matching the full group 2 AND chain", () => {
    const base = {
      station_status: resp([{ group: "9", value: ["operational"] }]),
      electrical_panel: resp([{ group: "9", value: ["broken"] }]),
      pump_station_lid: resp([{ group: "9", value: ["missing"] }]),
      non_return_valve: resp([{ group: "9", value: ["faulty"] }]),
      sluice_valve: resp([{ group: "9", value: ["faulty"] }]),
      guardrails_pump_station: resp([{ group: "9", value: ["missing"] }]),
      ohs_equipment: resp([{ group: "9", value: ["not_available"] }]),
    };
    expect(getRulesMatchCount(CRITICAL_RULES, base)).toBe(1);

    // Break one AND condition → group 2 no longer matches, and status is ok.
    base.sluice_valve = resp([{ group: "9", value: ["operational"] }]);
    expect(getRulesMatchCount(CRITICAL_RULES, base)).toBe(0);
  });

  it("does not count stations with no monitoring data", () => {
    expect(getRulesMatchCount(CRITICAL_RULES, {})).toBe(0);
  });
});

describe("rulesKpi — getRulesMatchCount (operational ratio numerator)", () => {
  const OPERATIONAL_RULES = [
    {
      all_of: [
        {
          question_name: "station_status",
          op: "option_equals",
          value: "operational",
        },
      ],
    },
    {
      all_of: [
        {
          question_name: "electrical_panel",
          op: "option_equals",
          value: "satisfactory",
        },
        {
          question_name: "pump_station_lid",
          op: "option_equals",
          value: "covered",
        },
        {
          question_name: "non_return_valve",
          op: "option_equals",
          value: "operational",
        },
        {
          question_name: "sluice_valve",
          op: "option_equals",
          value: "operational",
        },
        {
          question_name: "guardrails_pump_station",
          op: "option_equals",
          value: "secured",
        },
      ],
    },
  ];

  it("counts operational stations via either path", () => {
    const count = getRulesMatchCount(OPERATIONAL_RULES, {
      station_status: resp([
        { group: "1", value: ["operational"] }, // group 1
        { group: "2", value: ["blocked"] }, // not group 1
        { group: "3", value: ["blocked"] }, // group 2 candidate
      ]),
      electrical_panel: resp([{ group: "3", value: ["satisfactory"] }]),
      pump_station_lid: resp([{ group: "3", value: ["covered"] }]),
      non_return_valve: resp([{ group: "3", value: ["operational"] }]),
      sluice_valve: resp([{ group: "3", value: ["operational"] }]),
      guardrails_pump_station: resp([{ group: "3", value: ["secured"] }]),
    });
    expect(count).toBe(2); // stations 1 and 3
  });
});
