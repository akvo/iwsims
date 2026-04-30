import {
  OVERLAP_THRESHOLD,
  OVERLAP_OFFSET_DISTANCE,
  applySpiralOffset,
  buildOffsetCoordinates,
} from "../overlapUtils";

// ─── applySpiralOffset ────────────────────────────────────────────────────────

describe("applySpiralOffset", () => {
  test("returns original coordinates unchanged when offsetIndex is 0", () => {
    const coords = [1.234, 5.678];
    expect(applySpiralOffset(coords, 0)).toEqual(coords);
  });

  test("returns original coordinates unchanged when offsetIndex is negative", () => {
    const coords = [1.234, 5.678];
    expect(applySpiralOffset(coords, -1)).toEqual(coords);
  });

  test("first offset (index 1) displaces by OVERLAP_OFFSET_DISTANCE at 60°", () => {
    const coords = [0, 0];
    const [lat, lng] = applySpiralOffset(coords, 1);
    const angle = 1 * 60 * (Math.PI / 180);
    const radius = OVERLAP_OFFSET_DISTANCE * Math.ceil(1 / 6); // = 1
    expect(lat).toBeCloseTo(radius * Math.cos(angle), 10);
    expect(lng).toBeCloseTo(radius * Math.sin(angle), 10);
  });

  test("radius doubles on the 7th offset (second ring)", () => {
    const coords = [0, 0];
    const [lat6] = applySpiralOffset(coords, 6);
    const [lat7] = applySpiralOffset(coords, 7);
    const angle6 = 6 * 60 * (Math.PI / 180);
    const angle7 = 7 * 60 * (Math.PI / 180);
    const r1 = OVERLAP_OFFSET_DISTANCE * 1;
    const r2 = OVERLAP_OFFSET_DISTANCE * 2;
    expect(lat6).toBeCloseTo(r1 * Math.cos(angle6), 10);
    expect(lat7).toBeCloseTo(r2 * Math.cos(angle7), 10);
  });

  test("is deterministic — same inputs always yield same output", () => {
    const coords = [51.5074, -0.1278];
    const a = applySpiralOffset(coords, 3);
    const b = applySpiralOffset(coords, 3);
    expect(a).toEqual(b);
  });

  test("does not mutate the input coordinates array", () => {
    const coords = [10, 20];
    const original = [...coords];
    applySpiralOffset(coords, 2);
    expect(coords).toEqual(original);
  });
});

// ─── buildOffsetCoordinates ───────────────────────────────────────────────────

const pt = (id, lat, lng) => ({ id, name: `p${id}`, geo: [lat, lng] });

describe("buildOffsetCoordinates", () => {
  test("returns an empty array for an empty dataset", () => {
    expect(buildOffsetCoordinates([])).toEqual([]);
  });

  test("returns the original geo for a single marker (no overlap)", () => {
    const dataset = [pt(1, 10, 20)];
    const offsets = buildOffsetCoordinates(dataset);
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toEqual([10, 20]);
  });

  test("first of two identical coordinates keeps its position", () => {
    const dataset = [pt(1, 0, 0), pt(2, 0, 0)];
    const [first] = buildOffsetCoordinates(dataset);
    expect(first).toEqual([0, 0]);
  });

  test("second of two identical coordinates is displaced", () => {
    const dataset = [pt(1, 0, 0), pt(2, 0, 0)];
    const [, second] = buildOffsetCoordinates(dataset);
    expect(second).not.toEqual([0, 0]);
  });

  test("N identical coordinates produce N distinct output positions", () => {
    const n = 6;
    const dataset = Array.from({ length: n }, (_, i) => pt(i, 5, 5));
    const offsets = buildOffsetCoordinates(dataset);
    const unique = new Set(offsets.map((c) => `${c[0]},${c[1]}`));
    expect(unique.size).toBe(n);
  });

  test("points within the same bucket cell are treated as overlapping", () => {
    // Bucket key = Math.round(coord / OVERLAP_THRESHOLD).
    // For base=0 the bucket is 0; any coord where Math.round(coord/0.0001) also
    // equals 0 falls in the same cell — i.e., coord in (-0.00005, +0.00005).
    // Using 0.4 * OVERLAP_THRESHOLD = 0.00004 → Math.round(0.4) = 0 ✓
    const base = 0;
    const nearby = base + OVERLAP_THRESHOLD * 0.4;
    const dataset = [pt(1, base, base), pt(2, nearby, nearby)];
    const [first, second] = buildOffsetCoordinates(dataset);
    // Both land in the same bucket ⇒ second should be displaced
    expect(second).not.toEqual(dataset[1].geo);
    expect(first).toEqual([base, base]);
  });

  test("points in different bucket cells are treated as non-overlapping", () => {
    // Using 1.5 * OVERLAP_THRESHOLD = 0.00015 → Math.round(1.5) = 2 (different cell)
    const base = 0;
    const far = base + OVERLAP_THRESHOLD * 1.5;
    const dataset = [pt(1, base, base), pt(2, far, far)];
    const [first, second] = buildOffsetCoordinates(dataset);
    expect(first).toEqual([base, base]);
    expect(second).toEqual([far, far]);
  });

  test("is deterministic — same dataset always yields same offsets", () => {
    const dataset = [pt(1, 1, 1), pt(2, 1, 1), pt(3, 2, 3)];
    const a = buildOffsetCoordinates(dataset);
    const b = buildOffsetCoordinates(dataset);
    expect(a).toEqual(b);
  });

  test("output length always matches input length", () => {
    const dataset = [pt(1, 0, 0), pt(2, 0, 0), pt(3, 1, 1)];
    expect(buildOffsetCoordinates(dataset)).toHaveLength(dataset.length);
  });

  test("non-overlapping markers are not displaced", () => {
    const dataset = [pt(1, 0, 0), pt(2, 10, 10), pt(3, 20, 20)];
    const offsets = buildOffsetCoordinates(dataset);
    expect(offsets[0]).toEqual([0, 0]);
    expect(offsets[1]).toEqual([10, 10]);
    expect(offsets[2]).toEqual([20, 20]);
  });

  test("does not mutate the input dataset", () => {
    const dataset = [pt(1, 0, 0), pt(2, 0, 0)];
    const before = JSON.stringify(dataset);
    buildOffsetCoordinates(dataset);
    expect(JSON.stringify(dataset)).toBe(before);
  });
});
