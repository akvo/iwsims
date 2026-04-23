import {
  findQuestion,
  findAnswer,
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
