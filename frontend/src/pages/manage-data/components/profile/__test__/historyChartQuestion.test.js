import { resolveHistoryQuestion } from "../widgets/HistoryChart";

const hist = (rows) =>
  rows.map((value, i) => ({ date: `2026-0${i + 1}`, value }));

describe("resolveHistoryQuestion", () => {
  it("uses an explicit single question as-is", () => {
    expect(resolveHistoryQuestion({ question: "ph" }, {})).toBe("ph");
  });

  it("prefers an explicit question over any aliases", () => {
    const item = { question: "ph", questions: ["lab_ph"] };
    expect(resolveHistoryQuestion(item, { lab_ph: hist([7]) })).toBe("ph");
  });

  it("picks the alias that has history for this datapoint", () => {
    const item = { questions: ["e_coli_level", "e_coli_lab_count"] };
    const history = { e_coli_lab_count: hist([0, 1]) };
    expect(resolveHistoryQuestion(item, history)).toBe("e_coli_lab_count");
  });

  it("ignores an alias present but empty", () => {
    const item = { questions: ["lab_ecoli", "lab_ecoli_count"] };
    const history = { lab_ecoli: [], lab_ecoli_count: hist([2]) };
    expect(resolveHistoryQuestion(item, history)).toBe("lab_ecoli_count");
  });

  it("keeps the first alias when both have history", () => {
    const item = { questions: ["lab_ecoli", "lab_ecoli_count"] };
    const history = { lab_ecoli: hist([1]), lab_ecoli_count: hist([2]) };
    expect(resolveHistoryQuestion(item, history)).toBe("lab_ecoli");
  });

  it("falls back to the first alias so the chart renders its empty state", () => {
    const item = { questions: ["cbt_ecoli", "cbt_ecoli_count"] };
    expect(resolveHistoryQuestion(item, {})).toBe("cbt_ecoli");
  });

  it("returns null when nothing is named", () => {
    expect(resolveHistoryQuestion({}, {})).toBeNull();
    expect(resolveHistoryQuestion()).toBeNull();
  });
});
