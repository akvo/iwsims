import {
  collectGroupAnswers,
  findAnswer,
  findQuestion,
  findQuestionGroup,
  formatAnswerValue,
  extractPhotoUrl,
  resolveAnswerLabel,
  sortByDateAscending,
} from "../helpers";

const originalForms = window.forms;

const FORMS_FIXTURE = [
  {
    id: 1,
    content: {
      question_group: [
        {
          id: 1001,
          name: "basic_group",
          question: [
            { id: 101, label: "Free text", type: "input" },
            {
              id: 102,
              label: "Choice",
              type: "option",
              option: [
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ],
            },
            {
              id: 103,
              label: "Multi",
              type: "multiple_option",
              option: [
                { value: "a", label: "Apple" },
                { value: "b", label: "Banana" },
              ],
            },
            { id: 104, label: "Coords", type: "geo" },
            { id: 105, label: "Photo", type: "photo" },
          ],
        },
        {
          id: 2001,
          name: "scope_group",
          question: [
            {
              id: 201,
              label: "Current status",
              type: "option",
              option: [
                { value: "ongoing", label: "Ongoing" },
                { value: "completed", label: "Completed" },
              ],
            },
            { id: 202, label: "Tank size", type: "input" },
            { id: 203, label: "Scope photo", type: "photo" },
            { id: 204, label: "Scope notes", type: "input" },
          ],
        },
      ],
    },
  },
];

beforeEach(() => {
  window.forms = FORMS_FIXTURE;
});

afterAll(() => {
  window.forms = originalForms;
});

describe("findQuestion", () => {
  test("returns the matching question across forms", () => {
    expect(findQuestion(101)).toMatchObject({ id: 101, label: "Free text" });
  });

  test("accepts string ids", () => {
    expect(findQuestion("101")).toMatchObject({ id: 101 });
  });

  test("returns null when not found", () => {
    expect(findQuestion(999)).toBeNull();
  });

  test("returns null when window.forms is empty", () => {
    window.forms = [];
    expect(findQuestion(101)).toBeNull();
  });

  test("returns null when window.forms is missing", () => {
    delete window.forms;
    expect(findQuestion(101)).toBeNull();
  });
});

describe("findAnswer", () => {
  test("finds the answer entry by question id", () => {
    const values = [{ question: 101, value: "hello" }];
    expect(findAnswer(values, 101)).toEqual({ question: 101, value: "hello" });
  });

  test("returns null for missing values", () => {
    expect(findAnswer(null, 101)).toBeNull();
  });

  test("returns null when not found", () => {
    expect(findAnswer([{ question: 999, value: "x" }], 101)).toBeNull();
  });
});

describe("formatAnswerValue", () => {
  test("returns null for empty answer", () => {
    expect(formatAnswerValue(null, null)).toBeNull();
  });

  test("returns null for empty value", () => {
    expect(formatAnswerValue({ value: "" }, { type: "input" })).toBeNull();
  });

  test("formats option using question.option labels", () => {
    expect(formatAnswerValue({ value: "yes" }, findQuestion(102))).toBe("Yes");
  });

  test("formats multiple_option as comma-joined labels", () => {
    expect(formatAnswerValue({ value: ["a", "b"] }, findQuestion(103))).toBe(
      "Apple, Banana"
    );
  });

  test("formats geo as 'lat, lng'", () => {
    expect(
      formatAnswerValue({ value: [-17.7, 178.0] }, findQuestion(104))
    ).toBe("-17.7, 178");
  });

  test("joins arrays for non-option types", () => {
    expect(formatAnswerValue({ value: ["a", "b"] }, { type: "input" })).toBe(
      "a, b"
    );
  });

  test("falls back to String() for primitives", () => {
    expect(formatAnswerValue({ value: 42 }, { type: "number" })).toBe("42");
  });
});

describe("extractPhotoUrl", () => {
  test("returns the URL when value is a non-empty string", () => {
    const values = [{ question: 105, value: "https://example.com/p.jpg" }];
    expect(extractPhotoUrl(values, 105)).toBe("https://example.com/p.jpg");
  });

  test("returns null for empty string value", () => {
    expect(extractPhotoUrl([{ question: 105, value: "  " }], 105)).toBeNull();
  });

  test("returns null when value is not a string", () => {
    expect(extractPhotoUrl([{ question: 105, value: 42 }], 105)).toBeNull();
  });

  test("returns null when answer missing", () => {
    expect(extractPhotoUrl([], 105)).toBeNull();
  });
});

describe("resolveAnswerLabel", () => {
  test("composes findAnswer + findQuestion + formatAnswerValue", () => {
    expect(resolveAnswerLabel([{ question: 102, value: "no" }], 102)).toBe(
      "No"
    );
  });

  test("returns null when no answer", () => {
    expect(resolveAnswerLabel([], 101)).toBeNull();
  });
});

describe("findQuestionGroup", () => {
  test("returns the matching group by id", () => {
    expect(findQuestionGroup(2001)).toMatchObject({
      id: 2001,
      name: "scope_group",
    });
  });

  test("accepts string ids", () => {
    expect(findQuestionGroup("2001")).toMatchObject({ id: 2001 });
  });

  test("returns null when not found", () => {
    expect(findQuestionGroup(9999)).toBeNull();
  });

  test("returns null for null/undefined id", () => {
    expect(findQuestionGroup(null)).toBeNull();
  });

  test("returns null when window.forms is missing", () => {
    delete window.forms;
    expect(findQuestionGroup(2001)).toBeNull();
  });
});

describe("collectGroupAnswers", () => {
  test("joins formatted non-photo answers from the group", () => {
    const values = [
      { question: 201, value: "ongoing" }, // option -> "Ongoing"
      { question: 202, value: "2700L" }, // input
      { question: 203, value: "http://x/y.jpg" }, // photo -> SKIPPED
      { question: 204, value: "notes here" }, // input
    ];
    expect(collectGroupAnswers(2001, values)).toBe(
      "Ongoing, 2700L, notes here"
    );
  });

  test("skips answers that resolve to null/empty", () => {
    const values = [
      { question: 201, value: "completed" },
      { question: 202, value: "" },
      { question: 204, value: null },
    ];
    expect(collectGroupAnswers(2001, values)).toBe("Completed");
  });

  test("returns empty string when group is not found", () => {
    expect(collectGroupAnswers(9999, [])).toBe("");
  });

  test("returns empty string when values is empty", () => {
    expect(collectGroupAnswers(2001, [])).toBe("");
  });

  test("honours custom separator", () => {
    const values = [
      { question: 201, value: "ongoing" },
      { question: 202, value: "2700L" },
    ];
    expect(collectGroupAnswers(2001, values, { separator: " | " })).toBe(
      "Ongoing | 2700L"
    );
  });
});

describe("sortByDateAscending", () => {
  test("sorts ascending by date", () => {
    const rows = [
      { date: "2026-02-01", v: 2 },
      { date: "2026-01-01", v: 1 },
      { date: "2026-03-01", v: 3 },
    ];
    expect(sortByDateAscending(rows).map((r) => r.v)).toEqual([1, 2, 3]);
  });

  test("entries with null dates sort first, stable order", () => {
    const rows = [
      { date: null, v: "a" },
      { date: "2026-01-01", v: "b" },
      { date: null, v: "c" },
    ];
    expect(sortByDateAscending(rows).map((r) => r.v)).toEqual(["a", "c", "b"]);
  });

  test("returns [] for non-array input", () => {
    expect(sortByDateAscending(null)).toEqual([]);
  });
});
