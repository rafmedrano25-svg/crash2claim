/**
 * Crash2Claim — Lead Payload Assembly + Delivery
 * -----------------------------------------------------------------
 * Builds the final JSON lead payload from survey state + attribution
 * + qualification result, and (best-effort) POSTs it to
 * CONFIG.WEBHOOK_URL. No API keys/secrets live here — if the real
 * integration needs auth, that belongs on the receiving server, not
 * in this client-side file.
 * -----------------------------------------------------------------
 */

/**
 * @param {Object} answers - raw survey answers (see js/app.js STATE)
 * @param {"qualified"|"unqualified"} qualificationStatus
 * @returns {Object} final lead payload
 */
function buildLeadPayload(answers, qualificationStatus) {
  var attribution = typeof getAttribution === "function" ? getAttribution() : {};

  // ?test=1 (or ?test=true) marks this submission as a test lead.
  // Read directly from the current URL — in this single-page survey
  // no reload ever happens between steps, so the query string is
  // still intact at submit time without needing extra persistence.
  var testParam = new URLSearchParams(window.location.search).get("test");
  var isTestLead = testParam === "1" || testParam === "true";

  var payload = {
    brand: CONFIG.BRAND_NAME,
    domain: CONFIG.DOMAIN,

    settlement_intent: answers.settlement_intent || "",
    accident_date: answers.accident_date || "",
    vehicle_type: answers.vehicle_type || "",
    injuries: Array.isArray(answers.injuries) ? answers.injuries : [],
    treatment_timing: answers.treatment_timing || "",
    at_fault: answers.at_fault || "",
    had_insurance: !!answers.had_insurance,
    has_attorney: !!answers.has_attorney,

    first_name: answers.first_name || "",
    last_name: answers.last_name || "",
    phone: answers.phone || "",
    email: answers.email || "",

    // Consent evidence — what was agreed to, and when. The disclosure
    // text is snapshotted from CONFIG at submit time so this specific
    // lead's record doesn't change if the copy is edited later.
    consent_given: !!answers.consent,
    consent_disclosure_shown: CONFIG.CONSENT_DISCLOSURE,
    consent_timestamp: answers.consent_timestamp || "",

    qualification_status: qualificationStatus,
    timestamp: new Date().toISOString(),
    landing_page_url: window.location.href,
    referrer: document.referrer || "",
    test_lead: isTestLead,
  };

  // Merge in whatever attribution params were captured, if any.
  ATTRIBUTION_KEYS.forEach(function (key) {
    if (attribution[key]) {
      payload[key] = attribution[key];
    }
  });

  return payload;
}

/**
 * Best-effort delivery to the configured webhook. Resolves
 * `{ ok: true }` on success, `{ ok: false, error }` on failure —
 * never throws — so the caller can show the qualification result
 * either way and only surface a soft warning on failure.
 * @param {Object} payload
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function sendLeadPayload(payload) {
  if (!CONFIG.WEBHOOK_URL || CONFIG.WEBHOOK_URL.indexOf("REPLACE_WITH_REAL_ENDPOINT") !== -1) {
    // No real endpoint configured yet. Logged as an ERROR (not just
    // info) with the actual configured value, specifically so a
    // misconfiguration like this is impossible to miss in DevTools
    // if it ever happens again on a deployed site.
    console.error(
      "[Crash2Claim] WEBHOOK_URL is not configured (current value: " +
        JSON.stringify(CONFIG.WEBHOOK_URL) +
        "). No request was sent. Lead payload:",
      payload
    );
    return Promise.resolve({ ok: false, error: "webhook_not_configured" });
  }

  if (typeof fetch !== "function") {
    // Defensive fallback for environments without a fetch global
    // (very old browsers, some test harnesses). Never throws.
    console.error("[Crash2Claim] fetch() is not available in this environment. Lead payload:", payload);
    return Promise.resolve({ ok: false, error: "fetch_unavailable" });
  }

  return fetch(CONFIG.WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (res) {
      if (!res.ok) {
        console.error("[Crash2Claim] Lead delivery failed with HTTP status " + res.status + ".");
        return { ok: false, error: "http_" + res.status };
      }
      return { ok: true };
    })
    .catch(function (err) {
      console.error("[Crash2Claim] Lead delivery failed:", err && err.message);
      return { ok: false, error: (err && err.message) || "network_error" };
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildLeadPayload: buildLeadPayload,
    sendLeadPayload: sendLeadPayload,
  };
}
