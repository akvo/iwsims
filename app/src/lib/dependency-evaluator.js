/**
 * Utility module for evaluating question dependencies with support for AND/OR rules.
 * Based on akvo-react-form v2.7.4 implementation with recursive ancestor checking.
 */

/**
 * Check if two arrays have at least one common element
 * @param {Array} array1 - First array
 * @param {Array} array2 - Second array
 * @returns {boolean} - True if arrays have at least one common element
 */
export const intersection = (array1, array2) => {
  const set1 = new Set(array1);
  return array2.filter((item) => set1.has(item));
};

/**
 * Validates a single dependency against the provided value
 * @param {Object} dependency - Dependency object with options/min/max/equal/notEqual
 * @param {*} value - The answer value to check against
 * @returns {boolean} - True if the dependency is satisfied
 */
export const validateDependency = (dependency, value) => {
  if (dependency?.options) {
    const v = typeof value === 'string' ? [value] : value;
    return intersection(dependency.options, v)?.length > 0;
  }
  let valid = false;
  if (dependency?.min) {
    valid = value >= dependency.min;
  }
  if (dependency?.max) {
    valid = value <= dependency.max;
  }
  if (dependency?.equal) {
    valid = value === dependency.equal;
  }
  if (dependency?.notEqual) {
    valid = value !== dependency.notEqual && !!value;
  }
  return valid;
};

/**
 * Normalizes dependency arrays by merging duplicate IDs and consolidating options.
 * This ensures that dependencies with the same ID are combined into a single entry.
 *
 * @param {Array} deps - Array of dependency objects
 * @returns {Array} - Normalized array with merged duplicate IDs
 *
 * @example
 * const deps = [
 *   { id: 123, options: ['a', 'b'] },
 *   { id: 123, options: ['c'] },
 *   { id: 456, options: ['x'] }
 * ];
 * normalizeDeps(deps);
 * // Returns: [
 * //   { id: 123, options: ['a', 'b', 'c'] },
 * //   { id: 456, options: ['x'] }
 * // ]
 */
export const normalizeDeps = (deps = []) => {
  const map = {};
  // eslint-disable-next-line no-restricted-syntax
  for (const d of deps) {
    const key = String(d.id);
    if (!map[key]) {
      map[key] = { id: d.id, options: [] };
    }
    // Merge options and remove duplicates using Set
    map[key].options = [...new Set([...map[key].options, ...(d.options || [])])];
  }
  return Object.values(map);
};

/**
 * Helper to recursively check if a dependency and all its ancestors are satisfied
 * @param {Object} dep - Dependency to check
 * @param {Object} answers - Current form values
 * @param {Array} allQuestions - All questions (for looking up ancestors)
 * @returns {boolean}
 */
const isDependencyWithAncestorsSatisfied = (dep, answers, allQuestions) => {
  // First check if this dependency itself is satisfied
  const answer = answers[String(dep.id)];
  if (!validateDependency(dep, answer)) {
    return false;
  }

  // For repeatable groups, dep.id might have a suffix like "123-0"
  // Strip the suffix to find the original question
  const depIdStr = String(dep.id);
  const baseDepId = depIdStr.includes('-') ? parseInt(depIdStr.split('-')[0], 10) : dep.id;

  // Find the question this dependency refers to (using base ID)
  const question = allQuestions?.find((q) => q.id === baseDepId);
  if (!question || !question.dependency) {
    // No ancestors, this dependency is satisfied
    return true;
  }

  // Recursively check ancestors with their dependency_rule
  const ancestorRule = (question.dependency_rule || 'AND').toUpperCase();
  if (ancestorRule === 'OR') {
    // At least one ancestor must be satisfied (recursively)
    return question.dependency.some((ancestorDep) =>
      isDependencyWithAncestorsSatisfied(ancestorDep, answers, allQuestions),
    );
  }
  // All ancestors must be satisfied (recursively)
  return question.dependency.every((ancestorDep) =>
    isDependencyWithAncestorsSatisfied(ancestorDep, answers, allQuestions),
  );
};

/**
 * Evaluates whether dependencies are satisfied based on dependency_rule
 * @param {Object} question - Question object with dependency and dependency_rule
 * @param {Object} answers - Current form values/answers (key: questionId, value: answer)
 * @param {Array} allQuestions - All questions in the form (for recursive ancestor checks)
 * @returns {boolean} - True if dependencies are satisfied, false otherwise
 */
export const isDependencySatisfied = (question, answers, allQuestions = []) => {
  const rule = (question?.dependency_rule || 'AND').toUpperCase();
  const deps = question?.dependency || [];

  // No dependencies means always satisfied
  if (!deps.length) {
    return true;
  }

  // For AND rule: check each dependency recursively with ancestors
  // ALL dependencies (with their ancestors) must be fully satisfied
  if (rule === 'AND' && deps.length > 0) {
    return deps.every((dep) => isDependencyWithAncestorsSatisfied(dep, answers, allQuestions));
  }

  // For OR rule: check each dependency recursively with ancestors
  // At least ONE dependency (with its ancestors) must be fully satisfied
  if (rule === 'OR') {
    return deps.some((dep) => isDependencyWithAncestorsSatisfied(dep, answers, allQuestions));
  }

  // Fallback (shouldn't reach here)
  return true;
};

export default {
  intersection,
  validateDependency,
  normalizeDeps,
  isDependencySatisfied,
};
