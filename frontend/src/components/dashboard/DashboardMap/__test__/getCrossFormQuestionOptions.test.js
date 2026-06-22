import getCrossFormQuestionOptions from "../getCrossFormQuestionOptions";

const REGISTRATION_FORM_ID = 1000;

const makeForm = (id, parent, questions) => ({
  id,
  content: {
    parent,
    question_group: [{ question: questions }],
  },
});

describe("getCrossFormQuestionOptions", () => {
  const originalForms = window.forms;

  beforeEach(() => {
    window.forms = [
      // Registration form: carries a registration-only question.
      makeForm(REGISTRATION_FORM_ID, null, [
        {
          name: "water_committee",
          option: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
        },
      ]),
      // Two monitoring forms of the same family sharing a question.
      makeForm(1001, REGISTRATION_FORM_ID, [
        {
          name: "disinfection_technique",
          option: [
            { value: "chlorine_gas", label: "Chlorine gas" },
            { value: "hth_powder", label: "HTH Powder" },
          ],
        },
      ]),
      makeForm(1002, REGISTRATION_FORM_ID, [
        {
          name: "disinfection_technique",
          option: [
            // chlorine_gas repeats — must be de-duplicated.
            { value: "chlorine_gas", label: "Chlorine gas" },
            { value: "dpd_tablets", label: "DPD Tablets" },
          ],
        },
      ]),
      // An unrelated family that must never leak in.
      makeForm(2001, 2000, [
        {
          name: "disinfection_technique",
          option: [{ value: "other_family", label: "Nope" }],
        },
      ]),
    ];
  });

  afterEach(() => {
    window.forms = originalForms;
  });

  it("unions options for a question across all monitoring forms", () => {
    const opts = getCrossFormQuestionOptions(
      REGISTRATION_FORM_ID,
      "disinfection_technique"
    );
    expect(opts.map((o) => o.value)).toEqual([
      "chlorine_gas",
      "hth_powder",
      "dpd_tablets",
    ]);
  });

  it("de-duplicates by value, keeping the first label", () => {
    const opts = getCrossFormQuestionOptions(
      REGISTRATION_FORM_ID,
      "disinfection_technique"
    );
    const chlorine = opts.filter((o) => o.value === "chlorine_gas");
    expect(chlorine).toHaveLength(1);
    expect(chlorine[0].label).toBe("Chlorine gas");
  });

  it("carries each option's color through", () => {
    window.forms[1].content.question_group[0].question[0].option[0].color =
      "#1b9e77";
    const opts = getCrossFormQuestionOptions(
      REGISTRATION_FORM_ID,
      "disinfection_technique"
    );
    expect(opts.find((o) => o.value === "chlorine_gas").color).toBe("#1b9e77");
  });

  it("resolves a registration-only question from the registration form", () => {
    const opts = getCrossFormQuestionOptions(
      REGISTRATION_FORM_ID,
      "water_committee"
    );
    expect(opts.map((o) => o.value)).toEqual(["yes", "no"]);
  });

  it("does not leak options from another registration family", () => {
    const opts = getCrossFormQuestionOptions(
      REGISTRATION_FORM_ID,
      "disinfection_technique"
    );
    expect(opts.map((o) => o.value)).not.toContain("other_family");
  });

  it("accepts a string parentFormId (config values may be numeric ids)", () => {
    const opts = getCrossFormQuestionOptions(
      String(REGISTRATION_FORM_ID),
      "water_committee"
    );
    expect(opts.map((o) => o.value)).toEqual(["yes", "no"]);
  });

  it("returns [] when no family form carries the question", () => {
    expect(
      getCrossFormQuestionOptions(REGISTRATION_FORM_ID, "missing_question")
    ).toEqual([]);
  });
});
