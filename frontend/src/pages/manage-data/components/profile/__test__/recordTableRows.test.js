import { resolveRowQuestion } from "../widgets/RecordTable";

/**
 * EPS and RWS collect the same water-quality parameters under different
 * question names depending on which monitoring form was used, so their
 * "Latest Water Test" rows list aliases instead of a single question.
 */
describe("resolveRowQuestion", () => {
  it("uses an explicit single question as-is", () => {
    expect(resolveRowQuestion({ question: "turbidity_ntu" }, {})).toBe(
      "turbidity_ntu"
    );
  });

  it("prefers an explicit question over any aliases", () => {
    const row = { question: "ph", questions: ["lab_ph"] };
    expect(resolveRowQuestion(row, { lab_ph: { value: 7 } })).toBe("ph");
  });

  it("picks the alias this datapoint actually answered", () => {
    const row = { questions: ["e_coli_level", "e_coli_lab_count"] };
    expect(resolveRowQuestion(row, { e_coli_lab_count: { value: 0 } })).toBe(
      "e_coli_lab_count"
    );
  });

  it("keeps the first alias when the datapoint answered both", () => {
    const row = { questions: ["lab_ecoli", "lab_ecoli_count"] };
    const latest = { lab_ecoli: { value: 1 }, lab_ecoli_count: { value: 2 } };
    expect(resolveRowQuestion(row, latest)).toBe("lab_ecoli");
  });

  it("falls back to the first alias so the row still renders as no-data", () => {
    const row = { questions: ["cbt_ecoli", "cbt_ecoli_count"] };
    expect(resolveRowQuestion(row, {})).toBe("cbt_ecoli");
  });

  it("returns null when a row names no question at all", () => {
    expect(resolveRowQuestion({}, {})).toBeNull();
    expect(resolveRowQuestion()).toBeNull();
  });
});
