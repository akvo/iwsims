import wwtpProfile from "./1748903240763.json";
import pumpProfile from "./1749611049520.json";
import rwpProfile from "./1749621221728.json";
import epsProfile from "./1749623934933.json";
import wtpProfile from "./1749634736797.json";

const siteProfiles = {
  [wwtpProfile.parent_form_id]: wwtpProfile,
  [pumpProfile.parent_form_id]: pumpProfile,
  [rwpProfile.parent_form_id]: rwpProfile,
  [epsProfile.parent_form_id]: epsProfile,
  [wtpProfile.parent_form_id]: wtpProfile,
};

const getProfileKey = (formId) => {
  if (formId === null || typeof formId === "undefined" || formId === "") {
    return null;
  }
  const key = String(formId);
  if (siteProfiles[key]) {
    return key;
  }
  return null;
};

export const getSiteProfileKey = (...formIds) =>
  formIds.map(getProfileKey).find(Boolean) || null;

export const getSiteProfileConfig = (...formIds) => {
  const key = getSiteProfileKey(...formIds);
  return key ? siteProfiles[key] : null;
};

export const hasSiteProfile = (...formIds) =>
  Boolean(getSiteProfileConfig(...formIds));

export default siteProfiles;
