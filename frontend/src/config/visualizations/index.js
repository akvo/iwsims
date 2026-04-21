import epsOverview from "./1749623934933.json";

/**
 * Registry of dashboard configs keyed by `parent_form_id`.
 * To add a new dashboard: drop a `<formId>.json` in this directory and
 * register it below.
 */
const CONFIGS = {
  [epsOverview.parent_form_id]: epsOverview,
};

/**
 * @param {number|string} formId
 * @returns {object|null} The dashboard config, or null if none is registered.
 */
export const getVisualizationConfig = (formId) => {
  const key = Number(formId);
  return CONFIGS[key] || null;
};

export const listVisualizationFormIds = () => Object.keys(CONFIGS).map(Number);

export default CONFIGS;
