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
const COLUMNS = [
  "applicant_id",
  "application_date",
  "test_submission_label",
  "source",
  "campaign",
  "first_name",
  "age_18_confirmation",
  "state",
  "accident_timeframe",
  "story_summary",
  "situation_status",
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
];

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

  // Traceability: every log line and response includes applicant_id
  // (a random, non-PII identifier generated client-side — see
  // js/apply-payload.js's generateApplicantId()) so a failure can
  // always be matched back to the specific submission attempt.
  // Never logs the applicant's name, phone, email, or story text.
  var applicantIdForLogging = (applicant && applicant.applicant_id) || "(missing)";

  try {
    var accessToken = await getGoogleAccessToken(email, privateKey);
    var sheetTabName = await getFirstSheetTitle(sheetId, accessToken);
    var row = buildRow(applicant);
    await appendRow(sheetId, sheetTabName, accessToken, row);
    return jsonResponse(200, { ok: true, applicant_id: applicantIdForLogging });
  } catch (err) {
    console.error("[submit-story-application] Delivery failed. applicant_id=" + applicantIdForLogging + " reason=" + (err && err.message));
    return jsonResponse(502, { ok: false, error: "sheet_write_failed", applicant_id: applicantIdForLogging });
  }
};

function buildRow(applicant) {
  return COLUMNS.map(function (key) {
    if (key === "test_submission_label") {
      return applicant.test_submission ? "TEST" : "LIVE";
    }
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
