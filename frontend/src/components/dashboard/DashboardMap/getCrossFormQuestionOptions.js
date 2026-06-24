/**
 * Resolve a question's options across a whole registration family by
 * scanning `window.forms`. The family is the registration form itself
 * (`id === parentFormId`) plus every monitoring form whose
 * `content.parent` matches `parentFormId`. Option lists for
 * `questionName` are unioned across all of them.
 *
 * This mirrors the backend's cross-form-with-registration-fallback
 * scope (mv_cross_form_latest overlaid on the registration's own
 * answers): a `question_name` may live on several monitoring forms
 * (e.g. Quick + Comprehensive Monitoring) or solely on the
 * registration form (e.g. `water_committee`). Options are de-duplicated
 * by `value`, keeping the first label/color encountered so the legend
 * stays stable. Each option's `color` (when defined on the form) is
 * carried through so the map can default its palette from the form
 * rather than requiring an explicit `color_map` in the config.
 *
 * Returns an empty array if no family form carries the question.
 */
const getCrossFormQuestionOptions = (parentFormId, questionName) => {
  const familyId = Number(parentFormId);
  const familyForms = (window.forms || []).filter(
    (f) => f?.id === familyId || f?.content?.parent === familyId
  );
  const seen = new Set();
  const out = [];
  familyForms.forEach((form) => {
    const groups = form?.content?.question_group || [];
    groups.forEach((group) => {
      const q = (group.question || []).find((x) => x.name === questionName);
      (q?.option || []).forEach((o) => {
        if (!seen.has(o.value)) {
          seen.add(o.value);
          out.push({ label: o.label, value: o.value, color: o.color });
        }
      });
    });
  });
  return out;
};

export default getCrossFormQuestionOptions;
