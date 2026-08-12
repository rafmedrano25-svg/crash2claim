/**
 * Crash2Claim â€” Qualification Logic
 * -----------------------------------------------------------------
 * Deliberately isolated from the UI (js/app.js) and from styling.
 * Given a set of survey answers and a rules object (normally
 * CONFIG.QUALIFYING_RULES from js/config.js), returns either
 * "qualified" or "unqualified".
 *
 * Nothing here touches the DOM. This module can be unit tested in
 * plain Node with `require("./qualification.js")`.
 * -----------------------------------------------------------------
 */

/**
 * @param {Object} answers
 * @param {string[]} answers.injuries - e.g. ["whiplash"] or ["no_injury"]
 * @param {"yes"|"no"|"not_sure"} answers.at_fault
 * @param {boolean} answers.had_insurance
 * @param {boolean} answers.has_attorney
 * @param {string} answers.treatment_timing - e.g. "first_week" | "never" | ...
 * @param {Object} rules - CONFIG.QUALIFYING_RULES
 * @returns {"qualified"|"unqualified"}
 */
function evaluateQualification(answers, rules) {
  if (!answers || !rules) return "unqualified";

  if (rules.requireInjury) {
    var injuries = Array.isArray(answers.injuries) ? answers.injuries : [];
    var hasRealInjury = injuries.length > 0 && !(injuries.length === 1 && injuries[0] === "no_injury");
    if (!hasRealInjury) return "unqualified";
  }

  if (rules.requireAtFaultOther && answers.at_fault !== "yes") {
    return "unqualified";
  }

  if (rules.requireInsurance && answers.had_insurance !== true) {
    return "unqualified";
  }

  if (rules.disqualifyIfHasAttorney && answers.has_attorney === true) {
    return "unqualified";
  }

  if (
    Array.isArray(rules.excludedTreatmentTimings) &&
    rules.excludedTreatmentTimings.indexOf(answers.treatment_timing) !== -1
  ) {
    return "unqualified";
  }

  return "qualified";
}

/**
 * Returns a stable, machine-readable reason code for why a lead was
 * (or would be) disqualified â€” or "" if the lead qualifies. This does
 * NOT change qualification criteria in any way: it mirrors the exact
 * same rule checks, in the exact same order, as evaluateQualification()
 * above, so the reason returned always matches the rule that actually
 * caused evaluateQualification() to return "unqualified" for the same
 * answers/rules. evaluateQualification() itself is untouched.
 * @param {Object} answers
 * @param {Object} rules - CONFIG.QUALIFYING_RULES
 * @returns {string} one of "no_injury" | "not_other_party_fault" |
 *   "no_insurance" | "already_represented" | "treatment_timing_excluded" | ""
 */
function getDisqualificationReason(answers, rules) {
  if (!answers || !rules) return "";

  if (rules.requireInjury) {
    var injuries = Array.isArray(answers.injuries) ? answers.injuries : [];
    var hasRealInjury = injuries.length > 0 && !(injuries.length === 1 && injuries[0] === "no_injury");
    if (!hasRealInjury) return "no_injury";
  }

  if (rules.requireAtFaultOther && answers.at_fault !== "yes") {
    return "not_other_party_fault";
  }

  if (rules.requireInsurance && answers.had_insurance !== true) {
    return "no_insurance";
  }

  if (rules.disqualifyIfHasAttorney && answers.has_attorney === true) {
    return "already_represented";
  }

  if (
    Array.isArray(rules.excludedTreatmentTimings) &&
    rules.excludedTreatmentTimings.indexOf(answers.treatment_timing) !== -1
  ) {
    return "treatment_timing_excluded";
  }

  return "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluateQualification: evaluateQualification,
    getDisqualificationReason: getDisqualificationReason,
  };
}
