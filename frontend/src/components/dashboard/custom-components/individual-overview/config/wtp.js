/**
 * Individual WTP overview — question ids. Same shape as `wwtp.js`, consumed
 * by IndividualPlantOverview.
 */
export const REGISTRATION_FORM_ID = 1749634736797;
export const MONITORING_FORM_ID = 1749652214711;

export const ENTITY_LABEL = "WTP";

export const REGISTRATION_CHARACTERISTICS_QIDS = [
  1749635249444, // plant_name
  1749634736799, // plant_type
  1749635162210, // division
  1749635281187, // constructed_date
  1749635313175, // designed_capacity_megalitres
];

export const PHOTO_QID = 1900000000111; // inspection_photo
export const PHOTO_CAPTION_QID = 1900000000112; // inspection_photo_comment
export const DATE_QID = 1900000000101; // date_of_inspection

export const MONITORING_DETAIL_QIDS = [
  1900000000101, // date_of_inspection
  1749652214713, // contact_person_name
  1749652940735, // staff_count
  1749652417794, // daily_production_megalitres
  1749692856000, // can_take_water_sample
  1749692895121, // water_testing_method
];

/**
 * Drinking-water parameters charted over the monitoring history.
 *
 * Thresholds are the ones the WTP dashboard already uses for its compliance
 * chart, so the individual view and the fleet view agree. E. coli is charted
 * but currently has no submissions at all — see issue #34.
 */
export const PARAM_GROUPS = [
  {
    key: "microbial",
    title: "Microbial parameters",
    params: [
      {
        key: "e_coli",
        qid: 1754995400007,
        title: "E. coli",
        unit: "cfu/100ml",
        thresholdMax: 0,
      },
      {
        key: "total_coliform",
        qid: 1749693340552,
        title: "Total coliform",
        unit: "cfu/100ml",
        thresholdMax: 0,
      },
      {
        key: "fecal_coliform",
        qid: 1749693362270,
        title: "Faecal coliform",
        unit: "cfu/100ml",
        thresholdMax: 0,
      },
    ],
  },
  {
    key: "physical_chemical",
    title: "Physical & chemical parameters",
    params: [
      {
        key: "turbidity",
        qid: 1749693079936,
        title: "Turbidity",
        unit: "NTU",
        thresholdMax: 5,
      },
      {
        key: "residual_chlorine",
        qid: 1749693184574,
        title: "Residual chlorine",
        unit: "mg/L",
        thresholdMin: 0.2,
        thresholdMax: 0.5,
      },
      {
        key: "ph",
        qid: 1754995300102,
        title: "pH",
        thresholdMin: 6.5,
        thresholdMax: 8.5,
      },
      {
        key: "conductivity",
        qid: 1754995300103,
        title: "Conductivity",
        unit: "µS/cm",
        thresholdMax: 1000,
      },
      {
        key: "salinity",
        qid: 1754995300104,
        title: "Salinity",
        unit: "PPT",
        thresholdMax: 1,
      },
    ],
  },
];
