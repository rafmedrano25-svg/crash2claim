/**
 * Crash2Claim — Site Configuration
 * -----------------------------------------------------------------
 * This is the ONLY file most future changes should require:
 * branding, qualification rules, webhook target, consent copy,
 * allowed states, and tracking pixel IDs all live here.
 *
 * Nothing in this file should reference DOM elements — it is pure
 * configuration, consumed by js/app.js, js/qualification.js,
 * js/payload.js and js/attribution.js.
 * -----------------------------------------------------------------
 */

const CONFIG = {
  // ---------------------------------------------------------------
  // BRAND
  // ---------------------------------------------------------------
  BRAND_NAME: "Crash2Claim",
  DOMAIN: "Crash2Claim.com",
  TAGLINE: "Your 60-Second Accident Check",

  // Contact number shown in footer / result screens if needed.
  // PLACEHOLDER — replace with the real support/intake line before launch.
  CONTACT_PHONE: "1-800-000-0000",

  // ---------------------------------------------------------------
  // LEAD DELIVERY
  // ---------------------------------------------------------------
  // Points at this site's own Netlify Function (netlify/functions/
  // submit-lead.js), which authenticates to Google Sheets server-side
  // and appends each lead as a row in the master lead spreadsheet.
  // No credentials live here or anywhere in the browser — the
  // function reads them from Netlify environment variables at
  // runtime. This is a same-origin relative path, not a secret.
  WEBHOOK_URL: "/.netlify/functions/submit-lead",

  // ---------------------------------------------------------------
  // CONSENT / TCPA DISCLOSURE
  // ---------------------------------------------------------------
  // Business-approved consent disclosure (CONSENT_DISCLOSURE_VERSION
  // "v3"), revised per business instruction to lead with the
  // Crash2Claim brand and remove the parent-entity reference from
  // the consumer-facing consent text. This has NOT yet undergone
  // formal outside-counsel review. See
  // crash2claim-counsel-review-packet.md for prior open legal-review
  // items. Only confirmed facts are stated below — no autodialer,
  // prerecorded/AI voice, call-recording, or calling-hour language is
  // included because none of that has been confirmed as true of
  // Crash2Claim or its downstream recipients.
  //
  // LEGAL REVIEW NOTE (internal only — not displayed on the site):
  // The broad recipient language below ("qualified third parties...
  // attorneys, law firms, legal intake companies, legal service
  // providers, lead buyers, and marketing partners") still needs
  // counsel review for TCPA/TSR recipient-identification and
  // downstream-calling requirements before this can be treated as
  // final, attorney-approved consent language.
  CONSENT_DISCLOSURE:
    "By checking this box and selecting “Get My Free Case Evaluation,” " +
    "I am electronically signing this consent and confirming that the " +
    "information I have provided is accurate. I understand that " +
    "Crash2Claim is a commercial lead-generation service that is not a " +
    "law firm and does not provide legal advice or legal representation. " +
    "I authorize Crash2Claim and the qualified third parties who may " +
    "receive my information — which may include attorneys, law firms, " +
    "legal intake companies, legal service providers, lead buyers, and " +
    "marketing partners — to contact me about my accident inquiry by " +
    "telephone, text message (SMS/MMS), and/or email at the phone " +
    "number and email address I provided. Message and data rates may " +
    "apply. My consent is not a condition of purchasing any goods or " +
    "services. I may revoke my consent at any time by emailing " +
    "privacy@crash2claim.com. My submission is also governed by " +
    "Crash2Claim's Terms of Use and Privacy Policy.",

  // A short, stable version tag for CONSENT_DISCLOSURE above — NOT the
  // legal text itself (that is unchanged). Increment this any time the
  // disclosure copy is edited, so every past lead stays tied to the
  // exact wording it was actually shown, even after future edits.
  CONSENT_DISCLOSURE_VERSION: "v3",

  // ---------------------------------------------------------------
  // QUALIFICATION RULES
  // ---------------------------------------------------------------
  // Kept fully separate from the UI. js/qualification.js reads this
  // object and returns "qualified" | "unqualified" — change criteria
  // here without touching any markup or step logic.
  QUALIFYING_RULES: {
    requireInjury: true, // injuries must include something other than "no_injury"
    requireAtFaultOther: true, // at_fault must be exactly "yes" ("not_sure" does not pass)
    requireInsurance: true, // had_insurance must be true
    disqualifyIfHasAttorney: true, // has_attorney === true disqualifies
    excludedTreatmentTimings: ["never"], // treatment_timing values that disqualify
  },

  // ---------------------------------------------------------------
  // ALLOWED STATES
  // ---------------------------------------------------------------
  // NOTE: the current survey flow does not collect state/ZIP, so
  // this list isn't consumed by qualification right now. Left in
  // place in case a location question is reintroduced later — a
  // "restrictToAllowedStates"-style rule could be re-added to
  // QUALIFYING_RULES and js/qualification.js at that point.
  ALLOWED_STATES: [
    { code: "AL", name: "Alabama" },
    { code: "AK", name: "Alaska" },
    { code: "AZ", name: "Arizona" },
    { code: "AR", name: "Arkansas" },
    { code: "CA", name: "California" },
    { code: "CO", name: "Colorado" },
    { code: "CT", name: "Connecticut" },
    { code: "DE", name: "Delaware" },
    { code: "DC", name: "District of Columbia" },
    { code: "FL", name: "Florida" },
    { code: "GA", name: "Georgia" },
    { code: "HI", name: "Hawaii" },
    { code: "ID", name: "Idaho" },
    { code: "IL", name: "Illinois" },
    { code: "IN", name: "Indiana" },
    { code: "IA", name: "Iowa" },
    { code: "KS", name: "Kansas" },
    { code: "KY", name: "Kentucky" },
    { code: "LA", name: "Louisiana" },
    { code: "ME", name: "Maine" },
    { code: "MD", name: "Maryland" },
    { code: "MA", name: "Massachusetts" },
    { code: "MI", name: "Michigan" },
    { code: "MN", name: "Minnesota" },
    { code: "MS", name: "Mississippi" },
    { code: "MO", name: "Missouri" },
    { code: "MT", name: "Montana" },
    { code: "NE", name: "Nebraska" },
    { code: "NV", name: "Nevada" },
    { code: "NH", name: "New Hampshire" },
    { code: "NJ", name: "New Jersey" },
    { code: "NM", name: "New Mexico" },
    { code: "NY", name: "New York" },
    { code: "NC", name: "North Carolina" },
    { code: "ND", name: "North Dakota" },
    { code: "OH", name: "Ohio" },
    { code: "OK", name: "Oklahoma" },
    { code: "OR", name: "Oregon" },
    { code: "PA", name: "Pennsylvania" },
    { code: "RI", name: "Rhode Island" },
    { code: "SC", name: "South Carolina" },
    { code: "SD", name: "South Dakota" },
    { code: "TN", name: "Tennessee" },
    { code: "TX", name: "Texas" },
    { code: "UT", name: "Utah" },
    { code: "VT", name: "Vermont" },
    { code: "VA", name: "Virginia" },
    { code: "WA", name: "Washington" },
    { code: "WV", name: "West Virginia" },
    { code: "WI", name: "Wisconsin" },
    { code: "WY", name: "Wyoming" },
  ],

  // ---------------------------------------------------------------
  // TRACKING / COMPLIANCE INTEGRATIONS
  // ---------------------------------------------------------------
  // All disabled/empty by default. No IDs are fabricated. Fill in
  // real values before launch; js/app.js checks the *_ENABLED flags
  // before attempting to load any third-party script.
  TRACKING_SETTINGS: {
    GA4_MEASUREMENT_ID: "", // e.g. "G-XXXXXXXXXX" — PLACEHOLDER, not set
    META_PIXEL_ID: "", // PLACEHOLDER, not set
    GOOGLE_ADS_CONVERSION_ID: "", // PLACEHOLDER, not set
    GOOGLE_ADS_CONVERSION_LABEL: "", // PLACEHOLDER, not set

    TRUSTEDFORM_ENABLED: false, // flip true once script + field wiring is added
    JORNAYA_ENABLED: false, // flip true once LeadiD script is added
    RETREAVER_ENABLED: false, // flip true once Retreaver JS tag is added
  },
};

// Exposed as a global for this static, dependency-free build.
// If this project is ever migrated to a bundler/module system,
// swap this for `export default CONFIG;`.
if (typeof module !== "undefined" && module.exports) {
  module.exports = CONFIG;
}
