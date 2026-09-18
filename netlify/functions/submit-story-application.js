/**
 * Crash2Claim — Recruitment Application Submission Function
 * -----------------------------------------------------------------
 * Server-side ONLY. Handles /apply recruitment applications and
 * appends one row to a SEPARATE Google Sheet from the case-evaluation
 * lead funnel. Does not read from, write to, or otherwise touch
 * submit-lead.js or the case-evaluation Sheet in any way.
 *
 * Credentials come exclusively from Netlify environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL          (reused — same Google
 *                                          Cloud service account)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY    (reused)
 *   RECRUITMENT_SHEET_ID                  (NEW — separate spreadsheet
 *                                          for recruitment applicants,
 *                                          distinct from GOOGLE_SHEET_ID)
 * Nothing here is hard-coded, and none of these values are ever
 * sent back to the browser. No npm dependencies — Node's built-in
 * `crypto` and the platform's global `fetch` only, same as
 * submit-lead.js.
 * -----------------------------------------------------------------
 */

const crypto = require("crypto");

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Hard ceiling on the outbound TrustedForm Retain request (see
// retainTrustedFormCertificate() below) — an ActiveProspect outage or
// slow response must never be able to meaningfully delay the
// applicant's Crash2Claim submission. Not a retry budget: on timeout
// the call is simply abandoned and logged, never retried.
const RETAIN_REQUEST_TIMEOUT_MS = 5000;

// Column order MUST match the header row in the RECRUITMENT Google
// Sheet exactly. This is a completely separate column set from
// submit-lead.js's COLUMNS array.
//
// NEW (this revision) — two columns added, at two insertion points,
// as part of the qualification-flow update (recency window tightened
// to 12 months, case-status-gated attorney-representation question
// added, liability question added). The live Sheet's header row needs
// new columns inserted at each of these exact positions (not appended
// at the end):
//   1. "has_hired_attorney" — inserted between "situation_status" and
//      "interested_in_attorney" (this is where the attorney-
//      representation question sits in the flow: right after case
//      status, before the attorney-interest question).
//   2. "primary_fault" — inserted between "interested_in_attorney" and
//      "lead_status" (this is where the liability question sits in
//      the flow: right after attorney-interest, before the
//      HOT LEAD-only medical questions).
// Every column at or after "has_hired_attorney" shifts by 1 position;
// every column at or after "primary_fault" shifts by 1 further
// position (net +2 for everything from "lead_status" onward). No
// other columns move. lead_status is computed server-side in
// computeLeadStatus() below and is never read from the client
// payload.
//
// (Earlier revisions — "payment_intent" between "campaign" and
// "first_name"; "lead_status"/"injuries"/"medical_treatment_timing"/
// "had_car_insurance" between "interested_in_attorney" and
// "on_camera_comfort"; "interested_in_attorney" itself; and
// "server_submission_id"/"server_received_at" appended at the very
// end — are unchanged here.)
const COLUMNS = [
  "applicant_id",
  "application_date",
  "test_submission_label",
  "source",
  "campaign",
  "payment_intent", // answer to "If your interview is published, what would you do with the $50?"
  "first_name",
  "age_18_confirmation",
  "state",
  "accident_timeframe",
  "story_summary",
  "situation_status",
  "has_hired_attorney", // NEW — "Yes" / "No" / "" (blank unless recency within 12mo + situation_status = Still ongoing)
  "interested_in_attorney", // "Yes" / "No" / "" (blank unless has_hired_attorney = No)
  "primary_fault", // NEW — "Other person" / "Me" / "Not sure" / "" (blank unless interested_in_attorney = Yes)
  "lead_status", // server-computed "HOT LEAD" or "" (see computeLeadStatus())
  "injuries", // HOT LEAD only, comma-separated; "" otherwise
  "medical_treatment_timing", // NEW — HOT LEAD only; "" otherwise
  "had_car_insurance", // its question was removed in a later revision (see the append-only block below) — always "" going forward; column kept in place, unshifted
  "on_camera_comfort",
  "phone",
  "email",
  "applicant_status",
  "verification_status",
  "verification_type",
  "verification_date",
  "interview_status",
  "release_status",
  "payment_status",
  "content_status",
  "episode_number",
  "consent_given",
  "consent_timestamp",
  "consent_disclosure_shown",
  "consent_disclosure_version",
  "landing_page_url",
  "referrer",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "subid",
  "subid2",
  "gclid",
  "fbclid",
  "msclkid",
  "ttclid",
  "server_submission_id", // server-generated, authoritative (client applicant_id can't be trusted alone)
  "server_received_at", // server clock timestamp, authoritative
  // NEW (this revision) — appended at the very end rather than
  // inserted mid-table, so every existing column above keeps its
  // exact letter/position. Safest option: no reordering, no shifting,
  // no risk of misaligning historical rows against the new header.
  "address", // NEW — collected on the contact/payment page (Q8)
  "attorney_contact_consent", // NEW — "Yes"/"No", from the new consent step; independent of and separate from consent_given (Application Agreement)
  // NEW (this revision) — the old "Are you 18 or older?" Yes/No click
  // was replaced by a date-of-birth question; age_18_confirmation
  // (its existing column, position unchanged) is still populated the
  // same way it always was, now derived from the DOB client-side. This
  // column holds the raw DOB itself ("YYYY-MM-DD") as an additional,
  // append-only field — same safe pattern as address/attorney_contact_consent
  // above, so nothing existing shifts.
  "date_of_birth",
  // The old "Did you have car insurance when the accident happened?"
  // HOT LEAD-only question was removed entirely as of this revision.
  // Its column, "had_car_insurance" (see its position further up this
  // array, between medical_treatment_timing and on_camera_comfort), is
  // intentionally left in place rather than removed — removing/shifting
  // it would misalign every column after it against historical Sheet
  // rows. It will simply always be blank in every row submitted from
  // here forward.
  // NEW (TrustedForm integration) — appended at the very end, same
  // append-only pattern as every column above. ActiveProspect
  // TrustedForm compliance certificate URL, captured client-side for
  // EVERY applicant (see apply-app.js/apply-payload.js) — blank if
  // TrustedForm never loaded or never populated in time. Retention of
  // the certificate (the billed TrustedForm operation) is a separate,
  // HOT-LEAD-gated server-side step performed further down in this
  // file (see retainTrustedFormCertificate()) — it does not change
  // what is written to this column; the raw cert URL is written here
  // regardless of whether retention succeeds, fails, or is skipped.
  "trustedform_cert_url",
  // NEW (U.S. applicant verification) — appended at the very end,
  // same append-only pattern as every column above. Populated by
  // runUsVerification() (see below) and ONLY ever written for rows
  // that actually reach appendRow() — an application that fails
  // verification returns before appendRow() is ever called, so these
  // four columns are always "US" / "US" / "TRUE" / "TRUE" for every
  // row that exists in this Sheet.
  "ip_country", // ISO 3166-1 alpha-2 country code IPinfo Lite resolved for the applicant's originating IP (e.g. "US")
  "phone_country", // "US" when the phone passed NANP structural validation, "" otherwise (see validateUsPhoneStructure())
  "phone_valid", // "TRUE" / "FALSE" — result of validateUsPhoneStructure()
  "us_verification_passed", // "TRUE" / "FALSE" — the overall gate result (ip_country === "US" AND phone_valid)
];

// Duplicate-detection is keyed off these two columns. Resolved by
// COLUMNS index rather than hard-coded letters, so if a column is
// ever inserted/removed above, the duplicate check automatically
// keeps checking the right columns.
const PHONE_COLUMN_INDEX = COLUMNS.indexOf("phone");
const EMAIL_COLUMN_INDEX = COLUMNS.indexOf("email");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  var applicant;
  try {
    applicant = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }
  if (!applicant || typeof applicant !== "object") {
    return jsonResponse(400, { ok: false, error: "invalid_payload" });
  }

  // Traceability: every log line and response includes applicant_id
  // (a random, non-PII identifier generated client-side — see
  // apply-payload.js's generateApplicantId()) so a failure can always
  // be matched back to the specific submission attempt. Never logs
  // the applicant's name, phone, email, or story text.
  var applicantIdForLogging = (applicant && applicant.applicant_id) || "(missing)";

  // Phone validation — independent of, and prior to, everything else
  // below (including the Google credential/env checks), so a malformed
  // submission is rejected immediately and never reaches Sheets at
  // all. Never relies on the client's own validation (apply-app.js):
  // re-normalizes the same way — strip non-digits, then drop a leading
  // US "1" only when exactly 11 digits remain — and independently
  // requires exactly 10 digits remain. This only confirms the number
  // has a valid 10-digit structure; it does not verify the number is
  // real, active, or belongs to the applicant.
  var normalizedEmail = normalizeEmail(applicant.email);
  var normalizedPhone = normalizePhone(applicant.phone);
  if (normalizedPhone.length !== 10) {
    console.log("[submit-story-application] Rejected: invalid phone number after normalization. applicant_id=" + applicantIdForLogging);
    return jsonResponse(400, { ok: false, error: "invalid_phone" });
  }
  // The value written to the Sheet is always this normalized 10-digit
  // form — never whatever raw formatting the client sent — regardless
  // of what the client did or didn't normalize on its end.
  applicant.phone = normalizedPhone;

  // -----------------------------------------------------------------
  // U.S. applicant verification gate (see runUsVerification() and its
  // helpers further down this file). BOTH of the following must pass:
  //   1. The request's originating IP resolves to country "US" via a
  //      server-side IPinfo Lite lookup.
  //   2. The already-10-digit-normalized phone additionally passes
  //      full NANP structural validation (area code/exchange rules,
  //      not a known placeholder/fictional number).
  // This runs BEFORE the Google credential check, BEFORE any Sheets
  // access, BEFORE HOT LEAD classification, and BEFORE the TrustedForm
  // Retain call below — a failure here returns immediately with a
  // single generic response and none of that downstream logic ever
  // runs. The applicant is never told which of the two checks failed;
  // only the technical reason is logged server-side (see
  // verifyUsIp()/runUsVerification()) for diagnosis.
  // -----------------------------------------------------------------
  var verification = await runUsVerification(applicant, event, normalizedPhone, applicantIdForLogging);
  if (!verification.passed) {
    return jsonResponse(200, {
      ok: true,
      duplicate: false,
      usVerificationFailed: true,
      applicant_id: applicantIdForLogging,
    });
  }
  // Only reached when verification passed — these four values are
  // therefore always "US" / "US" / "TRUE" / "TRUE" for every row this
  // function ever writes (see the ip_country/phone_country/phone_valid/
  // us_verification_passed entries in COLUMNS above). Set directly on
  // `applicant` so buildRow()'s existing generic COLUMNS-driven mapping
  // (`applicant[key]`) picks them up with no special-casing needed,
  // same pattern already used for `applicant.phone` just above.
  applicant.ip_country = verification.ipCountry;
  applicant.phone_country = verification.phoneCountry;
  applicant.phone_valid = verification.phoneValid ? "TRUE" : "FALSE";
  applicant.us_verification_passed = "TRUE";

  var email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  var privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  var sheetId = process.env.RECRUITMENT_SHEET_ID;

  if (!email || !privateKeyRaw || !sheetId) {
    console.error("[submit-story-application] Missing one or more required environment variables.");
    return jsonResponse(500, { ok: false, error: "server_not_configured" });
  }

  var privateKey = normalizePrivateKey(privateKeyRaw);
  if (privateKey.indexOf("BEGIN PRIVATE KEY") === -1 && privateKey.indexOf("BEGIN RSA PRIVATE KEY") === -1) {
    console.error("[submit-story-application] GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY does not look like a valid PEM key after normalization (no BEGIN marker found).");
    return jsonResponse(500, { ok: false, error: "private_key_malformed" });
  }

  // Server-authoritative submission ID + timestamp. The client already
  // sends applicant_id/application_date, but those are client-generated
  // and can't be fully trusted (clock skew, replay, tampering). These
  // two are stamped here, at write time, and are what should be treated
  // as the source of truth for "when was this really received."
  var serverSubmissionId = "SRV-" + crypto.randomUUID();
  var serverReceivedAt = new Date().toISOString();

  try {
    var accessToken = await getGoogleAccessToken(email, privateKey);
    var sheetTabName = await getFirstSheetTitle(sheetId, accessToken);

    // Duplicate check: same email OR same phone as an existing row.
    // Fails OPEN — if the check itself errors (permissions, transient
    // API issue, etc.) we log it and fall through to a normal append
    // rather than blocking a legitimate applicant.
    var isDuplicate = false;
    try {
      isDuplicate = await checkForDuplicate(sheetId, sheetTabName, accessToken, normalizedEmail, normalizedPhone);
    } catch (dupErr) {
      console.error("[submit-story-application] Duplicate check failed, proceeding as non-duplicate. applicant_id=" + applicantIdForLogging + " reason=" + (dupErr && dupErr.message));
    }

    if (isDuplicate) {
      console.log("[submit-story-application] Duplicate detected, no row written. applicant_id=" + applicantIdForLogging);
      return jsonResponse(200, { ok: true, duplicate: true, applicant_id: applicantIdForLogging });
    }

    var row = buildRow(applicant, serverSubmissionId, serverReceivedAt);
    await appendRow(sheetId, sheetTabName, accessToken, row);

    // TrustedForm Retain — HOT LEAD only. lead_status here is
    // RECOMPUTED via the same authoritative computeLeadStatus()
    // already used in buildRow() above (never a client-supplied
    // value), and retention only runs when a certificate URL was
    // actually captured. This call is fully non-blocking: it's
    // awaited (so it completes before this function's execution
        // context can be frozen/recycled) but retainTrustedFormCertificate()

    // fully catches its own errors and never throws, so a Retain
    // failure can never change the response already determined above
    // (the applicant's row is already written by this point either way).
    var leadStatusForRetain = computeLeadStatus(applicant);
    if (leadStatusForRetain === "HOT LEAD" && applicant.trustedform_cert_url) {
      await retainTrustedFormCertificate(applicant.trustedform_cert_url, applicant, applicantIdForLogging);
    }

    return jsonResponse(200, { ok: true, duplicate: false, applicant_id: applicantIdForLogging });
  } catch (err) {
    console.error("[submit-story-application] Delivery failed. applicant_id=" + applicantIdForLogging + " reason=" + (err && err.message));
    return jsonResponse(502, { ok: false, error: "sheet_write_failed", applicant_id: applicantIdForLogging });
  }
};

// Lower-case + trim. Doesn't attempt full RFC validation — the client
// already requires a non-empty value; this just makes comparison
// case/whitespace-insensitive (Jane@X.com === jane@x.com).
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Digits only, then strip a leading US country code (1) so
// "+1 (512) 555-1234", "15125551234", and "512-555-1234" all
// normalize to the same 10-digit value for comparison.
function normalizePhone(phone) {
  var digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  return digits;
}

// -----------------------------------------------------------------
// U.S. applicant verification — server-side ONLY (see the gate call
// site in exports.handler above, right after phone normalization).
//
// Two independent checks, BOTH required:
//   1. verifyUsIp()               — originating IP resolves to "US"
//   2. validateUsPhoneStructure() — phone is structurally a valid
//                                   NANP/+1 number
//
// Fails CLOSED throughout: any missing IP, missing IPINFO_TOKEN,
// IPinfo error/timeout, or malformed IPinfo response is treated as a
// FAILED check, never a pass. Nothing here throws — every failure
// path returns a normal "not passed" result so the caller in
// exports.handler always gets a clean, awaitable answer.
// -----------------------------------------------------------------

// Hard ceiling on the outbound IPinfo Lite request, same philosophy
// as RETAIN_REQUEST_TIMEOUT_MS above — an IPinfo outage or slow
// response must never be able to meaningfully delay (or hang) an
// applicant's submission. No retry: on timeout the lookup is simply
// treated as failed (fails closed — see verifyUsIp() below).
var IPINFO_REQUEST_TIMEOUT_MS = 5000;

// Netlify's own documented source for the real client IP on a
// Function invocation: this header is set by Netlify's edge/proxy
// layer itself on every request that reaches a Function, reflecting
// the actual TCP connection IP — Netlify overwrites it regardless of
// what (if anything) a client sends claiming to be this header, so it
// cannot be spoofed by modifying the request. This is Netlify's own
// documented/recommended source of truth for this value.
//   Source: https://answers.netlify.com/t/is-the-client-ip-header-going-to-be-supported-long-term/11203
// x-forwarded-for is used only as a fallback if that header is ever
// unexpectedly absent. Its first entry is meant to be the original
// client, but — unlike the Netlify-owned header above — that chain
// can in principle be influenced before it reaches Netlify's edge, so
// it is intentionally the SECOND choice here, never the primary one.
// This function deliberately does NOT fall back to any other header
// (e.g. a bare "x-real-ip"), and does NOT trust anything that would
// resolve to Netlify's own server/edge IP rather than the applicant's.
function getClientIp(event) {
  var headers = (event && event.headers) || {};
  var direct = headers["x-nf-client-connection-ip"] || headers["X-NF-Client-Connection-IP"];
  if (direct && String(direct).trim()) return String(direct).trim();

  var xff = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  if (xff) {
    var first = String(xff).split(",")[0].trim();
    if (first) return first;
  }
  return "";
}

// IPinfo Lite (https://ipinfo.io/developers/lite-api) — the free,
// country-level tier of IPinfo's API. Queried directly against the
// specific applicant IP determined by getClientIp() above (never the
// "/lite/me" self-lookup shortcut, which would resolve to Netlify's
// own outbound IP rather than the applicant's). IPINFO_TOKEN is read
// exclusively from the Netlify environment (process.env) and is never
// included in any response body, log line, or the data written to
// the Sheet.
//
// SCOPE NOTE: IPinfo Lite provides country-level geolocation and
// basic ASN/organization info only — it does NOT detect VPNs,
// proxies, hosting/datacenter IPs, or other anonymization services,
// and this function makes no such claim. It is intentionally kept as
// a single, isolated "does this IP resolve to US?" check so that a
// dedicated VPN/proxy/privacy-detection provider could be layered in
// later as an additional, separate check without rewriting this
// function or the gate that calls it.
async function verifyUsIp(ip, applicantIdForLogging) {
  if (!ip) {
    console.error("[submit-story-application] US verification: no client IP could be determined. applicant_id=" + applicantIdForLogging);
    return { passed: false, countryCode: "" };
  }

  var token = process.env.IPINFO_TOKEN;
  if (!token) {
    console.error("[submit-story-application] US verification: IPINFO_TOKEN is not configured. applicant_id=" + applicantIdForLogging);
    return { passed: false, countryCode: "" };
  }

  try {
    var url = "https://api.ipinfo.io/lite/" + encodeURIComponent(ip) + "?token=" + encodeURIComponent(token);
    var res = await fetch(url, {
      // No retry — an IPinfo outage or slow response must never be
      // able to meaningfully delay the applicant. On timeout this
      // simply fails closed, same as every other failure path below.
      signal: AbortSignal.timeout(IPINFO_REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("[submit-story-application] US verification: IPinfo request failed. applicant_id=" + applicantIdForLogging + " http_status=" + res.status);
      return { passed: false, countryCode: "" };
    }

    var data = await res.json();
    var countryCode = data && typeof data.country_code === "string" ? data.country_code.trim().toUpperCase() : "";
    if (!countryCode) {
      console.error("[submit-story-application] US verification: IPinfo response missing/malformed country_code. applicant_id=" + applicantIdForLogging);
      return { passed: false, countryCode: "" };
    }

    return { passed: countryCode === "US", countryCode: countryCode };
  } catch (err) {
    var reason = err && err.name === "TimeoutError" ? "timed_out_after_" + IPINFO_REQUEST_TIMEOUT_MS + "ms" : (err && err.message) || "unknown_error";
    console.error("[submit-story-application] US verification: IPinfo request threw or returned an unparseable response. applicant_id=" + applicantIdForLogging + " reason=" + reason);
    return { passed: false, countryCode: "" };
  }
}

// Known non-dialable / placeholder patterns — rejected even when they
// would otherwise pass the structural NANP checks in
// validateUsPhoneStructure() below. Covers the all-same-digit block
// (0000000000 ... 9999999999), the two obvious sequential runs, and
// NANPA's own reserved fictional-use block (555-0100 through
// 555-0199), which is set aside specifically so it is never assigned
// to a real subscriber and is the standard placeholder number used in
// film/TV/fiction.
function isPlaceholderUsPhoneNumber(digits10) {
  if (/^(\d)\1{9}$/.test(digits10)) return true; // all 10 digits identical
  if (digits10 === "1234567890" || digits10 === "0123456789" || digits10 === "9876543210") return true;
  var exchange = digits10.slice(3, 6);
  var line = digits10.slice(6, 10);
  if (exchange === "555" && line.charAt(0) === "0" && line.charAt(1) === "1") return true; // 555-01XX reserved fictional block
  return false;
}

// Structural NANP validation only — confirms the already-normalized
// 10-digit value is SHAPED like a valid U.S./+1 number: exactly 10
// digits, a valid area-code structure, a valid exchange-code
// structure, and not a known fictional/placeholder pattern. This does
// NOT verify the number is currently assigned, active, or actually
// owned/controlled by the applicant — confirming that would require a
// paid carrier-lookup API (e.g. Twilio Lookup), which is explicitly
// out of scope for this integration.
function validateUsPhoneStructure(digits10) {
  if (!/^[0-9]{10}$/.test(String(digits10 || ""))) return false;

  var areaCode = digits10.slice(0, 3);
  var exchange = digits10.slice(3, 6);

  // NANP area code: first digit must be 2-9 (never 0 or 1), and the
  // second+third digits can't both be "1" (an "N11" area code is
  // reserved for service codes like 411/611/911 and never assigned as
  // a real geographic area code).
  if (areaCode.charAt(0) < "2") return false;
  if (areaCode.charAt(1) === "1" && areaCode.charAt(2) === "1") return false;

  // NANP exchange code: same first-digit rule and N11 restriction.
  if (exchange.charAt(0) < "2") return false;
  if (exchange.charAt(1) === "1" && exchange.charAt(2) === "1") return false;

  if (isPlaceholderUsPhoneNumber(digits10)) return false;

  return true;
}

// The single combined gate called from exports.handler. BOTH
// ipResult.passed and phoneValid must be true for the overall result
// to pass. Also returns everything needed to populate the four new
// append-only Sheet columns (ip_country/phone_country/phone_valid/
// us_verification_passed) — the caller only writes those when
// `passed` is true (see the gate call site above), but the raw values
// are computed here regardless so the one log line below always shows
// the full picture for diagnosis.
async function runUsVerification(applicant, event, normalizedPhone, applicantIdForLogging) {
  var ip = getClientIp(event);
  var ipResult = await verifyUsIp(ip, applicantIdForLogging);
  var phoneValid = validateUsPhoneStructure(normalizedPhone);
  var passed = ipResult.passed && phoneValid;

  if (!passed) {
    console.log(
      "[submit-story-application] US verification FAILED — application not submitted downstream (no Sheets write, no HOT LEAD, no TrustedForm Retain). applicant_id=" + applicantIdForLogging +
      " ip_country=" + (ipResult.countryCode || "(undetermined)") +
      " phone_valid=" + phoneValid
    );
  }

  return {
    passed: passed,
    ipCountry: ipResult.countryCode || "",
    phoneCountry: phoneValid ? "US" : "",
    phoneValid: phoneValid,
  };
}

function columnIndexToLetter(index) {
  var letter = "";
  var n = index + 1;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// Reads the phone and email columns (row 2 onward, skipping the
// header) and checks whether the incoming normalized email or phone
// matches any existing row. One batchGet covers both columns.
async function checkForDuplicate(sheetId, sheetTabName, accessToken, normalizedEmail, normalizedPhone) {
  if (!normalizedEmail && !normalizedPhone) return false;

  var phoneLetter = columnIndexToLetter(PHONE_COLUMN_INDEX);
  var emailLetter = columnIndexToLetter(EMAIL_COLUMN_INDEX);
  var phoneRange = sheetTabName + "!" + phoneLetter + "2:" + phoneLetter;
  var emailRange = sheetTabName + "!" + emailLetter + "2:" + emailLetter;

  var url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    sheetId +
    "/values:batchGet?ranges=" +
    encodeURIComponent(phoneRange) +
    "&ranges=" +
    encodeURIComponent(emailRange);

  var res = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (!res.ok) {
    throw new Error("duplicate_check_read_failed_" + res.status);
  }
  var data = await res.json();
  var valueRanges = (data && data.valueRanges) || [];
  var existingPhones = flattenColumn(valueRanges[0]);
  var existingEmails = flattenColumn(valueRanges[1]);

  var phoneMatch = normalizedPhone && existingPhones.some(function (p) {
    return normalizePhone(p) === normalizedPhone;
  });
  var emailMatch = normalizedEmail && existingEmails.some(function (e) {
    return normalizeEmail(e) === normalizedEmail;
  });

  return !!(phoneMatch || emailMatch);
}

function flattenColumn(valueRange) {
  var rows = (valueRange && valueRange.values) || [];
  return rows.map(function (r) {
    return (r && r[0]) || "";
  });
}

// HOT LEAD (authoritative definition) = ALL of the following:
//   1. Age: age_18_confirmation is exactly "Yes". Verified HERE,
//      server-side, independently of client-side routing — a
//      manipulated/direct payload that satisfies every other
//      condition below but is under 18 (or omits/falsifies this
//      field) must never receive HOT LEAD. This is the
//      authoritative/source-of-truth check; the client-side age gate
//      in apply-app.js (which stops an underage applicant before they
//      can even reach the later questions) is a UX convenience only
//      and is never trusted on its own.
//   2. Recency: accident_timeframe is "Within the last 6 months" OR
//      "Within the last year" (a 12-month window — "Over a year ago"
//      never qualifies).
//   3. Case status: situation_status is exactly "Still ongoing" (only
//      "Settled" disqualifies). "Not sure" was removed as a case-
//      status answer as of this revision — SITUATION_OPTIONS in
//      apply-app.js now offers only "Settled"/"Still ongoing", so the
//      client can no longer send "Not sure" — but this check still
//      rejects it (or any other value) too, same defense-in-depth
//      posture as the liability check below, so a manipulated/replayed
//      payload with a stale "Not sure" value is never accepted.
//   4. Attorney representation: has_hired_attorney is "No".
//   5. Attorney intent: interested_in_attorney is "Yes".
//   6. Liability: primary_fault is exactly "Other person" — "Me"
//      disqualifies. The client's LIABILITY_OPTIONS no longer offers
//      "Not sure" as of an earlier revision, but this check still
//      rejects it (or any other value) too, same as it always has —
//      nothing here assumes the client only ever sends one of two
//      values.
// Medical answers (injuries / medical_treatment_timing /
// had_car_insurance) and the on-camera-comfort answer are pure data
// collection and never participate in this calculation, so a HOT LEAD
// stays a HOT LEAD regardless of what they answer there. Computed
// here, server-side, at submission time — a lead_status value is
// never read from the client payload, so there is nothing for a
// tampered/spoofed browser value to override. Every other applicant
// gets "" (never "Cold Lead", "Not Qualified", or any other label).
function computeLeadStatus(applicant) {
  var isAdult = applicant.age_18_confirmation === "Yes";
  var recentEnough = applicant.accident_timeframe === "Within the last 6 months" || applicant.accident_timeframe === "Within the last year";
  var qualifyingStatus = applicant.situation_status === "Still ongoing";
  var noAttorney = applicant.has_hired_attorney === "No";
  var wantsAttorney = applicant.interested_in_attorney === "Yes";
  var otherPersonAtFault = applicant.primary_fault === "Other person";
  return isAdult && recentEnough && qualifyingStatus && noAttorney && wantsAttorney && otherPersonAtFault ? "HOT LEAD" : "";
}

// -----------------------------------------------------------------
// TrustedForm Retain (ActiveProspect) — server-side ONLY, HOT LEAD-only.
//
// Called from the handler above only when computeLeadStatus() (this
// exact function, never a client-supplied value) returns "HOT LEAD"
// AND a non-blank trustedform_cert_url was captured. Fully
// non-blocking by design: every failure path below only logs — it
// never throws out of this function, so it can never turn an
// otherwise-successful application submission into an error response,
// and it never affects what was already written to the Sheet.
//
// API surface used (ActiveProspect TrustedForm Certificate API v4.0 —
// "Run Certificate Operations"):
//   Endpoint: POST <trustedform_cert_url> (the full certificate URL
//     captured client-side, e.g. https://cert.trustedform.com/<cert_id>
//     — this API is invoked by POSTing directly to that URL, there is
//     no separate/different endpoint to construct).
//   Headers: Content-Type: application/json, Accept: application/json,
//     Api-Version: 4.0 (explicitly forced to the current v4.0 schema
//     regardless of the account's dashboard-configured default),
//     Authorization: HTTP Basic — username "API" (ignored by
//     ActiveProspect, any value works), password = TRUSTEDFORM_API_KEY.
//   Body: { retain: { reference, vendor }, match_lead: { email, phone } }
//     — match_lead is REQUIRED whenever retain is requested per
//     ActiveProspect's own docs ("The match_lead operation is required
//     when running the retain operation"), so this is always included,
//     never optional, whenever this function runs.
//   Success: HTTP 200 with a JSON body containing a top-level `outcome`
//     ("success"/"failure"/"error" — best-practice signal for whether
//     to treat the lead as valid; a "failure" on match_lead does NOT
//     un-retain the certificate, per ActiveProspect: "The result of the
//     match_lead operation does not impact the behavior of the retain
//     operation"), plus `retain.results` (expires_at, masked_cert_url,
//     previously_retained) and `match_lead.result` (email_match,
//     phone_match, success).
//   Errors: 400 (malformed cert id/body), 401 (bad API key), 402
//     (account inactive/out of funds), 403 (operation unavailable on
//     this plan — Retain requires Self-Service plan or higher), 404
//     (certificate expired or not found), 405 (sandboxed certificate —
//     cannot be claimed), 422 (certificate claimed too many times).
//   Source (fetched directly, current as of this integration):
//     https://developers.activeprospect.com/api-reference/claims_api-v4.yaml
//     https://developers.activeprospect.com/api-reference/certificate-url/run-certificate-operations
//     https://support.activeprospect.com/hc/en-us/articles/44098371450388-Retain-API-Operation
//     https://support.activeprospect.com/hc/en-us/articles/44098159891860-Certificate-API-Version-4-0
async function retainTrustedFormCertificate(certUrl, applicant, applicantIdForLogging) {
  var apiKey = process.env.TRUSTEDFORM_API_KEY;
  if (!apiKey) {
    console.error("[submit-story-application] TrustedForm Retain skipped: TRUSTEDFORM_API_KEY is not configured. applicant_id=" + applicantIdForLogging);
    return;
  }
  // match_lead requires email and/or phone. Both are always-required
  // fields earlier in the application flow, so in practice both should
  // always be present by the time this runs — this check is a
  // defensive guard, not an expected path.
  if (!applicant.email && !applicant.phone) {
    console.error("[submit-story-application] TrustedForm Retain skipped: match_lead requires email and/or phone, both missing. applicant_id=" + applicantIdForLogging);
    return;
  }

  var matchLead = {};
  if (applicant.email) matchLead.email = applicant.email;
  if (applicant.phone) matchLead.phone = applicant.phone;

  var requestBody = {
    retain: {
      reference: applicant.applicant_id || applicantIdForLogging,
      vendor: "Crash2Claim",
    },
    match_lead: matchLead,
  };

  try {
    var res = await fetch(certUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Api-Version": "4.0",
        "Authorization": "Basic " + Buffer.from("API:" + apiKey).toString("base64"),
      },
      body: JSON.stringify(requestBody),
      // Aborts the request if ActiveProspect hasn't responded within
      // RETAIN_REQUEST_TIMEOUT_MS. No retry — the catch block below
      // just logs and returns, exactly like any other Retain failure.
      signal: AbortSignal.timeout(RETAIN_REQUEST_TIMEOUT_MS),
    });

    var responseText = await res.text();
    var parsed = null;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      parsed = null;
    }

    if (!res.ok) {
      console.error(
        "[submit-story-application] TrustedForm Retain failed. applicant_id=" + applicantIdForLogging +
        " http_status=" + res.status +
        " outcome=" + (parsed && parsed.outcome) +
        " reason=" + (parsed && parsed.reason) +
        " raw=" + responseText.slice(0, 300)
      );
      return;
    }

    var retainResults = parsed && parsed.retain && parsed.retain.results;
    var matchLeadResult = parsed && parsed.match_lead && parsed.match_lead.result;
    console.log(
      "[submit-story-application] TrustedForm Retain succeeded. applicant_id=" + applicantIdForLogging +
      " outcome=" + (parsed && parsed.outcome) +
      " previously_retained=" + (retainResults && retainResults.previously_retained) +
      " expires_at=" + (retainResults && retainResults.expires_at) +
      " match_lead_success=" + (matchLeadResult && matchLeadResult.success)
    );
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named
    // "TimeoutError" — distinguished here only so the log line clearly
    // says "timed out" rather than the generic message below. Both
    // branches behave identically otherwise: log only, return, never
    // throw, never retry, never touch the applicant's response.
    if (err && err.name === "TimeoutError") {
      console.error("[submit-story-application] TrustedForm Retain timed out after " + RETAIN_REQUEST_TIMEOUT_MS + "ms. applicant_id=" + applicantIdForLogging);
    } else {
      console.error("[submit-story-application] TrustedForm Retain request threw. applicant_id=" + applicantIdForLogging + " reason=" + (err && err.message));
    }
  }
}

// Formats a raw ISO 8601 UTC timestamp (e.g. "2026-08-23T11:25:36.069Z")
// as "MM/DD/YYYY h:mm AM/PM" in America/New_York local time, for the
// "server_received_at" Sheet column only. Uses Intl.DateTimeFormat's
// IANA timezone support so EST/EDT (daylight saving) is handled
// automatically — no hardcoded UTC offset. Seconds/milliseconds are
// dropped intentionally (not part of the requested display format).
// This only changes what's WRITTEN to the sheet; the raw ISO value
// (serverReceivedAt, generated in the handler) is left untouched and
// is still what's passed around internally.
function formatEasternTimestamp(isoString) {
  var date = new Date(isoString);
  var parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  var map = {};
  parts.forEach(function (p) {
    map[p.type] = p.value;
  });
  return map.month + "/" + map.day + "/" + map.year + " " + map.hour + ":" + map.minute + " " + map.dayPeriod;
}

function buildRow(applicant, serverSubmissionId, serverReceivedAt) {
  return COLUMNS.map(function (key) {
    if (key === "test_submission_label") {
      return applicant.test_submission ? "TEST" : "LIVE";
    }
    if (key === "server_submission_id") return serverSubmissionId;
    if (key === "server_received_at") return formatEasternTimestamp(serverReceivedAt);
    if (key === "lead_status") return computeLeadStatus(applicant);
    var value = applicant[key];
    if (Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Same private-key normalization as submit-lead.js — handles the
// realistic variations a service-account key can arrive in via a
// Netlify environment variable. Safe no-op on an already-clean key.
function normalizePrivateKey(raw) {
  var key = String(raw || "").trim();

  if ((key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') ||
      (key.charAt(0) === "'" && key.charAt(key.length - 1) === "'")) {
    key = key.slice(1, -1);
  }

  key = key.replace(/\\n/g, "\n");
  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  key = key.trim();
  if (key.charAt(key.length - 1) !== "\n") {
    key += "\n";
  }
  return key;
}

async function getGoogleAccessToken(clientEmail, privateKey) {
  var nowSeconds = Math.floor(Date.now() / 1000);
  var header = { alg: "RS256", typ: "JWT" };
  var claims = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  var unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));

  var signature;
  try {
    var signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    signature = signer
      .sign(privateKey)
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  } catch (signErr) {
    throw new Error("jwt_signing_failed: " + (signErr && signErr.message));
  }

  var assertion = unsigned + "." + signature;

  var body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: assertion,
  });

  var res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    var detail = "error=non_json_response";
    try {
      var rawBody = await res.text();
      try {
        var parsedBody = JSON.parse(rawBody);
        var googleErrorCode = (parsedBody && parsedBody.error) || "";
        var googleErrorDescription = (parsedBody && parsedBody.error_description) || "";
        if (googleErrorCode || googleErrorDescription) {
          detail = "error=" + (googleErrorCode || "unknown") + (googleErrorDescription ? " description=" + googleErrorDescription : "");
        }
      } catch (parseErr) {
        detail = "error=non_json_response";
      }
    } catch (readErr) {
      detail = "error=body_read_failed";
    }

    throw new Error("token_request_failed_" + res.status + " " + detail);
  }
  var data = await res.json();
  if (!data.access_token) {
    throw new Error("token_missing_in_response");
  }
  return data.access_token;
}

async function getFirstSheetTitle(sheetId, accessToken) {
  var url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    sheetId +
    "?fields=" +
    encodeURIComponent("sheets.properties.title");

  var res = await fetch(url, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!res.ok) {
    throw new Error("sheet_metadata_failed_" + res.status);
  }
  var data = await res.json();
  var title = data && data.sheets && data.sheets[0] && data.sheets[0].properties && data.sheets[0].properties.title;
  if (!title) {
    throw new Error("sheet_tab_not_found");
  }
  return title;
}

async function appendRow(sheetId, sheetTabName, accessToken, row) {
  var range = encodeURIComponent(sheetTabName + "!A1");
  var url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    sheetId +
    "/values/" +
    range +
    ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";

  var res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [row] }),
  });

  if (!res.ok) {
    var text = await res.text();
    throw new Error("sheets_append_failed_" + res.status + ": " + text.slice(0, 300));
  }
}

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  };
}

// Test-only export surface (mirrors the pattern used in config-apply.js
// and apply-payload.js). Netlify only ever calls exports.handler at
// runtime — these extra exports just let the pure normalization /
// duplicate-matching logic be unit-tested directly.
if (typeof module !== "undefined" && module.exports) {
  module.exports.normalizeEmail = normalizeEmail;
  module.exports.normalizePhone = normalizePhone;
  module.exports.columnIndexToLetter = columnIndexToLetter;
  module.exports.checkForDuplicate = checkForDuplicate;
  module.exports.computeLeadStatus = computeLeadStatus;
  module.exports.COLUMNS = COLUMNS;
  module.exports.formatEasternTimestamp = formatEasternTimestamp;
  module.exports.buildRow = buildRow;
  module.exports.retainTrustedFormCertificate = retainTrustedFormCertificate;
  module.exports.getClientIp = getClientIp;
  module.exports.verifyUsIp = verifyUsIp;
  module.exports.isPlaceholderUsPhoneNumber = isPlaceholderUsPhoneNumber;
  module.exports.validateUsPhoneStructure = validateUsPhoneStructure;
  module.exports.runUsVerification = runUsVerification;
}
