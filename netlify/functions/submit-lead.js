/**
 * Crash2Claim — Lead Submission Function
 * -----------------------------------------------------------------
 * Server-side ONLY. Runs on Netlify's infrastructure, never in the
 * visitor's browser. Receives the lead JSON payload the frontend
 * already builds (see payload.js), authenticates to the Google
 * Sheets API as a service account, and appends one row to the
 * master lead spreadsheet.
 *
 * Credentials come exclusively from Netlify environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *   GOOGLE_SHEET_ID
 * Nothing here is hard-coded, and none of these values are ever
 * sent back to the browser. No npm dependencies are required — this
 * uses Node's built-in `crypto` module and the platform's global
 * `fetch` to talk to Google directly over HTTPS.
 * -----------------------------------------------------------------
 */

const crypto = require("crypto");

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Column order MUST match the header row in the Google Sheet exactly.
// The first 29 columns are the original, working set — untouched, same
// order. New tracking fields are APPENDED at the end only, so existing
// columns never shift position.
const COLUMNS = [
  "timestamp",
  "test_lead_label",
  "qualification_status",
  "first_name",
  "last_name",
  "phone",
  "email",
  "settlement_intent",
  "accident_date",
  "vehicle_type",
  "injuries",
  "treatment_timing",
  "at_fault",
  "had_insurance",
  "has_attorney",
  "consent_given",
  "consent_disclosure_shown",
  "consent_timestamp",
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
  // --- appended tracking-audit additions (see crash2claim-tracking-audit.md) ---
  "lead_id",
  "disqualification_reason",
  "msclkid",
  "ttclid",
  "consent_source",
  "consent_disclosure_version",
];

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  var lead;
  try {
    lead = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { ok: false, error: "invalid_json" });
  }
  if (!lead || typeof lead !== "object") {
    return jsonResponse(400, { ok: false, error: "invalid_payload" });
  }

  var email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  var privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  var sheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !privateKeyRaw || !sheetId) {
    console.error("[submit-lead] Missing one or more required environment variables.");
    return jsonResponse(500, { ok: false, error: "server_not_configured" });
  }

  var privateKey = normalizePrivateKey(privateKeyRaw);
  if (privateKey.indexOf("BEGIN PRIVATE KEY") === -1 && privateKey.indexOf("BEGIN RSA PRIVATE KEY") === -1) {
    // Fails fast with a clear, safe diagnosis instead of letting a
    // malformed key fail mysteriously inside the crypto layer or at
    // Google's server. Never logs the key value itself.
    console.error("[submit-lead] GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY does not look like a valid PEM key after normalization (no BEGIN marker found).");
    return jsonResponse(500, { ok: false, error: "private_key_malformed" });
  }

  // Traceability: every log line and response below includes lead_id
  // (a random, non-PII identifier generated client-side — see
  // payload.js's generateLeadId()) so a failure can always be matched
  // back to the specific submission attempt, even though a failed
  // attempt never produces a Sheet row. Never logs the lead's name,
  // phone, email, or any other personal detail.
  var leadIdForLogging = (lead && lead.lead_id) || "(missing)";

  try {
    var accessToken = await getGoogleAccessToken(email, privateKey);
    var sheetTabName = await getFirstSheetTitle(sheetId, accessToken);
    var row = buildRow(lead);
    await appendRow(sheetId, sheetTabName, accessToken, row);
    return jsonResponse(200, { ok: true, lead_id: leadIdForLogging });
  } catch (err) {
    console.error("[submit-lead] Delivery failed. lead_id=" + leadIdForLogging + " reason=" + (err && err.message));
    return jsonResponse(502, { ok: false, error: "sheet_write_failed", lead_id: leadIdForLogging });
  }
};

function buildRow(lead) {
  return COLUMNS.map(function (key) {
    if (key === "test_lead_label") {
      return lead.test_lead ? "TEST" : "LIVE";
    }
    var value = lead[key];
    if (Array.isArray(value)) return value.join(", ");
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Handles the realistic variations a service-account private key can
// arrive in via a Netlify environment variable:
//   - Pasted from a downloaded JSON key file, where newlines appear
//     as the two literal characters \ and n (most common case).
//   - Pasted with a stray leading/trailing quote character.
//   - Actual CRLF line endings instead of LF.
// All three are safe no-ops if the value is already a clean PEM
// string, so this never changes a value that was already correct.
function normalizePrivateKey(raw) {
  var key = String(raw || "").trim();

  if ((key.charAt(0) === '"' && key.charAt(key.length - 1) === '"') ||
      (key.charAt(0) === "'" && key.charAt(key.length - 1) === "'")) {
    key = key.slice(1, -1);
  }

  key = key.replace(/\\n/g, "\n"); // literal backslash-n -> real newline
  key = key.replace(/\r\n/g, "\n").replace(/\r/g, "\n"); // normalize CRLF/CR -> LF

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
    // Never log the key itself — only that signing failed, which
    // almost always means the private key value isn't valid PEM.
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
    // Build the diagnostic detail directly into the thrown Error's
    // message (rather than a separate console.error call) so the
    // single existing catch block in exports.handler — which already
    // logs "[submit-lead] Delivery failed: " + err.message — is
    // guaranteed to display it. No second log line to go missing.
    //
    // Only Google's own safe OAuth fields (error / error_description)
    // and the HTTP status are ever included. Never the private key,
    // the JWT/assertion, the access token, or any credential — and if
    // the response isn't parseable JSON, only a generic marker is
    // used instead of any raw response content.
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

// Looks up the first tab's name dynamically so this keeps working
// regardless of what the sheet tab happens to be called.
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
