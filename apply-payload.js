/**
 * Crash2Claim — /apply Payload Assembly
 * -----------------------------------------------------------------
 * Builds the JSON body sent to submit-story-application.js. Fully
 * independent from js/payload.js (the case-evaluation funnel's
 * payload builder) — different field names, different id scheme,
 * different destination. Reads attribution from the SAME
 * attribution.js module (unmodified, shared utility only) so
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

    // Opening question, shown to every applicant before any other
    // question (including name/age). See qPaymentIntentTemplate() in
    // apply-app.js.
    payment_intent: answers.payment_intent || "",

    first_name: answers.first_name || "",
    // is_18 is unchanged in shape (still true/false/null -> "Yes"/"No"/"")
    // — only how it gets set changed. As of this revision it's derived
    // from date_of_birth (see bindQ2() in apply-app.js) instead of a
    // direct Yes/No click, so this mapping needs no change at all.
    age_18_confirmation: answers.is_18 === true ? "Yes" : answers.is_18 === false ? "No" : "",
    // NEW — the applicant's DOB itself ("YYYY-MM-DD"), collected on the
    // question that replaced the old 18+ Yes/No click. Plain string
    // pass-through, same pattern as address/story_summary.
    date_of_birth: answers.date_of_birth || "",
    state: answers.state || "",
    accident_timeframe: answers.accident_timeframe || "",
    story_summary: answers.story_summary || "",
    situation_status: answers.situation_status || "",
    // Only asked (and only ever true/false) when recency is within the
    // last 12 months AND situation_status is "Still ongoing" — "Not
    // sure" was removed as a case-status answer as of this revision,
    // see isAttorneyRepQualified() in apply-app.js. Stays "" otherwise.
    has_hired_attorney: answers.has_hired_attorney === true ? "Yes" : answers.has_hired_attorney === false ? "No" : "",
    // Only asked (and only ever true/false) when the applicant is also
    // unrepresented (has_hired_attorney === "No") — see
    // isAttorneyInterestQualified() in apply-app.js. Stays "" otherwise.
    interested_in_attorney: answers.interested_in_attorney === true ? "Yes" : answers.interested_in_attorney === false ? "No" : "",
    // Only asked when the applicant also wants a free review
    // (interested_in_attorney === "Yes") — see isLiabilityQualified()
    // in apply-app.js. Stays "" otherwise. "Other person" is the only
    // value that satisfies the liability leg of HOT LEAD.
    primary_fault: answers.primary_fault || "",
    // HOT LEAD-only follow-up questions (see isHotLead() in
    // apply-app.js). Empty/blank for every non-HOT-LEAD applicant.
    // injuries is sent as a raw array — submit-story-application.js's
    // buildRow() already joins arrays with ", " when writing to Sheets.
    injuries: Array.isArray(answers.injuries) ? answers.injuries : [],
    medical_treatment_timing: answers.medical_treatment_timing || "",
    // The "Did you have car insurance...?" question was removed as of
    // this revision — answers.had_car_insurance is now permanently ""
    // (nothing in apply-app.js ever sets it anymore). Kept here
    // unchanged so the field/Sheet column continues to exist and stay
    // aligned; it just always submits blank now.
    had_car_insurance: answers.had_car_insurance || "",
    // NOTE: lead_status is intentionally NOT included here. It is
    // computed server-side in submit-story-application.js from
    // accident_timeframe + situation_status + interested_in_attorney,
    // never trusted from the browser.
    on_camera_comfort: answers.on_camera_comfort || "",
    phone: answers.phone || "",
    email: answers.email || "",
    // NEW — collected on the contact/payment page (Q8) alongside
    // phone/email. Plain string pass-through, same pattern as
    // story_summary.
    address: answers.address || "",

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

    // Application Agreement — the single required consent checkbox on
    // the consent step (see qConsentTemplate() in apply-app.js). As of
    // this revision that one checkbox covers both the Application
    // Agreement and (for HOT LEAD applicants) Attorney Contact
    // Consent, but this field/column is unchanged: it's still just
    // "did the applicant give their consent". This IS the Sheet's
    // persisted "application_agreement_consent" value — verified
    // against the Sheet schema, no column literally named
    // application_agreement_consent exists (or is needed): consent_given
    // already stores exactly this boolean, from exactly this same
    // checkbox, every submission. No new field/column was added.
    consent_given: !!answers.consent,
    consent_timestamp: answers.consent_timestamp || "",
    consent_disclosure_shown: APPLY_CONFIG.RECRUITMENT_CONSENT,
    consent_disclosure_version: APPLY_CONFIG.RECRUITMENT_CONSENT_VERSION,
    // Attorney Contact Consent — as of this revision there is no
    // separate checkbox for this. It's derived from isHotLead() at
    // the moment the single consent checkbox is checked (see
    // validateAndSubmitFromConsent() in apply-app.js): "Yes" for HOT
    // LEAD applicants (who saw and agreed to the attorney paragraph
    // as part of that one checkbox), "No" for everyone else (who
    // never saw that paragraph at all). Still always "Yes"/"No" once
    // the consent step is reached, never blank — same Sheet
    // convention as before.
    attorney_contact_consent: answers.attorney_contact_consent === true ? "Yes" : answers.attorney_contact_consent === false ? "No" : "",

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
 * final screen, it only sets a soft warning flag. Also surfaces the
 * server's duplicate-applicant flag (see submit-story-application.js)
 * so the UI can show the friendly "already submitted" message instead
 * of the normal thank-you copy, without writing a second Sheet row.
 * @param {Object} payload
 * @returns {Promise<{ok: boolean, duplicate?: boolean}>}
 */
function sendApplicationPayload(payload) {
  return fetch(APPLY_CONFIG.WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          return { ok: res.ok, duplicate: !!(body && body.duplicate) };
        });
    })
    .catch(function () {
      return { ok: false, duplicate: false };
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateApplicantId: generateApplicantId,
    buildApplicationPayload: buildApplicationPayload,
    sendApplicationPayload: sendApplicationPayload,
  };
}
