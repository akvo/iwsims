import epsOverview from "./1749623934933.json";
import rwsOverview from "./1749621221728.json";
import wtpOverview from "./1749634736797.json";
import wwtpOverview from "./1748903240763.json";
import pumpOverview from "./1749611049520.json";
import nationalOverview from "./national.json";

/**
 * Registry of dashboard configs keyed by `slug`.
 *
 * To add a new dashboard:
 *   1. Drop a JSON file in this directory with a kebab-case `"slug"` field at
 *      the top level (e.g. `"slug": "my-dashboard"`).
 *   2. Import it below and append to `RAW_CONFIGS`.
 *
 * Configs with a missing, invalid, or duplicate slug are warned and skipped;
 * the app still boots. Navigation to an unresolved slug redirects to
 * `/control-center`.
 */
const RAW_CONFIGS = [
  epsOverview,
  rwsOverview,
  wtpOverview,
  wwtpOverview,
  pumpOverview,
  nationalOverview,
];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SLUG_INDEX = new Map();

RAW_CONFIGS.forEach((config, index) => {
  const slug = config?.slug;
  const parentFormId = config?.parent_form_id;
  // Prefer slug in diagnostics when available; otherwise the array index
  // so a misconfigured entry is still identifiable in the console.
  const ref = slug ? `slug="${slug}"` : `entry #${index}`;

  if (!slug) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visualizations] ${ref} (parent_form_id=${parentFormId}): missing "slug", skipped`
    );
    return;
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visualizations] ${ref}: invalid slug "${slug}" (must be kebab-case), skipped`
    );
    return;
  }
  // A cross-asset dashboard spans several registration families, so it has no
  // single root form. It declares `cross_asset: true` instead, and every api
  // block inside it must name its own `parent_form_id` (useDashboardValues
  // leaves an api-level value alone rather than overwriting it with the root).
  if (config?.cross_asset !== true) {
    if (typeof parentFormId !== "number" || !Number.isFinite(parentFormId)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[visualizations] ${ref}: missing or invalid "parent_form_id" (must be a finite number, or set "cross_asset": true), skipped`
      );
      return;
    }
  } else if (typeof parentFormId !== "undefined" && parentFormId !== null) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visualizations] ${ref}: "cross_asset" configs must not set a root "parent_form_id" — every api block names its own`
    );
    return;
  }
  if (SLUG_INDEX.has(slug)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visualizations] duplicate slug "${slug}"; skipping parent_form_id=${parentFormId}`
    );
    return;
  }
  SLUG_INDEX.set(slug, config);
});

/**
 * @param {string} slug
 * @returns {object|null} The dashboard config, or null if none is registered.
 */
export const getVisualizationConfigBySlug = (slug) => {
  if (!slug) {
    return null;
  }
  return SLUG_INDEX.get(String(slug)) || null;
};

/**
 * Enumerate all registered dashboards for menu rendering.
 * @returns {Array<{slug: string, name: string, parent_form_id: number}>}
 */
export const listVisualizations = () =>
  Array.from(SLUG_INDEX.values()).map((c) => ({
    slug: c.slug,
    name: c.name,
    parent_form_id: c.parent_form_id,
  }));
