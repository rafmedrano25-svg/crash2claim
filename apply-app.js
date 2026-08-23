const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const storyFn = require("./netlify/functions/submit-story-application.js");

const BASE = __dirname;
function readFile(p) { return fs.readFileSync(path.join(BASE, p), "utf8"); }

const html = `<!DOCTYPE html><html><head>
<style>body.app-mode .apply-landing-only { display: none; }</style>
</head><body>
<div class="apply-test-banner" id="applyTestBanner" style="display:none;"></div>
<section class="apply-landing-only" id="landingHero">
  <p class="apply-hero-disclaimer" id="heroDisclaimer"></p>
  <button type="button" id="startApplyBtn"></button>
</section>
<div class="apply-steps apply-landing-only" id="howItWorks"></div>
<main id="applyRoot"></main>
<div class="apply-info-card apply-landing-only">
  <ul id="eligibilityList"></ul>
</div>
<div class="apply-info-card apply-landing-only">
  <p id="disclosureIntro"></p>
  <ol id="disclosureSteps"></ol>
  <p id="disclosureOutro"></p>
</div>
</body></html>`;

async function boot(urlSuffix, fetchResponse) {
  const dom = new JSDOM(html, {
    url: "https://crash2claim.com/apply.html" + (urlSuffix || ""),
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  // Production file layout is flat at the repo root (no js/ or css/
  // subdirectory for these files) — read from the same root-level
  // filenames apply.html actually references.
  const attribution = readFile("attribution.js");
  const configApply = readFile("config-apply.js");
  const applyPayload = readFile("apply-payload.js");
  const applyApp = readFile("apply-app.js");

  const footer = `
    if (typeof window !== 'undefined') {
      if (typeof ATTRIBUTION_KEYS !== 'undefined') window.ATTRIBUTION_KEYS = ATTRIBUTION_KEYS;
      if (typeof captureAttribution !== 'undefined') window.captureAttribution = captureAttribution;
      if (typeof getAttribution !== 'undefined') window.getAttribution = getAttribution;
      if (typeof APPLY_CONFIG !== 'undefined') window.APPLY_CONFIG = APPLY_CONFIG;
      if (typeof generateApplicantId !== 'undefined') window.generateApplicantId = generateApplicantId;
      if (typeof buildApplicationPayload !== 'undefined') window.buildApplicationPayload = buildApplicationPayload;
    }
  `;

  const combined = [attribution, configApply, applyPayload, applyApp, footer].join("\n;\n");

  // Stub fetch so handleSubmit's network call resolves deterministically.
  // Default response mirrors a normal (non-duplicate) server accept;
  // individual tests can pass fetchResponse = { duplicate: true } etc.
  // to simulate the server's duplicate-detection response (see
  // netlify/functions/submit-story-application.js / test_duplicate_detection.js
  // for the actual duplicate-matching logic, tested separately there).
  const body = fetchResponse || { duplicate: false };
  // Records every submitted request (url + parsed JSON body) so tests
  // can assert on exactly what was sent to the server — in particular,
  // the phone-validation tests below check the normalized value that
  // actually gets submitted, not just whether the thank-you screen
  // renders.
  dom.fetchCalls = [];
  dom.window.fetch = function (url, opts) {
    dom.fetchCalls.push({
      url: url,
      body: opts && opts.body ? JSON.parse(opts.body) : null,
    });
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve(body);
      },
    });
  };
  // jsdom doesn't implement scrollTo; stub it so the layout-only
  // scroll-to-top calls are no-ops instead of noisy "not implemented" logs.
  dom.window.scrollTo = function () {};

  dom.window.eval(combined);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  return dom;
}

function click(dom, id) {
  const el = dom.window.document.getElementById(id);
  if (!el) throw new Error("missing element #" + id);
  el.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
}
function setVal(dom, id, val) {
  const el = dom.window.document.getElementById(id);
  if (!el) throw new Error("missing element #" + id);
  el.value = val;
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
function check(dom, id, checked) {
  const el = dom.window.document.getElementById(id);
  if (!el) throw new Error("missing element #" + id);
  el.checked = checked;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function text(dom, sel) {
  const el = dom.window.document.querySelector(sel);
  return el ? el.textContent : null;
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL: " + msg);
    failures++;
  } else {
    console.log("PASS: " + msg);
  }
}

// Shared helper: click Start, answer the opening $50-use question (any
// option — defaults to the first), then drive through Q1–Q5 (name,
// age, state, timeframe, story) up to the point where Q6 (situation
// status) is about to be answered. timeframeOptIndex: 0 = "Within the
// last 2 years", 1 = "More than 2 years ago".
async function driveToQ6(dom, firstName, state, timeframeOptIndex, paymentIntentOptIndex) {
  click(dom, "startApplyBtn");
  click(dom, "qPaymentIntentOpt" + (paymentIntentOptIndex === undefined ? 0 : paymentIntentOptIndex));
  setVal(dom, "q1Input", firstName);
  click(dom, "q1Continue");
  click(dom, "q2Yes");
  setVal(dom, "q3Input", state);
  click(dom, "q3Continue");
  click(dom, "q4Opt" + timeframeOptIndex);
  setVal(dom, "q5Input", "Test story for automated scenario testing.");
  click(dom, "q5Continue");
}

(async () => {
  // ---------------------------------------------------------------
  // TEST 0 — CSS-level checks (styles-apply.css raw text) for the
  // global .apply-answer-btn centering change and the new
  // .apply-attorney-disclosure rule. jsdom's test DOM here is built
  // from raw HTML strings without loading styles-apply.css, so
  // computed-style assertions aren't possible in the scenarios below
  // — this checks the actual shipped rule text instead.
  // ---------------------------------------------------------------
  {
    const css = readFile("styles-apply.css");
    const answerBtnBlock = css.slice(css.indexOf(".apply-answer-btn {"), css.indexOf(".apply-answer-btn.selected"));
    assert(answerBtnBlock.indexOf("text-align: center;") !== -1, "T0: .apply-answer-btn is centered (shared by all standard answer buttons)");
    assert(answerBtnBlock.indexOf("text-align: left;") === -1, "T0: .apply-answer-btn no longer left-aligns text");

    const checkboxCardBlock = css.slice(css.indexOf(".apply-checkbox-card {"), css.indexOf(".apply-checkbox-card.selected"));
    assert(checkboxCardBlock.indexOf("text-align") === -1, "T0: .apply-checkbox-card (injuries multi-select) untouched by the centering change — it's a flex layout, not text-align-based");

    const disclosureStart = css.indexOf(".apply-attorney-disclosure {");
    const disclosureBlock = css.slice(disclosureStart, css.indexOf("}", disclosureStart) + 1);
    assert(disclosureBlock.indexOf("border") === -1, "T0: .apply-attorney-disclosure has no border");
    assert(disclosureBlock.indexOf("background") === -1, "T0: .apply-attorney-disclosure has no background box");
    assert(disclosureBlock.indexOf("font-size: 11px;") !== -1, "T0: .apply-attorney-disclosure is small (11px), matching .apply-footer-disclaimer's fine-print treatment");
    assert(disclosureBlock.indexOf("font-weight: 400;") !== -1, "T0: .apply-attorney-disclosure is normal weight (not bold)");
    assert(disclosureBlock.indexOf("var(--gray-400)") !== -1, "T0: .apply-attorney-disclosure uses the muted gray-400 token");
  }

  // ---------------------------------------------------------------
  // TEST 1 — opening $50-use question renders first; age gate: answering
  // "No" to 18+ stops the flow
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    click(dom, "startApplyBtn");
    assert(!!dom.window.document.getElementById("qPaymentIntentOpt0"), "T1: opening $50-use question renders first, before name/age/etc.");
    click(dom, "qPaymentIntentOpt0");
    assert(!!dom.window.document.getElementById("q1Input"), "T1: Q1 (first name) renders after the opening question");
    setVal(dom, "q1Input", "Jordan");
    click(dom, "q1Continue");
    assert(!!dom.window.document.getElementById("q2Yes"), "T1: Q2 (18+) renders after Q1");
    click(dom, "q2No");
    const title = text(dom, ".apply-thankyou-title");
    assert(title === "Thanks for your interest", "T1: answering No to 18+ shows the age-gate stop screen, not the application");
    assert(!dom.window.document.getElementById("q3Input"), "T1: flow does not continue to Q3 after age-gate stop");
  }

  // ---------------------------------------------------------------
  // TEST 2 — full HOT LEAD happy path: opening question -> unsettled
  // case -> attorney question -> all 3 HOT LEAD questions -> payload
  // shape -> thank-you screen.
  // ---------------------------------------------------------------
  {
    const dom = await boot("?utm_source=facebook&utm_campaign=story_test&fbclid=abc123");
    dom.window.captureAttribution();

    click(dom, "startApplyBtn");
    click(dom, "qPaymentIntentOpt1"); // "Pay a bill"
    setVal(dom, "q1Input", "Taylor");
    click(dom, "q1Continue");
    click(dom, "q2Yes");
    setVal(dom, "q3Input", "Texas");
    click(dom, "q3Continue");
    click(dom, "q4Opt0"); // "Within the last 2 years"
    setVal(dom, "q5Input", "Rear-ended at a red light, minor whiplash.");
    click(dom, "q5Continue");
    click(dom, "q6Opt1"); // "Still ongoing" -> attorney question appears next
    assert(!!dom.window.document.getElementById("qAttorneyOpt0"), "T2: attorney-interest question appears after an unsettled situation_status answer");
    click(dom, "qAttorneyOpt0"); // "Yes" -> HOT LEAD -> injuries/treatment/insurance appear next
    assert(!!dom.window.document.getElementById("qInjuriesOpt0"), "T2: injuries question appears for a HOT LEAD applicant");
    check(dom, "qInjuriesOpt0", true); // "Back or neck pain"
    check(dom, "qInjuriesOpt2", true); // "Cuts or bruises"
    click(dom, "qInjuriesContinue");
    assert(!!dom.window.document.getElementById("qTreatmentOpt0"), "T2: medical treatment timing question appears next");
    click(dom, "qTreatmentOpt0"); // "Within the first week"
    assert(!!dom.window.document.getElementById("qInsuranceOpt0"), "T2: car insurance question appears next");
    click(dom, "qInsuranceOpt0"); // "Yes"
    click(dom, "q7Opt0"); // "Yes" (on-camera comfort)
    setVal(dom, "q8Phone", "5125551234");
    setVal(dom, "q8Email", "taylor@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");

    await new Promise((r) => setTimeout(r, 30));

    const title = text(dom, ".apply-thankyou-title");
    assert(title === "Application received.", "T2: full HOT LEAD happy path reaches the thank-you screen");

    const payload = dom.window.buildApplicationPayload(
      {
        payment_intent: "Pay a bill",
        first_name: "Taylor",
        is_18: true,
        state: "Texas",
        accident_timeframe: "Within the last 2 years",
        story_summary: "Rear-ended at a red light, minor whiplash.",
        situation_status: "Still ongoing",
        interested_in_attorney: true,
        injuries: ["Back or neck pain", "Cuts or bruises"],
        medical_treatment_timing: "Within the first week",
        had_car_insurance: "Yes",
        on_camera_comfort: "Yes",
        phone: "5125551234",
        email: "taylor@example.com",
        consent: true,
        consent_timestamp: new Date().toISOString(),
      },
      dom.window.generateApplicantId(),
      false
    );

    assert(/^APP-/.test(payload.applicant_id), "T2: applicant_id is prefixed APP- (never mistakable for lead_id)");
    assert(payload.applicant_status === "New", "T2: applicant_status defaults to New");
    assert(payload.verification_status === "Not Requested", "T2: verification_status defaults to Not Requested");
    assert(payload.interview_status === "Not Scheduled", "T2: interview_status defaults to Not Scheduled");
    assert(payload.release_status === "Not Sent", "T2: release_status defaults to Not Sent");
    assert(payload.payment_status === "Not Eligible Yet", "T2: payment_status defaults to Not Eligible Yet");
    assert(payload.content_status === "Not Started", "T2: content_status defaults to Not Started");
    assert(payload.payment_intent === "Pay a bill", "T2: payment_intent is captured in the payload");
    assert(payload.interested_in_attorney === "Yes", "T2: interested_in_attorney is 'Yes' in the payload");
    assert(Array.isArray(payload.injuries) && payload.injuries.length === 2, "T2: injuries is an array of the selected labels");
    assert(payload.medical_treatment_timing === "Within the first week", "T2: medical_treatment_timing is captured");
    assert(payload.had_car_insurance === "Yes", "T2: had_car_insurance is captured");
    assert(!("lead_status" in payload), "T2: payload never includes lead_status — it is computed server-side only");
    assert(payload.consent_disclosure_shown === dom.window.APPLY_CONFIG.RECRUITMENT_CONSENT, "T2: consent_disclosure_shown exactly matches the displayed recruitment consent text");
    assert(payload.consent_disclosure_version === "v6", "T2: consent_disclosure_version is v6 (bumped for the attorney-client-relationship clause)");
    assert(payload.consent_disclosure_shown.indexOf("attorneys or legal service providers") !== -1, "T2: consent text covers attorney/legal-provider sharing");
    assert(payload.consent_disclosure_shown.indexOf("who may then contact me") !== -1, "T2: consent text states attorneys/legal providers may contact the applicant");
    assert(payload.consent_disclosure_shown.indexOf("not a law firm") !== -1, "T2: consent text still states Crash2Claim is not a law firm");
    assert(payload.consent_disclosure_shown.indexOf("does not itself create an attorney-client relationship") !== -1, "T2: consent text states submitting the form does not itself create an attorney-client relationship");
    assert(payload.utm_source === "facebook", "T2: utm_source captured from URL");
    assert(payload.utm_campaign === "story_test", "T2: utm_campaign captured from URL");
    assert(payload.fbclid === "abc123", "T2: fbclid captured from URL");
    assert(payload.test_submission === false, "T2: test_submission is false when not in test mode");
    assert(!("qualification_status" in payload), "T2: payload has NO qualification_status field (proves no overlap with case-eval schema)");
    assert(!("lead_id" in payload), "T2: payload has NO lead_id field (proves no overlap with case-eval schema)");

    // Server-side lead_status computation (never trusts a browser value).
    const leadStatus = storyFn.computeLeadStatus({
      accident_timeframe: "Within the last 2 years",
      situation_status: "Still ongoing",
      interested_in_attorney: "Yes",
    });
    assert(leadStatus === "HOT LEAD", "T2: server-side computeLeadStatus returns 'HOT LEAD' for this applicant's answers");
  }

  // ---------------------------------------------------------------
  // TEST 3 — test mode via ?test=1 flags the submission and shows banner
  // ---------------------------------------------------------------
  {
    const dom = await boot("?test=1");
    const banner = dom.window.document.getElementById("applyTestBanner");
    assert(banner.style.display === "block", "T3: test banner is shown when ?test=1 is present");

    const payload = dom.window.buildApplicationPayload(
      { first_name: "Test", is_18: true, state: "Ohio", accident_timeframe: "Within the last 2 years",
        story_summary: "Test story", situation_status: "Not sure", on_camera_comfort: "Yes",
        phone: "1234567890", email: "test@example.com", consent: true, consent_timestamp: new Date().toISOString() },
      dom.window.generateApplicantId(),
      true
    );
    assert(payload.test_submission === true, "T3: test_submission true when isTestMode passed through");
    assert(payload.interested_in_attorney === "", "T3: interested_in_attorney is blank when not supplied");
    assert(payload.payment_intent === "", "T3: payment_intent is blank when not supplied");
    assert(Array.isArray(payload.injuries) && payload.injuries.length === 0, "T3: injuries defaults to an empty array when not supplied");
    assert(payload.medical_treatment_timing === "" && payload.had_car_insurance === "", "T3: HOT LEAD-only fields default to blank when not supplied");
  }

  // ---------------------------------------------------------------
  // TEST 4 — Q7 "No" (not comfortable on camera) still completes the application
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    click(dom, "startApplyBtn");
    click(dom, "qPaymentIntentOpt0");
    setVal(dom, "q1Input", "Sam");
    click(dom, "q1Continue");
    click(dom, "q2Yes");
    setVal(dom, "q3Input", "Ohio");
    click(dom, "q3Continue");
    click(dom, "q4Opt0");
    setVal(dom, "q5Input", "Sideswiped on the highway.");
    click(dom, "q5Continue");
    click(dom, "q6Opt0");
    click(dom, "q7Opt2"); // "No"
    assert(!!dom.window.document.getElementById("q8Phone"), "T4: answering No to on-camera comfort still proceeds to Q8 (not disqualified)");
  }

  // ---------------------------------------------------------------
  // TEST 5 — application mode: landing sections hide, progress bar
  // reflects the exact required percentages (base total is now 9,
  // since the opening $50-use question adds one question ahead of the
  // previous 8), back preserves answers
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    const win = dom.window;
    const doc = win.document;

    assert(!win.document.body.classList.contains("app-mode"), "T5: app-mode is NOT active before Start Your Application is clicked");
    assert(win.getComputedStyle(doc.getElementById("landingHero")).display !== "none", "T5: landing hero is visible before application starts");

    click(dom, "startApplyBtn");

    assert(win.document.body.classList.contains("app-mode"), "T5: app-mode class is added when Start Your Application is clicked");
    assert(win.getComputedStyle(doc.getElementById("landingHero")).display === "none", "T5: landing hero is hidden once application mode starts");
    assert(win.getComputedStyle(doc.getElementById("howItWorks")).display === "none", "T5: Apply/Verify/Interview/Get Paid strip is hidden once application mode starts");
    assert(win.getComputedStyle(doc.querySelectorAll(".apply-info-card")[0]).display === "none", "T5: 'Who we're looking for' card is hidden once application mode starts");
    assert(win.getComputedStyle(doc.querySelectorAll(".apply-info-card")[1]).display === "none", "T5: 'How the $50 payment works' card is hidden once application mode starts");

    assert(text(dom, ".apply-app-eyebrow") === "Your Story Application", "T5: application-mode header shows 'Your Story Application'");
    assert(text(dom, ".apply-progress-row").indexOf("Question 1 of 9") !== -1, "T5: progress row shows 'Question 1 of 9' on the opening $50-use question");
    assert(text(dom, ".apply-progress-row").indexOf("11%") !== -1, "T5: progress row shows 11% on the opening question");
    assert(doc.querySelector(".apply-progress-fill").style.width === "11%", "T5: progress fill bar width is 11% on the opening question");

    click(dom, "qPaymentIntentOpt0");
    assert(text(dom, ".apply-progress-row").indexOf("Question 2 of 9") !== -1, "T5: progress row shows 'Question 2 of 9' on Q1 (name)");
    assert(text(dom, ".apply-progress-row").indexOf("22%") !== -1, "T5: progress row shows 22% on Q1");

    setVal(dom, "q1Input", "Riley");
    click(dom, "q1Continue");
    assert(text(dom, ".apply-progress-row").indexOf("Question 3 of 9") !== -1, "T5: progress row shows 'Question 3 of 9' on Q2 (18+)");
    assert(text(dom, ".apply-progress-row").indexOf("33%") !== -1, "T5: progress row shows 33% on Q2");

    click(dom, "q2Yes");
    assert(text(dom, ".apply-progress-row").indexOf("44%") !== -1, "T5: progress row shows 44% on Q3 (state)");
    setVal(dom, "q3Input", "Nevada");
    click(dom, "q3Continue");
    assert(text(dom, ".apply-progress-row").indexOf("55%") !== -1, "T5: progress row shows 55% on Q4 (timeframe)");

    // Back behavior: go back to Q3 and confirm the previously entered
    // state is still selected (answers remain populated).
    click(dom, "stepBack");
    assert(text(dom, ".apply-progress-row").indexOf("Question 4 of 9") !== -1, "T5: Back button returns to Q3 (state)");
    const stateSelect = doc.getElementById("q3Input");
    assert(stateSelect.value === "Nevada", "T5: previously entered answer (state) is still populated after navigating back");

    // App-mode persists through the rest of the flow (does not return
    // to the landing page) all the way to the thank-you screen.
    click(dom, "q3Continue");
    click(dom, "q4Opt1"); // "More than 2 years ago"
    setVal(dom, "q5Input", "Hit a guardrail in the rain.");
    click(dom, "q5Continue");
    click(dom, "q6Opt0"); // "Settled" — keeps this test on the 9-step (no attorney question) path
    click(dom, "q7Opt1");
    setVal(dom, "q8Phone", "6025559876");
    setVal(dom, "q8Email", "riley@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));

    assert(win.document.body.classList.contains("app-mode"), "T5: app-mode is still active on the thank-you screen (visitor is not returned to the landing page)");
    assert(win.getComputedStyle(doc.getElementById("landingHero")).display === "none", "T5: landing hero remains hidden on the thank-you screen");
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "T5: thank-you screen still renders correctly in application mode");
  }

  // =================================================================
  // SCENARIO A–L — the exact scenarios required by the $50-use question
  // + HOT LEAD branch spec (payment_intent, injuries, medical_treatment_
  // timing, had_car_insurance, server-computed lead_status).
  // =================================================================

  // ---------------------------------------------------------------
  // SCENARIO A — every applicant sees the $50-use question first.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    click(dom, "startApplyBtn");
    assert(!!dom.window.document.getElementById("qPaymentIntentOpt0"), "Scenario A: the $50-use question is the very first thing every applicant sees");
    assert(!dom.window.document.getElementById("q1Input"), "Scenario A: name/age/etc. do not render until the $50-use question is answered");
    assert(text(dom, ".apply-question").indexOf("$50") !== -1, "Scenario A: opening question text mentions the $50");
  }

  // ---------------------------------------------------------------
  // SCENARIO B — payment_intent is preserved all the way through submission.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    click(dom, "startApplyBtn");
    click(dom, "qPaymentIntentOpt3"); // "Save it"
    setVal(dom, "q1Input", "ScenarioB");
    click(dom, "q1Continue");
    click(dom, "q2Yes");
    setVal(dom, "q3Input", "Texas");
    click(dom, "q3Continue");
    click(dom, "q4Opt0");
    setVal(dom, "q5Input", "x");
    click(dom, "q5Continue");
    click(dom, "q6Opt0"); // "Settled"
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "5551110002");
    setVal(dom, "q8Email", "scenariob@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Scenario B: application submits normally");

    const payload = dom.window.buildApplicationPayload(
      { payment_intent: "Save it", first_name: "ScenarioB", is_18: true, state: "Texas",
        accident_timeframe: "Within the last 2 years", story_summary: "x", situation_status: "Settled",
        on_camera_comfort: "Yes", phone: "5551110002", email: "scenariob@example.com",
        consent: true, consent_timestamp: new Date().toISOString() },
      dom.window.generateApplicantId(), false
    );
    assert(payload.payment_intent === "Save it", "Scenario B: payment_intent is preserved all the way into the submitted payload");
  }

  // ---------------------------------------------------------------
  // SCENARIO B2 — Q1 now asks for full name (not just first name); a
  // full name with a space submits correctly into the existing
  // first_name backend field/payload key/Sheet column (unchanged).
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    click(dom, "startApplyBtn");
    click(dom, "qPaymentIntentOpt0");
    assert(text(dom, ".apply-question").indexOf("full name") !== -1, "Scenario B2: Q1 question text asks for full name");
    const q1El = dom.window.document.getElementById("q1Input");
    assert(!!q1El && q1El.placeholder === "Full name", "Scenario B2: Q1 input placeholder reads 'Full name'");
    setVal(dom, "q1Input", "Jordan Alexander Rivera");
    click(dom, "q1Continue");
    click(dom, "q2Yes");
    setVal(dom, "q3Input", "Texas");
    click(dom, "q3Continue");
    click(dom, "q4Opt0");
    setVal(dom, "q5Input", "x");
    click(dom, "q5Continue");
    click(dom, "q6Opt0"); // "Settled"
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "5551110022");
    setVal(dom, "q8Email", "scenariob2@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Scenario B2: full-name application submits normally");

    const payload = dom.window.buildApplicationPayload(
      { payment_intent: "Take my family to lunch", first_name: "Jordan Alexander Rivera", is_18: true, state: "Texas",
        accident_timeframe: "Within the last 2 years", story_summary: "x", situation_status: "Settled",
        on_camera_comfort: "Yes", phone: "5551110022", email: "scenariob2@example.com",
        consent: true, consent_timestamp: new Date().toISOString() },
      dom.window.generateApplicantId(), false
    );
    assert(payload.first_name === "Jordan Alexander Rivera", "Scenario B2: full name is stored in the existing first_name payload key, unchanged");
    assert(storyFn.COLUMNS.indexOf("first_name") !== -1, "Scenario B2: COLUMNS still uses the existing 'first_name' column key (not renamed)");
  }

  // ---------------------------------------------------------------
  // SCENARIO C — Within 2 years + Settled -> no attorney question, no HOT LEAD.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioC", "Texas", 0); // within 2 years
    click(dom, "q6Opt0"); // "Settled"
    assert(!dom.window.document.getElementById("qAttorneyOpt0"), "Scenario C: within 2 years + Settled does NOT show the attorney question");
    assert(!!dom.window.document.getElementById("q7Opt0"), "Scenario C: flow proceeds straight to the on-camera comfort question");
    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "Within the last 2 years", situation_status: "Settled", interested_in_attorney: "" });
    assert(leadStatus === "", "Scenario C: computeLeadStatus returns blank (not a HOT LEAD) for a settled case");
  }

  // ---------------------------------------------------------------
  // SCENARIO D — Within 2 years + Still ongoing -> attorney question DOES appear.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioD", "Texas", 0);
    click(dom, "q6Opt1"); // "Still ongoing"
    assert(!!dom.window.document.getElementById("qAttorneyOpt0"), "Scenario D: within 2 years + Still ongoing DOES show the attorney question");
  }

  // ---------------------------------------------------------------
  // SCENARIO D2 — attorney-interest disclosure fine print renders
  // verbatim, plain-text only (no wrapping badge/border markup), and
  // sits after the Back button in document order. Purely a copy/
  // presentation check — does not touch qualification logic.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioD2", "Texas", 0);
    click(dom, "q6Opt1"); // "Still ongoing"
    const disclosure = dom.window.document.querySelector(".apply-attorney-disclosure");
    assert(!!disclosure, "Scenario D2: attorney-interest disclosure element is present");
    assert(
      disclosure.textContent ===
        "If you select Yes, Crash2Claim may share your information with an independent attorney or legal service provider and may receive compensation for making the connection. Crash2Claim is not a law firm and does not provide legal advice.",
      "Scenario D2: disclosure text matches the approved copy exactly"
    );
    assert(disclosure.children.length === 0, "Scenario D2: disclosure is plain text only, no nested badge/border markup");
    const backBtn = dom.window.document.getElementById("stepBack");
    assert(!!backBtn && backBtn.nextElementSibling === disclosure, "Scenario D2: disclosure sits immediately after the Back button in document order");
  }

  // ---------------------------------------------------------------
  // SCENARIO E — Within 2 years + Still ongoing + No -> not HOT LEAD,
  // injuries/treatment/insurance questions are skipped entirely.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioE", "Texas", 0);
    click(dom, "q6Opt1"); // "Still ongoing"
    click(dom, "qAttorneyOpt1"); // "No"
    assert(!dom.window.document.getElementById("qInjuriesOpt0"), "Scenario E: answering No to the attorney question skips the injuries question");
    assert(!!dom.window.document.getElementById("q7Opt0"), "Scenario E: flow proceeds straight to the on-camera comfort question after No");
    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "Within the last 2 years", situation_status: "Still ongoing", interested_in_attorney: "No" });
    assert(leadStatus === "", "Scenario E: computeLeadStatus returns blank (not a HOT LEAD) when the applicant declines the attorney question");
  }

  // ---------------------------------------------------------------
  // SCENARIO F — Within 2 years + Still ongoing + Yes -> lead_status =
  // HOT LEAD; injuries, treatment, and insurance questions all appear
  // in order, then flow returns to the normal remaining questions.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioF", "Texas", 0);
    click(dom, "q6Opt1"); // "Still ongoing"
    click(dom, "qAttorneyOpt0"); // "Yes"
    assert(!!dom.window.document.getElementById("qInjuriesOpt0"), "Scenario F: injuries question appears for a HOT LEAD applicant");
    check(dom, "qInjuriesOpt1", true); // "Broken bones"
    click(dom, "qInjuriesContinue");
    assert(!!dom.window.document.getElementById("qTreatmentOpt0"), "Scenario F: medical treatment timing question appears next");
    click(dom, "qTreatmentOpt1"); // "More than a week later"
    assert(!!dom.window.document.getElementById("qInsuranceOpt0"), "Scenario F: car insurance question appears next");
    click(dom, "qInsuranceOpt1"); // "No"
    assert(!!dom.window.document.getElementById("q7Opt0"), "Scenario F: flow returns to the on-camera comfort question after the 3 HOT LEAD questions");

    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "Within the last 2 years", situation_status: "Still ongoing", interested_in_attorney: "Yes" });
    assert(leadStatus === "HOT LEAD", "Scenario F: computeLeadStatus returns 'HOT LEAD' when all three conditions are met");
  }

  // ---------------------------------------------------------------
  // SCENARIO G — More than 2 years ago + Still ongoing -> no attorney
  // question, no HOT LEAD (the accident age alone excludes it, even
  // though the case is still ongoing).
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioG", "Texas", 1); // more than 2 years ago
    click(dom, "q6Opt1"); // "Still ongoing"
    assert(!dom.window.document.getElementById("qAttorneyOpt0"), "Scenario G: more than 2 years ago + Still ongoing does NOT show the attorney question");
    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "More than 2 years ago", situation_status: "Still ongoing", interested_in_attorney: "" });
    assert(leadStatus === "", "Scenario G: computeLeadStatus returns blank when the accident is more than 2 years old");
  }

  // ---------------------------------------------------------------
  // SCENARIO H — Within 2 years + Not sure -> attorney question DOES
  // now appear (expanded gating: Still ongoing OR Not sure).
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioH", "Texas", 0);
    click(dom, "q6Opt2"); // "Not sure"
    assert(!!dom.window.document.getElementById("qAttorneyOpt0"), "Scenario H: within 2 years + Not sure DOES show the attorney question");
  }

  // ---------------------------------------------------------------
  // SCENARIO H2 — Within 2 years + Not sure + Attorney Yes -> HOT
  // LEAD; injuries/treatment/insurance questions all appear, then flow
  // returns to the normal remaining questions and submits normally.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioH2", "Texas", 0);
    click(dom, "q6Opt2"); // "Not sure"
    click(dom, "qAttorneyOpt0"); // "Yes"
    assert(!!dom.window.document.getElementById("qInjuriesOpt0"), "Scenario H2: injuries question appears for a HOT LEAD applicant (Not sure + Yes)");
    check(dom, "qInjuriesOpt1", true); // "Broken bones"
    click(dom, "qInjuriesContinue");
    assert(!!dom.window.document.getElementById("qTreatmentOpt0"), "Scenario H2: medical treatment timing question appears next");
    click(dom, "qTreatmentOpt1"); // "More than a week later"
    assert(!!dom.window.document.getElementById("qInsuranceOpt0"), "Scenario H2: car insurance question appears next");
    click(dom, "qInsuranceOpt1"); // "No"
    assert(!!dom.window.document.getElementById("q7Opt0"), "Scenario H2: flow returns to the on-camera comfort question after the 3 HOT LEAD questions");
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "5551110028");
    setVal(dom, "q8Email", "scenarioh2@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Scenario H2: HOT LEAD application (Not sure + Yes) submits normally");

    const payload = dom.window.buildApplicationPayload(
      { first_name: "ScenarioH2", is_18: true, state: "Texas", accident_timeframe: "Within the last 2 years",
        story_summary: "x", situation_status: "Not sure", interested_in_attorney: true,
        injuries: ["Broken bones"], medical_treatment_timing: "More than a week later", had_car_insurance: "No",
        on_camera_comfort: "Yes", phone: "5551110028", email: "scenarioh2@example.com",
        consent: true, consent_timestamp: new Date().toISOString() },
      dom.window.generateApplicantId(), false
    );
    assert(payload.situation_status === "Not sure", "Scenario H2: situation_status recorded as 'Not sure'");
    assert(payload.interested_in_attorney === "Yes", "Scenario H2: interested_in_attorney recorded as Yes");
    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "Within the last 2 years", situation_status: "Not sure", interested_in_attorney: "Yes" });
    assert(leadStatus === "HOT LEAD", "Scenario H2: computeLeadStatus returns 'HOT LEAD' for Not sure + within 2 years + attorney Yes");
  }

  // ---------------------------------------------------------------
  // SCENARIO H3 — Within 2 years + Not sure + Attorney No -> NOT a
  // HOT LEAD; injuries/treatment/insurance questions are skipped.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioH3", "Texas", 0);
    click(dom, "q6Opt2"); // "Not sure"
    click(dom, "qAttorneyOpt1"); // "No"
    assert(!dom.window.document.getElementById("qInjuriesOpt0"), "Scenario H3: answering No to the attorney question skips the injuries question");
    assert(!!dom.window.document.getElementById("q7Opt0"), "Scenario H3: flow proceeds straight to the on-camera comfort question after No");
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "5551110038");
    setVal(dom, "q8Email", "scenarioh3@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Scenario H3: application submits normally");

    const payload = dom.window.buildApplicationPayload(
      { first_name: "ScenarioH3", is_18: true, state: "Texas", accident_timeframe: "Within the last 2 years",
        story_summary: "x", situation_status: "Not sure", interested_in_attorney: false,
        on_camera_comfort: "Yes", phone: "5551110038", email: "scenarioh3@example.com",
        consent: true, consent_timestamp: new Date().toISOString() },
      dom.window.generateApplicantId(), false
    );
    assert(payload.situation_status === "Not sure", "Scenario H3: situation_status is still recorded as 'Not sure' for manual review");
    assert(payload.interested_in_attorney === "No", "Scenario H3: interested_in_attorney recorded as No");
    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "Within the last 2 years", situation_status: "Not sure", interested_in_attorney: "No" });
    assert(leadStatus === "", "Scenario H3: computeLeadStatus returns blank (not a HOT LEAD) when the applicant declines the attorney question");
  }

  // ---------------------------------------------------------------
  // SCENARIO H4 — More than 2 years ago + Not sure -> no attorney
  // question, no HOT LEAD (the accident age alone excludes it, exactly
  // as it already does for "Still ongoing" in Scenario G).
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioH4", "Texas", 1); // more than 2 years ago
    click(dom, "q6Opt2"); // "Not sure"
    assert(!dom.window.document.getElementById("qAttorneyOpt0"), "Scenario H4: more than 2 years ago + Not sure does NOT show the attorney question");
    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "More than 2 years ago", situation_status: "Not sure", interested_in_attorney: "" });
    assert(leadStatus === "", "Scenario H4: computeLeadStatus returns blank when the accident is more than 2 years old, even with 'Not sure'");
  }

  // ---------------------------------------------------------------
  // SCENARIO I — a full HOT LEAD application successfully records
  // injuries, medical treatment timing, insurance, attorney interest,
  // HOT LEAD status, contact information, consent, story answers, and
  // UTM/attribution, all together in one submission.
  // ---------------------------------------------------------------
  {
    const dom = await boot("?utm_source=google&utm_medium=cpc&utm_campaign=story_i&utm_content=ad1&utm_term=car+accident&subid=aff123&gclid=g123&fbclid=fb123&msclkid=ms123&ttclid=tt123");
    dom.window.captureAttribution();

    click(dom, "startApplyBtn");
    click(dom, "qPaymentIntentOpt0"); // "Take my family to lunch"
    setVal(dom, "q1Input", "ScenarioI");
    click(dom, "q1Continue");
    click(dom, "q2Yes");
    setVal(dom, "q3Input", "Texas");
    click(dom, "q3Continue");
    click(dom, "q4Opt0"); // within 2 years
    setVal(dom, "q5Input", "Full HOT LEAD scenario story.");
    click(dom, "q5Continue");
    click(dom, "q6Opt1"); // Still ongoing
    click(dom, "qAttorneyOpt0"); // Yes -> HOT LEAD
    check(dom, "qInjuriesOpt0", true); // "Back or neck pain"
    check(dom, "qInjuriesOpt3", true); // "Head injury"
    click(dom, "qInjuriesContinue");
    click(dom, "qTreatmentOpt0"); // "Within the first week"
    click(dom, "qInsuranceOpt0"); // "Yes"
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "5551110009");
    setVal(dom, "q8Email", "scenarioi@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Scenario I: HOT LEAD application submits normally");

    const payload = dom.window.buildApplicationPayload(
      { payment_intent: "Take my family to lunch", first_name: "ScenarioI", is_18: true, state: "Texas",
        accident_timeframe: "Within the last 2 years", story_summary: "Full HOT LEAD scenario story.",
        situation_status: "Still ongoing", interested_in_attorney: true,
        injuries: ["Back or neck pain", "Head injury"], medical_treatment_timing: "Within the first week",
        had_car_insurance: "Yes", on_camera_comfort: "Yes", phone: "5551110009", email: "scenarioi@example.com",
        consent: true, consent_timestamp: new Date().toISOString() },
      dom.window.generateApplicantId(), false
    );
    assert(payload.payment_intent === "Take my family to lunch", "Scenario I: payment_intent recorded");
    assert(payload.interested_in_attorney === "Yes", "Scenario I: interested_in_attorney recorded as Yes");
    assert(Array.isArray(payload.injuries) && payload.injuries.join(", ") === "Back or neck pain, Head injury", "Scenario I: injuries recorded");
    assert(payload.medical_treatment_timing === "Within the first week", "Scenario I: medical_treatment_timing recorded");
    assert(payload.had_car_insurance === "Yes", "Scenario I: had_car_insurance recorded");
    assert(payload.consent_given === true, "Scenario I: consent recorded");
    assert(payload.story_summary === "Full HOT LEAD scenario story.", "Scenario I: story answers recorded");
    assert(payload.phone === "5551110009" && payload.email === "scenarioi@example.com", "Scenario I: contact information recorded");
    assert(payload.utm_source === "google", "Scenario I: utm_source preserved");
    assert(payload.utm_medium === "cpc", "Scenario I: utm_medium preserved");
    assert(payload.utm_campaign === "story_i", "Scenario I: utm_campaign preserved");
    assert(payload.utm_content === "ad1", "Scenario I: utm_content preserved");
    assert(payload.utm_term === "car accident", "Scenario I: utm_term preserved");
    assert(payload.subid === "aff123", "Scenario I: subid preserved");
    assert(payload.gclid === "g123", "Scenario I: gclid preserved");
    assert(payload.fbclid === "fb123", "Scenario I: fbclid preserved");
    assert(payload.msclkid === "ms123", "Scenario I: msclkid preserved");
    assert(payload.ttclid === "tt123", "Scenario I: ttclid preserved");
    assert(payload.landing_page_url, "Scenario I: landing_page_url is captured");

    const leadStatus = storyFn.computeLeadStatus({ accident_timeframe: "Within the last 2 years", situation_status: "Still ongoing", interested_in_attorney: "Yes" });
    assert(leadStatus === "HOT LEAD", "Scenario I: server-side computeLeadStatus confirms HOT LEAD status alongside all the other recorded data");

    // Confirm the Sheet's COLUMNS array (the actual row-order source of
    // truth) includes every new field this revision adds.
    assert(storyFn.COLUMNS.indexOf("lead_status") !== -1, "Scenario I: COLUMNS includes lead_status");
    assert(storyFn.COLUMNS.indexOf("injuries") !== -1, "Scenario I: COLUMNS includes injuries");
    assert(storyFn.COLUMNS.indexOf("medical_treatment_timing") !== -1, "Scenario I: COLUMNS includes medical_treatment_timing");
    assert(storyFn.COLUMNS.indexOf("had_car_insurance") !== -1, "Scenario I: COLUMNS includes had_car_insurance");
    assert(storyFn.COLUMNS.indexOf("payment_intent") !== -1, "Scenario I: COLUMNS includes payment_intent");
  }

  // ---------------------------------------------------------------
  // SCENARIO J — New York resident: immediately disqualified.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    click(dom, "startApplyBtn");
    click(dom, "qPaymentIntentOpt0");
    setVal(dom, "q1Input", "ScenarioJ");
    click(dom, "q1Continue");
    click(dom, "q2Yes");
    setVal(dom, "q3Input", "New York");
    click(dom, "q3Continue");
    assert(text(dom, ".apply-thankyou-title") === "Thanks for your interest", "Scenario J: selecting New York immediately shows the disqualification screen");
    assert(!dom.window.document.getElementById("q4Opt0"), "Scenario J: flow does not continue to Q4 after New York disqualification");
    assert(text(dom, ".apply-thankyou-body").toLowerCase().indexOf("new york") !== -1, "Scenario J: disqualification message references New York");
  }

  // ---------------------------------------------------------------
  // SCENARIO K — Back button works correctly through the conditional
  // HOT LEAD questions and retains previous selections.
  // ---------------------------------------------------------------
  {
    const dom = await boot("");
    await driveToQ6(dom, "ScenarioK", "Texas", 0);
    click(dom, "q6Opt1"); // Still ongoing
    click(dom, "qAttorneyOpt0"); // Yes -> HOT LEAD
    check(dom, "qInjuriesOpt0", true); // "Back or neck pain"
    check(dom, "qInjuriesOpt4", true); // "Other"
    click(dom, "qInjuriesContinue");
    click(dom, "qTreatmentOpt2"); // "I didn't get treatment"

    // Now on the insurance question — back up through the treatment
    // and injuries questions and confirm every prior selection is
    // still intact.
    click(dom, "stepBack"); // -> back to treatment question
    assert(!!dom.window.document.getElementById("qTreatmentOpt0"), "Scenario K: Back from the insurance question returns to the treatment-timing question");
    click(dom, "stepBack"); // -> back to injuries question
    const opt0 = dom.window.document.getElementById("qInjuriesOpt0");
    const opt4 = dom.window.document.getElementById("qInjuriesOpt4");
    assert(opt0.checked === true, "Scenario K: Back to the injuries question retains the 'Back or neck pain' selection");
    assert(opt4.checked === true, "Scenario K: Back to the injuries question retains the 'Other' selection");
    assert(opt0.closest(".apply-checkbox-card").classList.contains("selected"), "Scenario K: the retained injuries selection is still visually marked selected");

    // Move forward again through the same 3 questions and confirm Back
    // continues to work across the whole conditional HOT LEAD block,
    // not just within it — all the way back up to the attorney question.
    click(dom, "qInjuriesContinue");
    assert(!!dom.window.document.getElementById("qTreatmentOpt0"), "Scenario K: moving forward again reaches the treatment question");
    click(dom, "qTreatmentOpt2");
    click(dom, "qInsuranceOpt0"); // "Yes"
    assert(!!dom.window.document.getElementById("q7Opt0"), "Scenario K: flow reaches the on-camera comfort question after all 3 HOT LEAD questions");

    click(dom, "stepBack"); // -> insurance
    click(dom, "stepBack"); // -> treatment
    click(dom, "stepBack"); // -> injuries
    click(dom, "stepBack"); // -> attorney question
    assert(!!dom.window.document.getElementById("qAttorneyOpt0"), "Scenario K: backing up through all 3 HOT LEAD questions returns to the attorney question");
  }

  // ---------------------------------------------------------------
  // SCENARIO L — progress indicator correctly adjusts for normal
  // applicants, attorney-qualified (non-HOT-LEAD) applicants, and
  // HOT LEAD applicants.
  // ---------------------------------------------------------------
  {
    // Normal applicant (settled / no attorney question) — total 9.
    {
      const dom = await boot("");
      click(dom, "startApplyBtn");
      assert(text(dom, ".apply-progress-row").indexOf("Question 1 of 9") !== -1, "Scenario L: normal applicant sees 'Question 1 of 9' at the opening question");
      click(dom, "qPaymentIntentOpt0");
      assert(text(dom, ".apply-progress-row").indexOf("Question 2 of 9") !== -1, "Scenario L: normal applicant sees 'Question 2 of 9' at the name question");
    }

    // Attorney-qualified applicant — the attorney question itself adds
    // 1 to the total (10) regardless of how it's answered; only the 3
    // HOT LEAD questions are conditional on a "Yes" answer.
    {
      const dom = await boot("");
      await driveToQ6(dom, "ScenarioL2", "Texas", 0);
      click(dom, "q6Opt1"); // Still ongoing
      assert(text(dom, ".apply-progress-row").indexOf("of 10") !== -1, "Scenario L: attorney-qualified applicant sees a 10-question total once the attorney question is reached");
      click(dom, "qAttorneyOpt1"); // No -> not HOT LEAD, total remains 10 (the attorney question itself still counts)
      assert(text(dom, ".apply-progress-row").indexOf("of 10") !== -1, "Scenario L: total remains 10 after declining the attorney question — only the 3 HOT LEAD questions are skipped, not the attorney question itself");
    }

    // HOT LEAD applicant — total becomes 13 and stays 13 through all 3
    // HOT LEAD questions.
    {
      const dom = await boot("");
      await driveToQ6(dom, "ScenarioL3", "Texas", 0);
      click(dom, "q6Opt1"); // Still ongoing
      click(dom, "qAttorneyOpt0"); // Yes -> HOT LEAD, total becomes 13
      assert(text(dom, ".apply-progress-row").indexOf("of 13") !== -1, "Scenario L: HOT LEAD applicant sees a 13-question total at the injuries question");
      check(dom, "qInjuriesOpt0", true);
      click(dom, "qInjuriesContinue");
      assert(text(dom, ".apply-progress-row").indexOf("of 13") !== -1, "Scenario L: total stays 13 at the treatment-timing question");
      click(dom, "qTreatmentOpt0");
      assert(text(dom, ".apply-progress-row").indexOf("of 13") !== -1, "Scenario L: total stays 13 at the insurance question");
      click(dom, "qInsuranceOpt0");
      assert(text(dom, ".apply-progress-row").indexOf("of 13") !== -1, "Scenario L: total stays 13 once back at the on-camera comfort question");
    }
  }

  // =================================================================
  // Duplicate-detection regression (unchanged this revision — see
  // test_duplicate_detection.js for the server-side matching logic).
  // Confirms the client's handling of a duplicate response still works
  // with the new opening question inserted at the front of the flow.
  // =================================================================
  {
    const dom = await boot("", { duplicate: true });
    await driveToQ6(dom, "DupCheck1", "Texas", 0);
    click(dom, "q6Opt0");
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "5559990001");
    setVal(dom, "q8Email", "already-applied@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "You're all set.", "Duplicate regression: duplicate response shows the friendly 'already submitted' screen");
    assert(text(dom, ".apply-thankyou-body").indexOf("already submitted") !== -1, "Duplicate regression: message text matches the required friendly copy");
    assert(text(dom, ".apply-thankyou-body").toLowerCase().indexOf("fraud") === -1, "Duplicate regression: message is never accusatory / never mentions fraud");
  }

  // =================================================================
  // PHONE VALIDATION — the phone field on Q8 must normalize to exactly
  // 10 digits (strip formatting, drop a leading US "1" only when 11
  // digits remain) both client-side (apply-app.js) and independently
  // server-side (submit-story-application.js). See normalizePhone() in
  // each file — the two are written to match byte-for-byte.
  // =================================================================

  // Drives a full application up to and including one submit attempt
  // on Q8, using whatever raw phone string is given. "Settled" is used
  // for situation_status so this stays on the plain 9-question path
  // (no attorney/HOT LEAD branching to keep these tests focused on the
  // phone field specifically).
  async function submitWithPhone(dom, phoneRaw, emailVal) {
    await driveToQ6(dom, "PhoneTest", "Texas", 0);
    click(dom, "q6Opt0"); // "Settled"
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", phoneRaw);
    setVal(dom, "q8Email", emailVal || "phonetest@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));
  }

  // --- 1: plain 10-digit number accepted ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "5615551234");
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Phone#1: plain 10-digit number is accepted");
    assert(dom.fetchCalls.length === 1, "Phone#1: exactly one submission was sent");
    assert(dom.fetchCalls[0].body.phone === "5615551234", "Phone#1: submitted payload carries the 10-digit value unchanged");
  }

  // --- 2: (561) 555-1234 accepted ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "(561) 555-1234");
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Phone#2: (561) 555-1234 is accepted");
    assert(dom.fetchCalls[0].body.phone === "5615551234", "Phone#2: submitted payload normalizes parentheses/space formatting to 5615551234");
  }

  // --- 3: 561-555-1234 accepted ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "561-555-1234");
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Phone#3: 561-555-1234 is accepted");
    assert(dom.fetchCalls[0].body.phone === "5615551234", "Phone#3: submitted payload normalizes hyphen formatting to 5615551234");
  }

  // --- 4: +1 (561) 555-1234 accepted and stored as 5615551234 ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "+1 (561) 555-1234");
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Phone#4: +1 (561) 555-1234 is accepted");
    assert(dom.fetchCalls[0].body.phone === "5615551234", "Phone#4: leading +1 US country code is stripped, stored as 5615551234");
  }

  // --- 5: 9 digits rejected client-side, submission never sent ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "561555123"); // 9 digits
    assert(dom.fetchCalls.length === 0, "Phone#5: 9-digit number never reaches submission (no request sent)");
    assert(!!dom.window.document.getElementById("q8Phone"), "Phone#5: applicant stays on the contact-information screen");
    assert(text(dom, "#q8PhoneError") === "Please enter a valid 10-digit phone number.", "Phone#5: inline error shown for a 9-digit number");
    assert(dom.window.document.getElementById("q8Email").value === "phonetest@example.com", "Phone#5: other answers (email) are not cleared after the failed validation");
  }

  // --- 6: 11 digits without a valid leading US "1" rejected ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "56155512345"); // 11 digits, leading "5" — not a valid US country code
    assert(dom.fetchCalls.length === 0, "Phone#6: 11-digit number without a leading US '1' is rejected (no request sent)");
    assert(text(dom, "#q8PhoneError") === "Please enter a valid 10-digit phone number.", "Phone#6: inline error shown for an invalid 11-digit number");
  }

  // --- 7: more than 11 digits rejected ---
  {
    const dom = await boot("");
    await submitWithPhone(dom, "561555123456"); // 12 digits
    assert(dom.fetchCalls.length === 0, "Phone#7: 12-digit number is rejected (no request sent)");
    assert(text(dom, "#q8PhoneError") === "Please enter a valid 10-digit phone number.", "Phone#7: inline error shown for a 12-digit number");
  }

  // --- 9: phone error renders in the correct DOM position — directly
  // beneath the phone field, above the email label/input — and the
  // email field itself is not moved or cleared, and the generic
  // #q8Error slot (used for email/consent errors) stays empty. ---
  {
    const dom = await boot("");
    await driveToQ6(dom, "PhoneOrderTest", "Texas", 0);
    click(dom, "q6Opt0"); // "Settled"
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "561555123"); // 9 digits — invalid
    setVal(dom, "q8Email", "orderTest@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 30));

    const doc = dom.window.document;
    const phoneError = doc.getElementById("q8PhoneError");
    const emailLabel = doc.querySelector('label[for="q8Email"]');
    assert(phoneError.textContent === "Please enter a valid 10-digit phone number.", "Phone#9: phone-specific error element carries the message");

    // DOCUMENT_POSITION_FOLLOWING means phoneError comes BEFORE emailLabel.
    const relation = phoneError.compareDocumentPosition(emailLabel);
    assert((relation & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, "Phone#9: phone error appears before the Email label in document order");

    const phoneGroup = doc.getElementById("q8Phone").closest(".apply-field-group");
    assert(phoneGroup.contains(phoneError), "Phone#9: phone error is physically inside the phone field's own field-group, not the email one");

    assert(doc.getElementById("q8Error").textContent === "", "Phone#9: the shared/general error slot (email/consent errors) stays empty for a phone-only failure");
    assert(doc.getElementById("q8Email").value === "orderTest@example.com", "Phone#9: email field is untouched/not moved");
    assert(doc.getElementById("q8Consent").checked === true, "Phone#9: consent checkbox state is preserved (other answers intact)");
    assert(dom.fetchCalls.length === 0, "Phone#9: no submission was sent for the invalid phone");
  }

  // --- 10: after a phone error, correcting the phone and submitting
  // clears the stale phone error and succeeds normally. ---
  {
    const dom = await boot("");
    await driveToQ6(dom, "PhoneRetryTest", "Texas", 0);
    click(dom, "q6Opt0");
    click(dom, "q7Opt0");
    setVal(dom, "q8Phone", "561555123"); // invalid first
    setVal(dom, "q8Email", "retryTest@example.com");
    check(dom, "q8Consent", true);
    click(dom, "q8Submit");
    await new Promise((r) => setTimeout(r, 10));
    assert(text(dom, "#q8PhoneError") === "Please enter a valid 10-digit phone number.", "Phone#10: phone error shown on first (invalid) attempt");

    setVal(dom, "q8Phone", "5615551234"); // now valid
    click(dom, "q8Submit");
    // Checked immediately (before the async submission settles) — the
    // error clear happens synchronously at the top of
    // validateAndSubmit(), ahead of the network call.
    assert(text(dom, "#q8PhoneError") === "", "Phone#10: stale phone error is cleared as soon as a valid phone is resubmitted");
    await new Promise((r) => setTimeout(r, 30));
    assert(text(dom, ".apply-thankyou-title") === "Application received.", "Phone#10: corrected phone submits successfully");
  }

  // --- 8: server independently rejects an invalid phone even if the
  // client-side check is bypassed entirely (raw POST straight to the
  // Netlify function, never going through apply-app.js at all). ---
  {
    const res = await storyFn.handler({
      httpMethod: "POST",
      body: JSON.stringify({ applicant_id: "APP-phone-bypass-test", phone: "561555123", email: "bypass@example.com" }),
    });
    assert(res.statusCode === 400, "Phone#8: server rejects a bypassed 9-digit phone with HTTP 400");
    const resBody = JSON.parse(res.body);
    assert(resBody.ok === false && resBody.error === "invalid_phone", "Phone#8: server response reports invalid_phone, independent of any client-side check");
  }

  // --- Server-side normalizePhone matches the client's rules exactly ---
  {
    assert(storyFn.normalizePhone("+1 (561) 555-1234") === "5615551234", "Phone: server normalizePhone() strips +1/formatting identically to the client");
    assert(storyFn.normalizePhone("561555123") === "561555123", "Phone: server normalizePhone() does not fabricate digits for a short number (validity is checked separately, not inside normalization)");
  }

  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"));
  process.exit(failures === 0 ? 0 : 1);
})();
