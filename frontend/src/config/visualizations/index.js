import epsOverview from "./1749623934933.json";

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
const RAW_CONFIGS = [epsOverview];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const SLUG_INDEX = new Map();

RAW_CONFIGS.forEach((config) => {
  const slug = config?.slug;
  const parentFormId = config?.parent_form_id;
  if (!slug) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visualizations] parent_form_id=${parentFormId}: missing "slug", skipped`
    );
    return;
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visualizations] parent_form_id=${parentFormId}: invalid slug "${slug}" (must be kebab-case), skipped`
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
