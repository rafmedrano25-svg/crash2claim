/**
 * Crash2Claim — /apply Recruitment Page Configuration
 * -----------------------------------------------------------------
 * Fully independent from js/config.js (the case-evaluation funnel's
 * config). Nothing here is read by, or feeds into, the case-eval
 * survey, its qualification logic, its lead scoring, or its Sheet.
 * -----------------------------------------------------------------
 */

var APPLY_CONFIG = {
  BRAND_NAME: "Crash2Claim",

  // Netlify Function endpoint for THIS system only.
  WEBHOOK_URL: "/.netlify/functions/submit-story-application",

  CAMPAIGN_NAME: "story_project_v1",

  PAYMENT_AMOUNT_LABEL: "$50",

  // Short line shown directly under the hero.
  PAYMENT_DISCLOSURE_SHORT:
    "$50 is paid only to selected participants whose completed recorded interview is accepted by Crash2Claim for publication. Applying, being selected to interview, or completing a recording does not guarantee payment.",

  // "How the $50 payment works" card — intro sentence.
  PAYMENT_DISCLOSURE_FULL_INTRO:
    "Applying does not guarantee selection or payment. To receive the $50:",

  // "How the $50 payment works" card — ordered steps.
  // As of this revision the pre-screen step has been removed (5 items,
  // was 6). This array is the single source of truth for BOTH the Q8
  // "$50 requirements" box in the application flow (apply-app.js
  // q8Template()) and the landing-page "How the $50 payment works"
  // card (populated inline in apply.html) — changing it here updates
  // both surfaces identically, by design.
  PAYMENT_DISCLOSURE_STEPS: [
    "Meet Crash2Claim's participant criteria",
    "Be selected to participate",
    "Sign the participant release",
    "Complete the recorded interview",
    "Have the completed recorded interview accepted by Crash2Claim for publication",
  ],

  // "How the $50 payment works" card — closing sentence.
  PAYMENT_DISCLOSURE_FULL_OUTRO:
    "$50 is paid only for completed recordings accepted for publication. Payment is not based on settlement amount, claim outcome, attorney choice, or expressing any particular opinion.",

  // "Who we're looking for" card.
  ELIGIBILITY_CRITERIA: [
    "You're 18 or older",
    "You were personally involved in a real car, truck, or motorcycle accident",
    "You're comfortable sharing your experience in a short recorded interview",
  ],

  // Recruitment-specific consent (separate from CONFIG.CONSENT_DISCLOSURE
  // used on the case-evaluation funnel). Shown on the dedicated
  // consent step (see qConsentTemplate() in apply-app.js), not Q8 —
  // and stored verbatim in consent_disclosure_shown, same as before.
  // As of this revision the consent page was condensed to a single
  // checkbox; this value holds the universal "Application Agreement"
  // paragraph shown to every applicant. The HOT-LEAD-only attorney
  // paragraph shown above it for HOT LEAD applicants is NOT tracked
  // via this config value — its acceptance is still evidenced by
  // attorney_contact_consent being "Yes" in apply-payload.js,
  // correlated with the same consent_timestamp/consent_given.
  RECRUITMENT_CONSENT:
    "I confirm that I am 18 or older, the information I provided is accurate, and I understand that applying does not guarantee an interview, publication, or payment. The $50 payment is earned only if Crash2Claim accepts my completed recorded interview for publication. Crash2Claim is not a law firm and does not provide legal advice.",

  RECRUITMENT_CONSENT_VERSION: "v8",

  // Four-step "how it works" strip. Keeps "Verify" (the pre-screen step
  // still exists in the process) and combines the final step into
  // "Review / Get Paid" so the strip itself signals that payment
  // follows a review, not automatic completion.
  HOW_IT_WORKS: [
    { num: "1", label: "Apply" },
    { num: "2", label: "Verify" },
    { num: "3", label: "Interview" },
    { num: "4", label: "Review / Get Paid" },
  ],

  STATES: [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
    "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
    "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
    "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
    "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
    "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
    "Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia",
  ],
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = APPLY_CONFIG;
}
