/**
 * Individual WWTP overview — question ids.
 *
 * Shape consumed by IndividualPlantOverview, the generic plant renderer.
 * EPS and RWS keep bespoke components because they carry sections this shape
 * has no room for (project scope, per-infrastructure construction); WWTP and
 * WTP are the plain case — characteristics, a photo, the latest inspection,
 * and parameter trends.
 */
export const REGISTRATION_FORM_ID = 1748903240763;
export const MONITORING_FORM_ID = 1748905550055;

export const ENTITY_LABEL = "WWTP";

export const REGISTRATION_CHARACTERISTICS_QIDS = [
  1748903442166, // plant_name
  1748903240794, // division
  1748903539202, // commissioned_year
  1748905778961, // total_population_connected_to_this_plant
  1748903613622, // design_capacity_m3_day
];

export const PHOTO_QID = 1900000000211; // inspection_photo
export const PHOTO_CAPTION_QID = 1900000000212; // inspection_photo_comment
export const DATE_QID = 1748905754732; // inspection_date

export const MONITORING_DETAIL_QIDS = [
  1748905754732, // inspection_date
  1748906474270, // plant_supervisor_name
  1748910159332, // num_staff_at_plant
  1748910823255, // ohs_equipment_available
  1748917751257, // can_take_sample
  1748917751258, // effluent_test_method
];

/**
 * Effluent parameters charted over the monitoring history.
 *
 * Only BOD, COD and TDS carry thresholds: those are the three DWS treats as
 * mandatory, and the same limits the Effluent Compliance KPI uses. The rest
 * are advisory — no DWS threshold has been agreed for TSS, ammonia, nitrate
 * or total phosphorus, so they chart without a reference band rather than
 * against a value nobody signed off. See issue #34.
 */
export const PARAM_GROUPS = [
  {
    key: "mandatory",
    title: "Mandatory effluent parameters",
    params: [
      {
        key: "bod",
        qid: 1754995400901,
        title: "BOD",
        unit: "mg/L",
        thresholdMax: 40,
      },
      {
        key: "cod",
        qid: 1754995400701,
        title: "COD",
        unit: "mg/L",
        thresholdMax: 100,
      },
      {
        key: "tds",
        qid: 1754995400301,
        title: "TDS",
        unit: "mg/L",
        thresholdMax: 1000,
      },
    ],
  },
  {
    key: "advisory",
    title: "Advisory parameters",
    params: [
      { key: "tss", qid: 1754995400302, title: "TSS", unit: "mg/L" },
      {
        key: "ph",
        qid: 1754995400102,
        title: "pH",
        thresholdMin: 6.5,
        thresholdMax: 8.5,
      },
      { key: "ammonia", qid: 1754995400501, title: "Ammonia", unit: "mg/L" },
      { key: "nitrate", qid: 1754995400503, title: "Nitrate", unit: "mg/L" },
      {
        key: "total_phosphorus",
        qid: 1754995400505,
        title: "Total phosphorus",
        unit: "mg/L",
      },
    ],
  },
];
