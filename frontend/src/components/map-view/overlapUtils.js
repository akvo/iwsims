// Distance threshold for considering markers overlapping (~11 meters)
export const OVERLAP_THRESHOLD = 0.0001;
// Spiral offset distance (~22 meters)
export const OVERLAP_OFFSET_DISTANCE = 0.0002;

export const applySpiralOffset = (coordinates, offsetIndex) => {
  if (offsetIndex <= 0) {
    return coordinates;
  }
  const angle = offsetIndex * 60 * (Math.PI / 180);
  const radius = OVERLAP_OFFSET_DISTANCE * Math.ceil(offsetIndex / 6);
  return [
    coordinates[0] + radius * Math.cos(angle),
    coordinates[1] + radius * Math.sin(angle),
  ];
};

// O(N) overlap detection via spatial hash bucket — replaces an O(N^2) scan
export const buildOffsetCoordinates = (filteredDataset) => {
  const buckets = {};
  return filteredDataset.map((d) => {
    const key = `${Math.round(d.geo[0] / OVERLAP_THRESHOLD)}_${Math.round(
      d.geo[1] / OVERLAP_THRESHOLD
    )}`;
    const offsetIndex = buckets[key] || 0;
    buckets[key] = offsetIndex + 1;
    return applySpiralOffset(d.geo, offsetIndex);
  });
};
