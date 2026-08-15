/**
 * Crash2Claim — /apply Recruitment Page Config
 * -----------------------------------------------------------------
 * Completely separate from js/config.js (the case-evaluation
 * funnel's config). Nothing in this file is read by app.js,
 * qualification.js, or payload.js, and nothing here ever touches
 * the case-evaluation Google Sheet. nnConsent language, disclosure
 * text, and the submission endpoint are all recruitment-specific.
 * -----------------------------------------------------------------
 */

var APPLY_CONFIG = {
  BRAND_NAME: "Crash2Claim",

  // Separate Netlify Function + separate Google Sheet from the
  // case-evaluation lead funnel. See netlify/functions/submit-story-application.js
  WEBHOOK_URL: "/.netlify/functions/submit-story-application",

  CAMPAIGN_NAME: "story_project_v1",

  PAYMENT_AMOUNT_LABEL: "$50",

  // Short version — shown directly under the hero, always visible
  // without scrolling.
  PAYMENT_DISCLOSURE_SHORT:
    "$50 paid to eligible, verified participants who complete the recorded interview and release. Applying does not guarantee selection or payment.",

  // Full version — shown in its own card before the application
  // starts. Exact six-step list must stay identical everywhere it
  // appears (hero, this card, the application, the release).
  PAYMENT_DISCLOSURE_FULL_INTRO:
    "Crash2Claim is looking for real people to participate in short recorded interviews about their auto accident experiences. Applying does not automatically qualify you for payment. To receive the $50 participant payment, you must:",

  PAYMENT_DISCLOSURE_STEPS: [
    "Meet Crash2Claim's participant eligibility criteria",
    "Be selected to participate",
    "Provide reasonable proof that your story is legitimate, if requested",
    "Complete any required pre-screen or verification step",
    "Sign the required participant release",
    "Complete the actual recorded interview",
  ],

  PAYMENT_DISCLOSURE_FULL_OUTRO:
    "The $50 is compensation for completing this process — not for applying, submitting information, having an accident, having a legal claim, hiring an attorney, receiving a settlement, or allowing your content to be published. Payment does not depend on whether your story is ultimately published or how Crash2Claim feels about it.",

  ELIGIBILITY_CRITERIA: [
    "You are 18 years of age or older",
    "You were personally involved in a real car, truck, or motorcycle accident",
    "You're able to describe your experience in a short recorded interview, in your own words",
    "You're comfortable with Crash2Claim recording that interview and, if you're selected and sign the required release, publishing it",
    "You're able to provide reasonable supporting proof that the accident occurred, if asked",
    "You meet any additional participant criteria Crash2Claim applies during review",
  ],

  VERIFICATION_HEADSUP:
    "If we're interested in your story, we may ask you to provide one reasonable form of documentation showing the accident occurred — for example, a police or accident report, insurance claim documentation, accident or damage photos, or repair documentation. We only ask for this from applicants we're seriously considering, and we only need one reasonable item, not everything on this list. Please redact or black out anything we don't need, such as your Social Security number, driver's license number, full insurance policy number, or unrelated medical or financial information.",

  // Recruitment-specific consent/acknowledgment — deliberately
  // separate from CONFIG.CONSENT_DISCLOSURE used by the
  // case-evaluation funnel. Version tag bumps independently.
  RECRUITMENT_CONSENT:
    "By checking this box and submitting my application, I confirm that I am 18 years of age or older, that the information I've provided is accurate to the best of my knowledge, and that I understand applying does not guarantee selection or payment. I understand that if I'm selected, I may be asked to provide reasonable proof that the accident occurred, complete a short pre-screen or verification step, sign a participant release, and complete a recorded interview before receiving the $50 participant payment. I understand this is a separate paid storytelling project and is not a request for legal advice or representation.",

  RECRUITMENT_CONSENT_VERSION: "v1",

  HOW_IT_WORKS: [
    { num: "1", label: "Apply" },
    { num: "2", label: "Verify, if selected" },
    { num: "3", label: "Interview" },
    { num: "4", label: "Get paid $50" },
  ],

  STATES: [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
    "Delaware","District of Columbia","Florida","Georgia","Hawaii","Idaho","Illinois",
    "Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts",
    "Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
    "New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota",
    "Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina",
    "South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington",
    "West Virginia","Wisconsin","Wyoming",
  ],
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = APPLY_CONFIG;
}
