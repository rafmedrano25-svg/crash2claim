/**
 * Crash2Claim — Attribution Capture
 * -----------------------------------------------------------------
 * Captures marketing/tracking parameters from the URL on page load
 * and persists them in sessionStorage so they survive across the
 * 5-step survey (and a page refresh mid-survey) without needing a
 * backend. Values are merged, never overwritten with blanks, so a
 * click ID present on the entry URL isn't lost if a later internal
 * navigation lacks it.
 * -----------------------------------------------------------------
 */
 
const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "subid",
  "subid2",
  "fbclid",
  "gclid",
  "msclkid", // Microsoft/Bing Ads click ID
  "ttclid", // TikTok Ads click ID
];
 
const ATTRIBUTION_STORAGE_KEY = "c2c_attribution";
 
/**
 * Reads any attribution params present on the current URL, merges
 * them into whatever was already captured this session, and returns
 * the full merged set.
 * @returns {Object}
 */
function captureAttribution() {
  var params = new URLSearchParams(window.location.search);
  var stored = {};
  try {
    stored = JSON.parse(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) || "{}");
  } catch (e) {
    stored = {};
  }
 
  ATTRIBUTION_KEYS.forEach(function (key) {
    var value = params.get(key);
    if (value) {
      stored[key] = value;
    }
  });
 
  try {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored));
  } catch (e) {
    // sessionStorage unavailable (e.g. private browsing edge cases) —
    // attribution simply won't persist across a refresh, but the
    // in-memory value returned below still works for this pageview.
  }
 
  return stored;
}
 
/**
 * Returns the currently persisted attribution set without re-reading
 * the URL. Used when assembling the final payload.
 * @returns {Object}
 */
function getAttribution() {
  try {
    return JSON.parse(sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
}
 
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ATTRIBUTION_KEYS: ATTRIBUTION_KEYS,
    captureAttribution: captureAttribution,
    getAttribution: getAttribution,
  };
}
