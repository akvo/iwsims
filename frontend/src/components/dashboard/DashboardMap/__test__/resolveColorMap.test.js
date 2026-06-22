import resolveColorMap, { DEFAULT_NO_INFO_COLOR } from "../resolveColorMap";

const REGISTRATION_FORM_ID = 1000;

const makeForm = (id, parent, questions) => ({
  id,
  content: {
    parent,
    question_group: [{ question: questions }],
  },
});

describe("resolveColorMap", () => {
  const originalForms = window.forms;

  beforeEach(() => {
    window.forms = [
      makeForm(1001, REGISTRATION_FORM_ID, [
        {
          name: "disinfection_technique",
          option: [
            { value: "chlorine_gas", label: "Chlorine gas", color: "#1b9e77" },
            { value: "hth_powder", label: "HTH Powder", color: "#d95f02" },
            { value: "no_color", label: "No colour" },
          ],
        },
      ]),
    ];
  });

  afterEach(() => {
    window.forms = originalForms;
  });

  it("defaults colours from the question options", () => {
    const filter = {
      question_name: "disinfection_technique",
    };
    const map = resolveColorMap(filter, REGISTRATION_FORM_ID);
    expect(map.chlorine_gas).toBe("#1b9e77");
    expect(map.hth_powder).toBe("#d95f02");
  });

  it("lets the config color_map override per value", () => {
    const filter = {
      question_name: "disinfection_technique",
      color_map: { chlorine_gas: "#000000", _no_info: "#cccccc" },
    };
    const map = resolveColorMap(filter, REGISTRATION_FORM_ID);
    // overridden
    expect(map.chlorine_gas).toBe("#000000");
    // still derived from the option
    expect(map.hth_powder).toBe("#d95f02");
    // config _no_info preserved
    expect(map._no_info).toBe("#cccccc");
  });

  it("always provides a _no_info colour, defaulting to grey", () => {
    const filter = { question_name: "disinfection_technique" };
    const map = resolveColorMap(filter, REGISTRATION_FORM_ID);
    expect(map._no_info).toBe(DEFAULT_NO_INFO_COLOR);
  });

  it("omits options that have no colour", () => {
    const filter = { question_name: "disinfection_technique" };
    const map = resolveColorMap(filter, REGISTRATION_FORM_ID);
    expect(map.no_color).toBeUndefined();
  });

  it("uses only the config color_map for formula filters", () => {
    const filter = {
      formula: { buckets: [], default: { value: "x", label: "X" } },
      color_map: { compliant: "#64A73B" },
    };
    const map = resolveColorMap(filter, REGISTRATION_FORM_ID);
    expect(map.compliant).toBe("#64A73B");
    expect(map._no_info).toBe(DEFAULT_NO_INFO_COLOR);
  });

  it("returns {} for a null filter", () => {
    expect(resolveColorMap(null, REGISTRATION_FORM_ID)).toEqual({});
  });
});
