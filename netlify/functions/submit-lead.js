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

  // Netlify stores multi-line env values with literal backslash-n
  // sequences in some paste flows — convert them back to real
  // newlines so the PEM key parses correctly. If the value already
  // has real newlines, this is a harmless no-op.
  var privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  try {
    var accessToken = await getGoogleAccessToken(email, privateKey);
    var sheetTabName = await getFirstSheetTitle(sheetId, accessToken);
    var row = buildRow(lead);
    await appendRow(sheetId, sheetTabName, accessToken, row);
    return jsonResponse(200, { ok: true });
  } catch (err) {
    // Log only an error code/message server-side (visible to you in
    // Netlify's function logs), never the lead's personal details.
    console.error("[submit-lead] Delivery failed:", err && err.message);
    return jsonResponse(502, { ok: false, error: "sheet_write_failed" });
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
  var signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  var signature = signer
    .sign(privateKey)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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
    throw new Error("token_request_failed_" + res.status);
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
