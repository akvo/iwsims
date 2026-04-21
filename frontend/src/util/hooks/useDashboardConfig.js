import { useMemo } from "react";
import { getVisualizationConfig } from "../../config/visualizations";

/**
 * Walk the item tree and collect every item into a flat Map keyed by id.
 * Tab panes (plain objects with `items[]` but no `chart_type`) are walked
 * for their children but are NOT themselves entered into the map.
 * Throws if any id is used more than once.
 *
 * @param {Array} items
 * @param {Map}   acc
 * @returns {Map<string, object>}
 */
const collectDefinitions = (items = [], acc = new Map()) => {
  items.forEach((item) => {
    // Tab panes: no chart_type, but have items[] — recurse without indexing.
    if (!item.chart_type && Array.isArray(item.items)) {
      collectDefinitions(item.items, acc);
      return;
    }
    if (item.id) {
      if (acc.has(item.id)) {
        throw new Error(
          `[useDashboardConfig] Duplicate item id "${item.id}" detected. All item ids must be globally unique.`
        );
      }
      acc.set(item.id, item);
    }
    // Recurse into containers (tabs items[] are panes, filter_bar items[] are filter items).
    if (Array.isArray(item.items)) {
      collectDefinitions(item.items, acc);
    }
  });
  return acc;
};

/**
 * Loads the dashboard config for a given form id and enriches it with:
 *   - `definitionsById`: Map<id, item> covering every item in the tree
 *
 * Configs are bundled at build time from `src/config/visualizations/`.
 *
 * @param {number|string} formId
 * @returns {{ config: object|null, definitionsById: Map<string, object>, loading: boolean, error: Error|null }}
 */
export const useDashboardConfig = (formId) => {
  return useMemo(() => {
    if (!formId) {
      return {
        config: null,
        definitionsById: new Map(),
        loading: false,
        error: null,
      };
    }

    const config = getVisualizationConfig(formId);
    if (!config) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useDashboardConfig] no config registered for formId=${formId}`
      );
      return {
        config: null,
        definitionsById: new Map(),
        loading: false,
        error: null,
      };
    }

    let definitionsById;
    try {
      definitionsById = collectDefinitions(config.items || []);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err.message);
      return {
        config: null,
        definitionsById: new Map(),
        loading: false,
        error: err,
      };
    }

    return { config, definitionsById, loading: false, error: null };
  }, [formId]);
};

export default useDashboardConfig;
