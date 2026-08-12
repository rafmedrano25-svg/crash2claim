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
 * Generates a unique, non-PII identifier for a single lead submission,
 * suitable for reconciling this Sheet row against a future CRM/buyer
 * system. Never derived from name/email/phone or any other personal
 * data — just random bytes.
 *
 * Prefers crypto.randomUUID() (standard, collision-resistant, supported
 * in all current browsers over HTTPS). Falls back to constructing a
 * UUID-v4-shaped string from crypto.getRandomValues() for slightly
 * older browsers, and finally to a Date+Math.random fallback only if
 * neither Web Crypto API is available.
 * @returns {string}
 */
function generateLeadId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (e) {}

  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
      var hex = Array.prototype.map
        .call(bytes, function (b) {
          return b.toString(16).padStart(2, "0");
        })
        .join("");
      return (
        hex.substring(0, 8) +
        "-" +
        hex.substring(8, 12) +
        "-" +
        hex.substring(12, 16) +
        "-" +
        hex.substring(16, 20) +
        "-" +
        hex.substring(20)
      );
    }
  } catch (e) {}

  // Last-resort fallback — weaker randomness, but still never derived
  // from any personal/identifying data.
  return "c2c-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 12);
}

/**
 * @param {Object} answers - raw survey answers (see js/app.js STATE)
 * @param {"qualified"|"unqualified"} qualificationStatus
 * @param {string} [disqualificationReason] - stable reason code from
 *   qualification.js's getDisqualificationReason(), or "" if qualified
 * @param {string} [leadId] - id from generateLeadId(), generated once
 *   in app.js before this function is called, so the same id is used
 *   consistently for this submission
 * @returns {Object} final lead payload
 */
function buildLeadPayload(answers, qualificationStatus, disqualificationReason, leadId) {
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

    lead_id: leadId || generateLeadId(),

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

    // Consent evidence — what was agreed to, when, where, and which
    // version of the disclosure copy was actually shown. The
    // disclosure text itself is unchanged; consent_disclosure_version
    // is just a stable tag so future copy edits don't retroactively
    // change what a past lead's record implies they saw.
    consent_given: !!answers.consent,
    consent_disclosure_shown: CONFIG.CONSENT_DISCLOSURE,
    consent_disclosure_version: CONFIG.CONSENT_DISCLOSURE_VERSION || "",
    consent_timestamp: answers.consent_timestamp || "",
    consent_source: "crash2claim_survey_contact_step",

    qualification_status: qualificationStatus,
    disqualification_reason: qualificationStatus === "unqualified" ? disqualificationReason || "" : "",

    timestamp: new Date().toISOString(),
    landing_page_url: window.location.href,
    referrer: document.referrer || "",
    test_lead: isTestLead,
  };

  // Merge in whatever attribution params were captured, if any
  // (UTMs, subid/subid2, and click IDs including gclid, fbclid,
  // msclkid, ttclid — see attribution.js's ATTRIBUTION_KEYS).
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
    generateLeadId: generateLeadId,
    buildLeadPayload: buildLeadPayload,
    sendLeadPayload: sendLeadPayload,
  };
}
