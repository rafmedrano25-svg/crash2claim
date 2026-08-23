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

// Column order MUST match the header row in the RECRUITMENT Google
// Sheet exactly. This is a completely separate column set from
// submit-lead.js's COLUMNS array.
//
// NEW (this revision) — six columns added, at three insertion points.
// The live Sheet's header row needs new columns inserted at each of
// these exact positions (not appended at the end) — see the change
// summary for exactly what to add and where:
//   1. "payment_intent" — inserted between "campaign" and "first_name"
//      (it's the very first question every applicant answers).
//   2. "lead_status", "injuries", "medical_treatment_timing",
//      "had_car_insurance" — inserted between "interested_in_attorney"
//      and "on_camera_comfort" (this is where those questions sit in
//      the flow: right after the attorney question, before on-camera
//      comfort). lead_status is computed server-side in
//      computeLeadStatus() below and is never read from the client
//      payload.
// ("interested_in_attorney" itself, and "server_submission_id" /
// "server_received_at" appended at the very end, were added in an
// earlier revision and are unchanged here.)
const COLUMNS = [
  "applicant_id",
  "application_date",
  "test_submission_label",
  "source",
  "campaign",
  "payment_intent", // NEW — answer to "If your interview is published, what would you do with the $50?"
  "first_name",
  "age_18_confirmation",
  "state",
  "accident_timeframe",
  "story_summary",
  "situation_status",
  "interested_in_attorney", // "Yes" / "No" / "" (blank unless within 2yrs + still ongoing/not sure)
  "lead_status", // NEW — server-computed "HOT LEAD" or "" (see computeLeadStatus())
  "injuries", // NEW — HOT LEAD only, comma-separated; "" otherwise
  "medical_treatment_timing", // NEW — HOT LEAD only; "" otherwise
  "had_car_insurance", // NEW — HOT LEAD only; "" otherwise
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
  "server_submission_id", // NEW — server-generated, authoritative (client applicant_id can't be trusted alone)
  "server_received_at", // NEW — server clock timestamp, authoritative
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

// HOT LEAD = accident within the last 2 years AND situation is either
// "Still ongoing" OR "Not sure" AND applicant said Yes to speaking
// with an attorney. ALL THREE must be true (only "Settled" excludes
// the situation-status leg). Computed here, server-side, at
// submission time — a lead_status value is never read from the
// client payload, so there is nothing for a tampered/spoofed browser
// value to override. Every other applicant gets "" (never "Cold
// Lead", "Not Qualified", or any other label).
function computeLeadStatus(applicant) {
  var withinTwoYears = applicant.accident_timeframe === "Within the last 2 years";
  var qualifyingStatus = applicant.situation_status === "Still ongoing" || applicant.situation_status === "Not sure";
  var wantsAttorney = applicant.interested_in_attorney === "Yes";
  return withinTwoYears && qualifyingStatus && wantsAttorney ? "HOT LEAD" : "";
}

function buildRow(applicant, serverSubmissionId, serverReceivedAt) {
  return COLUMNS.map(function (key) {
    if (key === "test_submission_label") {
      return applicant.test_submission ? "TEST" : "LIVE";
    }
    if (key === "server_submission_id") return serverSubmissionId;
    if (key === "server_received_at") return serverReceivedAt;
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
}
