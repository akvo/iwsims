import {
  getSiteProfileConfig,
  getSiteProfileKey,
  hasSiteProfile,
} from "../index";

describe("config/site-profiles registry", () => {
  test("resolves profiles by exact parent form id", () => {
    expect(getSiteProfileKey(1748903240763)).toBe("1748903240763");
    expect(getSiteProfileConfig(1748903240763)).toMatchObject({
      parent_form_id: 1748903240763,
    });
    expect(hasSiteProfile(1748903240763)).toBe(true);
  });

  test("falls back across candidate form ids without using arbitrary default", () => {
    expect(getSiteProfileKey(null, "", 1749611049520)).toBe("1749611049520");
    expect(getSiteProfileConfig("does-not-exist")).toBeNull();
    expect(hasSiteProfile("does-not-exist")).toBe(false);
  });
});
