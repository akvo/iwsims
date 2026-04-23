/**
 * EPS Individual Overview — per-dashboard constants.
 *
 * Question ids resolved from:
 *   backend/source/forms/2_1749623934933.prod.json
 *   backend/source/forms/2_1749624452908.monitoring.prod.json
 *   backend/source/forms/2_1749632545233.monitoring.prod.json
 *
 * See doc/claude/dashboard-individual-overview/implementation-plan.md
 * § Question-ID Reference / EPS for the full mapping table.
 */

export const REGISTRATION_FORM_ID = 1749623934933;
export const CONSTRUCTION_FORM_ID = 1749624452908;
export const WATER_QUALITY_FORM_ID = 1749632545233;

export const REGISTRATION_CHARACTERISTICS_QIDS = [
  1749624452990, // Division / Province / Tikina
  1749624452991, // Village name
  1749624452105, // Active Water Committee
  1749632480584, // Implementation date
  1749624452993, // Implementing Agency
  174962445299, // Project Background
  1749624452106, // Number of households
  1749624452107, // Total population
];

export const CONSTRUCTION_INSPECTION_DATE_QID = 1749624452911;
export const CONSTRUCTION_START_DATE_QID = 1749624452910;
export const CONSTRUCTION_PROPOSED_COMPLETION_QID = 1749630516825;
export const CONSTRUCTION_WEATHER_QID = 1749630701234;
export const CONSTRUCTION_REMARKS_QID = 1749624532451;
export const CONSTRUCTION_PROGRESS_QID = 1849635800001;
export const CONSTRUCTION_PHOTO_QID = 1749624521442;
export const CONSTRUCTION_PHOTO_CAPTION_QID = 1749631662652;

/**
 * Project scope rows for the Construction Information table.
 * Columns: Scope | In scope? | Implementation/Construction | Photo
 *   - status_qid     → "In scope?" / completion status answer
 *   - impl_qid       → "Implementation" cell answer (date or note)
 *   - photo_qid      → "Photo" thumbnail
 */
export const PROJECT_SCOPE_ROWS = [
  {
    key: "concrete_base",
    label: "Concrete Base",
    status_qid: 1849633499999,
    impl_qid: 1849633500001,
    photo_qid: 1849633600001,
  },
  {
    key: "urf_tank",
    label: "URF Tank",
    status_qid: 1849633720001,
    impl_qid: 1849633800001,
    photo_qid: 1849633900001,
  },
  {
    key: "eps_tank",
    label: "EPS Tank",
    status_qid: 1849633900003,
    impl_qid: 1849634100001,
    photo_qid: 1849634200001,
  },
  {
    key: "balance_tank",
    label: "Balance Tank",
    status_qid: 1849634300002,
    impl_qid: 1849634400001,
    photo_qid: 1849634500001,
  },
  {
    key: "storage_tank",
    label: "Storage Tank",
    status_qid: 1849634690001,
    impl_qid: 1849634700001,
    photo_qid: 1849634800001,
  },
  {
    key: "standpipes",
    label: "Standpipes",
    status_qid: 1849635200001,
    impl_qid: 1849635000001,
    photo_qid: 1849635100001,
  },
  {
    key: "drainage",
    label: "Drainage",
    status_qid: null,
    impl_qid: 1849635300001,
    photo_qid: 1849635400001,
  },
  {
    key: "site_security",
    label: "Site Security & Perimeter",
    status_qid: 1849635500001,
    impl_qid: 1849635600001,
    photo_qid: 1849635700001,
  },
];

export const WQ_DATE_QID = 1749632545235;
export const WQ_VILLAGE_HEADMAN_QID = 1749632793266;
export const WQ_PHONE_QID = 1749632819551;
export const WQ_TRAINING_QID = 1749632835123;
export const WQ_WEATHER_QID = 1749632196724;
export const WQ_SAMPLE_TAKEN_QID = 1749632647507;
export const WQ_SAMPLE_NOT_TAKEN_REASON_QID = 1749632887312;
export const WQ_TEST_METHOD_QID = 1749633001462;
export const WQ_REMARKS_QID = 1749633350893;
export const WQ_PHOTO_QID = 1749633073911;
export const WQ_PHOTO_CAPTION_QID = 1749633110662;
export const WQ_STATUS_QID = 1749633373968;

export const WATER_QUALITY_DETAIL_QIDS = [
  WQ_DATE_QID,
  WQ_VILLAGE_HEADMAN_QID,
  WQ_PHONE_QID,
  WQ_TRAINING_QID,
  WQ_WEATHER_QID,
  WQ_SAMPLE_TAKEN_QID,
  WQ_SAMPLE_NOT_TAKEN_REASON_QID,
  WQ_TEST_METHOD_QID,
  WQ_REMARKS_QID,
];

/**
 * Lab / CBT chart parameter lists. `qid` resolves the per-submission value
 * for the chart series; `unit` and threshold drive the akvo-charts y-axis
 * + markArea band.
 */
export const WQ_LAB_PARAMS = [
  {
    key: "ecoli",
    title: "E-coli",
    qid: 1749633220746,
    unit: "cfu/100mL",
    thresholdMax: 0,
  },
  {
    key: "total_coliform",
    title: "Total Coliform",
    qid: 1749633259392,
    unit: "cfu/100mL",
    thresholdMax: 0,
  },
  {
    key: "fecal_coliform",
    title: "Faecal Coliform",
    qid: 1749633295165,
    unit: "cfu/100mL",
    thresholdMax: 0,
  },
];

export const WQ_CBT_PARAMS = [
  {
    key: "cbt_count",
    title: "CBT contamination count",
    qid: 1749633325456,
    unit: "count",
    thresholdMax: 0,
  },
];

/**
 * Test-method option values that flag Lab / CBT chart sections as
 * applicable. The latest WQ submission's WQ_TEST_METHOD_QID answer is
 * cross-referenced against these option values.
 */
export const TEST_METHOD_LAB = "lab_test";
export const TEST_METHOD_CBT = "cbt_test";
