
Config apply · JS
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
  PAYMENT_DISCLOSURE_STEPS: [
    "Meet Crash2Claim's participant criteria",
    "Be selected to participate",
    "Complete any required pre-screen",
    "Sign the participant release",
    "Complete the recorded interview",
    "Have the completed recording accepted by Crash2Claim for publication",
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
  // used on the case-evaluation funnel). Shown at Q8 above the consent
  // checkbox, and stored verbatim in consent_disclosure_shown.
  RECRUITMENT_CONSENT:
    "By applying, I confirm I'm 18 or older and that the information I've provided is accurate to the best of my knowledge. I understand applying does not guarantee I'll be selected, invited to interview, or paid. If selected, I may be asked to complete a short pre-screen or verification step, sign a participant release, and complete a recorded interview. The $50 payment is earned only if Crash2Claim reviews my completed recording and accepts it for publication in the Crash2Claim content library; that decision is based on production and content suitability, not on my opinions, legal outcome, settlement amount, or attorney choice. By submitting, I agree that Crash2Claim may contact me regarding my accident story, potential participation in Crash2Claim content, and the recorded interview and publication opportunity described above. If I indicate that I am interested in speaking with an attorney about my case, I also consent to Crash2Claim sharing my submitted information with attorneys or legal service providers, who may then contact me regarding my accident or case. This is a separate, paid storytelling project and is not a request for legal advice, and is not part of Crash2Claim's accident case-evaluation service. Crash2Claim is not a law firm, does not provide legal advice or legal representation, and submitting this form does not itself create an attorney-client relationship.",
 
  RECRUITMENT_CONSENT_VERSION: "v6",
 
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
 
