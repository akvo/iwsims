/**
 * RWS Individual Overview — per-dashboard constants.
 *
 * Sources:
 *   backend/source/forms/3_1749621221728.prod.json   (registration)
 *   backend/source/forms/3_1749621962296.monitoring.prod.json   (comprehensive monitoring)
 *   backend/source/forms/3_1749631041125.monitoring.prod.json   (quick monitoring — fallback for 5 fields)
 *
 * Most monitoring values resolve against the comprehensive form. The 5
 * QUICK_FORM_QIDS resolve against the quick form because the comprehensive
 * form does not provide them (per design.md & implementation-plan.md).
 */

export const REGISTRATION_FORM_ID = 1749621221728;
export const COMPREHENSIVE_FORM_ID = 1749621962296;
export const QUICK_FORM_ID = 1749631041125;

/**
 * Explicit set of qids whose values should be read from the quick form
 * (1749631041125) rather than the comprehensive form. Used by the RWS
 * shell's `valuesFor(qid)` helper to route lookups correctly.
 */
export const QUICK_FORM_QIDS = {
  operationalStatus: 1749631041155,
  contactPersons: 1749631041128,
  phoneContact: 1749631041129,
  trainingConducted: 1749631041131,
  photoDescription: 1749631041153,
};

export const REGISTRATION_CHARACTERISTICS_QIDS = [
  1749621221730, // Division / Province / Tikina
  1749621329696, // Village name
  1749622715678, // Water Committee
  1749622701234, // Construction Start Date
  1749622571775, // Implementing Agency
  1749621347162, // Project Background
  1749622327890, // Number of households
  1749622341234, // Total population
  1749622354567, // Project costs
  1749622652941, // WSMP submitted
  1749622675800, // WSMP approved
];

export const STATS_CARD_QIDS = {
  households: 1749622327890,
  population: 1749622341234,
  projectCost: 1749622354567,
};

export const WATER_SOURCE_QID = 1749621374500;
export const PROJECT_TYPE_QID = 1749621851234;
export const WSMP_APPROVED_QID = 1749622675800;

export const INSPECTION_DATE_QID = 1749621962298;
export const PROPOSED_COMPLETION_QID = 1749622695675;
export const WEATHER_CONDITION_QID = 1749622774567;
export const SAMPLE_TAKEN_QID = 1749622785185;
export const PARAMETERS_TESTED_QID = 1749621050010;

export const CONSTRUCTION_PHOTO_QID = 1849622785200; // sampling-point photo (used as Photo from Last Monitoring)

export const WQ_DATE_QID = INSPECTION_DATE_QID;
export const WQ_PHOTO_QID = 1849622785200;
export const WQ_PHOTO_CAPTION_QID = QUICK_FORM_QIDS.photoDescription;
export const WQ_STATUS_QID = QUICK_FORM_QIDS.operationalStatus;
export const WQ_TEST_METHOD_QID = 1749622849604;

export const WATER_QUALITY_DETAIL_QIDS = [
  WQ_DATE_QID,
  QUICK_FORM_QIDS.contactPersons,
  QUICK_FORM_QIDS.phoneContact,
  QUICK_FORM_QIDS.trainingConducted,
  WEATHER_CONDITION_QID,
  SAMPLE_TAKEN_QID,
  WQ_TEST_METHOD_QID,
  PARAMETERS_TESTED_QID,
  WSMP_APPROVED_QID,
  WATER_SOURCE_QID,
  PROJECT_TYPE_QID,
];

/**
 * Project-type-aware project-scope rows for the Construction Information
 * table. Each entry: { key, label, status_qid }.
 *
 * Sourced from `progress_construction.components[]` in
 * frontend/src/config/visualizations/1749621221728.json — the canonical
 * per-component qid registry. The implementation/issues/photo qid columns
 * in the design are not yet present in the form; rendered cells fall back
 * to "—" until those qids are added in a follow-up.
 */
const surfaceWaterRows = [
  { key: "dam", label: "Dam", status_qid: 1723459210015 },
  { key: "raw_water_main", label: "Raw water main", status_qid: 1723459310020 },
  { key: "reservoir", label: "Reservoir", status_qid: 1723459310033 },
  {
    key: "distribution_main",
    label: "Distribution main",
    status_qid: 1723459310036,
  },
  { key: "reticulation", label: "Reticulation", status_qid: 1723459310040 },
  { key: "pump", label: "Pump", status_qid: 1749622191234 },
];

const boreholeRows = [
  { key: "borehole", label: "Borehole", status_qid: 1749622111239 },
  { key: "raw_water_main", label: "Raw water main", status_qid: 1723459310020 },
  { key: "reservoir", label: "Reservoir", status_qid: 1723459310033 },
  {
    key: "distribution_main",
    label: "Distribution main",
    status_qid: 1723459310036,
  },
  { key: "reticulation", label: "Reticulation", status_qid: 1723459310040 },
  { key: "pump", label: "Pump", status_qid: 1749622191234 },
  { key: "tanks", label: "Tanks", status_qid: 1749622266234 },
];

const desalinationRows = [
  {
    key: "desalination_unit",
    label: "Desalination unit",
    status_qid: 1749622163234,
  },
  { key: "raw_water_main", label: "Raw water main", status_qid: 1723459310020 },
  { key: "reservoir", label: "Reservoir", status_qid: 1723459310033 },
  {
    key: "distribution_main",
    label: "Distribution main",
    status_qid: 1723459310036,
  },
  { key: "reticulation", label: "Reticulation", status_qid: 1723459310040 },
  { key: "pump", label: "Pump", status_qid: 1749622191234 },
  { key: "tanks", label: "Tanks", status_qid: 1749622266234 },
];

const rainwaterRows = [
  {
    key: "rainwater_tanks",
    label: "Rainwater tanks",
    status_qid: 1723459250020,
  },
  { key: "gutters", label: "Gutters", status_qid: 1749622229234 },
  {
    key: "base_construction",
    label: "Base construction",
    status_qid: 1749622301234,
  },
];

export const PROJECT_SCOPE_ROWS_BY_TYPE = new Map([
  ["surface_water_project", surfaceWaterRows],
  ["borehole", boreholeRows],
  ["desalination", desalinationRows],
  ["rainwater_harvesting", rainwaterRows],
]);

export const WQ_LAB_PARAMS = [
  // Microbial — threshold = 0 cfu/100mL
  {
    key: "ecoli",
    title: "E-coli",
    qid: 1749622991234,
    unit: "cfu/100mL",
    thresholdMax: 0,
    section: "microbial",
  },
  {
    key: "total_coliform",
    title: "Total Coliform",
    qid: 1749623024122,
    unit: "cfu/100mL",
    thresholdMax: 0,
    section: "microbial",
  },
  {
    key: "fecal_coliform",
    title: "Fecal Coliform",
    qid: 1749623074194,
    unit: "cfu/100mL",
    thresholdMax: 0,
    section: "microbial",
  },
  // Chemical
  {
    key: "ph",
    title: "pH",
    qid: 1723459200024,
    unit: "pH",
    thresholdMin: 6.5,
    thresholdMax: 8.5,
    section: "chemical",
  },
  {
    key: "conductivity",
    title: "Conductivity",
    qid: 1723459200025,
    unit: "µS/cm",
    thresholdMax: 1000,
    section: "chemical",
  },
  {
    key: "salinity",
    title: "Salinity",
    qid: 1723459200026,
    unit: "ppt",
    thresholdMax: 1,
    section: "chemical",
  },
  // Physical
  {
    key: "turbidity",
    title: "Turbidity",
    qid: 1749623109418,
    unit: "NTU",
    thresholdMax: 5,
    section: "physical",
  },
  {
    key: "temperature",
    title: "Water Temperature",
    qid: 1723459200023,
    unit: "°C",
    thresholdMax: 30,
    section: "physical",
  },
];

export const WQ_CBT_PARAMS = [
  {
    key: "cbt_ecoli",
    title: "CBT E.coli count",
    qid: 1749622982588,
    unit: "count",
    thresholdMax: 0,
  },
];

export const TEST_METHOD_LAB = "lab_test";
export const TEST_METHOD_CBT = "cbt_test";
