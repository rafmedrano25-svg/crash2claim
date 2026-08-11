/**
 * Crash2Claim — Validation Helpers
 * -----------------------------------------------------------------
 * Small, pure, dependency-free validators used by js/app.js. Kept
 * separate so they're easy to unit test and reuse.
 * -----------------------------------------------------------------
 */

function isValidEmail(value) {
  if (!value) return false;
  // Pragmatic RFC-5322-ish check — good enough for a lead form,
  // deliberately not exhaustive.
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(String(value).trim());
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidUSPhone(value) {
  var digits = digitsOnly(value);
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.substring(1);
  }
  if (digits.length !== 10) return false;
  // Reject obviously fake sequences like all-zero area codes.
  if (/^0/.test(digits) || /^1/.test(digits)) return false;
  return true;
}

/**
 * Formats digits as the user types into (555) 555-5555.
 */
function formatUSPhone(value) {
  var digits = digitsOnly(value).substring(0, 10);
  var len = digits.length;
  if (len === 0) return "";
  if (len < 4) return "(" + digits;
  if (len < 7) return "(" + digits.substring(0, 3) + ") " + digits.substring(3);
  return "(" + digits.substring(0, 3) + ") " + digits.substring(3, 6) + "-" + digits.substring(6);
}

function isValidZip(value) {
  return /^\d{5}$/.test(String(value || "").trim());
}

function isNonEmpty(value) {
  return String(value || "").trim().length > 0;
}

/**
 * Accepts either a real date (yyyy-mm-dd from <input type="date">)
 * or a short free-text approximation ("mid July", "about 2 weeks
 * ago") since Question 1 allows an approximate date. Just guards
 * against a blank submission.
 */
function isValidAccidentDate(value) {
  return isNonEmpty(value);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isValidEmail: isValidEmail,
    isValidUSPhone: isValidUSPhone,
    formatUSPhone: formatUSPhone,
    digitsOnly: digitsOnly,
    isValidZip: isValidZip,
    isNonEmpty: isNonEmpty,
    isValidAccidentDate: isValidAccidentDate,
  };
}
