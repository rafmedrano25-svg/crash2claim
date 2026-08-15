/**
 * Crash2Claim — /apply Payload Assembly
 * -----------------------------------------------------------------
 * Builds the JSON body sent to submit-story-application.js. Fully
 * independent from js/payload.js (the case-evaluation funnel's
 * payload builder) — different field names, different id scheme,
 * different destination. Reads attribution from the SAME
 * js/attribution.js module (unmodified, shared utility only) so
 * normal UTM/click-ID capture still works on this page.
 * -----------------------------------------------------------------
 */

/**
 * Non-PII applicant identifier. Same generation strategy as the
 * case-evaluation funnel's generateLeadId() (crypto.randomUUID with
 * safe fallbacks), but namespaced with an "APP-" prefix so a value
 * from this system can never be mistaken for a lead_id.
 * @returns {string}
 */
function generateApplicantId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return "APP-" + crypto.randomUUID();
    }
  } catch (e) {
    // fall through to fallback
  }
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      var hex = Array.prototype.map
        .call(bytes, function (b) {
          return b.toString(16).padStart(2, "0");
        })
        .join("");
      return "APP-" + hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
    }
  } catch (e2) {
    // fall through to fallback
  }
  return "APP-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

/**
 * @param {Object} answers - STATE.answers from apply-app.js
 * @param {string} applicantId
 * @param {boolean} isTest
 * @returns {Object}
 */
function buildApplicationPayload(answers, applicantId, isTest) {
  var attribution = (typeof getAttribution === "function") ? getAttribution() : {};

  return {
    applicant_id: applicantId,
    application_date: new Date().toISOString(),
    test_submission: !!isTest,

    source: attribution.utm_source || "direct",
    campaign: APPLY_CONFIG.CAMPAIGN_NAME,

    first_name: answers.first_name || "",
    age_18_confirmation: answers.is_18 === true ? "Yes" : answers.is_18 === false ? "No" : "",
    state: answers.state || "",
    accident_timeframe: answers.accident_timeframe || "",
    story_summary: answers.story_summary || "",
    situation_status: answers.situation_status || "",
    on_camera_comfort: answers.on_camera_comfort || "",
    phone: answers.phone || "",
    email: answers.email || "",

    // Initial status values — every new applicant starts here.
    applicant_status: "New",
    verification_status: "Not Requested",
    verification_type: "",
    verification_date: "",
    interview_status: "Not Scheduled",
    release_status: "Not Sent",
    payment_status: "Not Eligible Yet",
    content_status: "Not Started",
    episode_number: "",

    consent_given: !!answers.consent,
    consent_timestamp: answers.consent_timestamp || "",
    consent_disclosure_shown: APPLY_CONFIG.RECRUITMENT_CONSENT,
    consent_disclosure_version: APPLY_CONFIG.RECRUITMENT_CONSENT_VERSION,

    landing_page_url: (typeof window !== "undefined" && window.location) ? window.location.href : "",
    referrer: (typeof document !== "undefined" && document.referrer) ? document.referrer : "",

    utm_source: attribution.utm_source || "",
    utm_medium: attribution.utm_medium || "",
    utm_campaign: attribution.utm_campaign || "",
    utm_content: attribution.utm_content || "",
    utm_term: attribution.utm_term || "",
    subid: attribution.subid || "",
    subid2: attribution.subid2 || "",
    gclid: attribution.gclid || "",
    fbclid: attribution.fbclid || "",
    msclkid: attribution.msclkid || "",
    ttclid: attribution.ttclid || "",
  };
}

/**
 * Sends the application payload to the recruitment Netlify Function.
 * Mirrors the case-evaluation funnel's resilient-submit pattern:
 * network/server failure never blocks the applicant from seeing the
 * thank-you screen, it only sets a soft warning flag.
 * @param {Object} payload
 * @returns {Promise<{ok: boolean}>}
 */
function sendApplicationPayload(payload) {
  return fetch(APPLY_CONFIG.WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (res) {
      return { ok: res.ok };
    })
    .catch(function () {
      return { ok: false };
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateApplicantId: generateApplicantId,
    buildApplicationPayload: buildApplicationPayload,
    sendApplicationPayload: sendApplicationPayload,
  };
}
