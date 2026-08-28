/**
 * Crash2Claim — /apply Recruitment Application Flow
 * -----------------------------------------------------------------
 * Fully independent from js/app.js (the case-evaluation funnel's
 * flow controller). Different STATE shape, different questions,
 * different submission target, different Sheet. Does NOT read,
 * write, or feed into the case-evaluation survey's qualification
 * logic, lead scoring, or Sheet in any way.
 *
 * The application flow is entered via a STATIC "Start Your
 * Application" button that lives directly in apply.html's hero
 * (id="startApplyBtn") — this file no longer renders its own intro
 * card. Clicking that button sets STATE.step = 1 and renders the
 * opening payment-intent question (see qPaymentIntentTemplate()).
 * -----------------------------------------------------------------
 */

(function () {
  "use strict";

  // Base step count is 7 (opening payment-intent question + the 6
  // fixed questions: name, DOB, state, timeframe, story, situation)
  // plus the 2 trailing questions (on-camera comfort, contact/consent)
  // = 9 for every applicant. It's 10 when the attorney-interest
  // question qualifies (see isAttorneyQuestionQualified()), and 12 for
  // a HOT LEAD applicant (attorney question + injuries + treatment —
  // the former "insurance" HOT LEAD-only question was removed as of
  // this revision). Nothing in this file assumes a fixed total — see
  // getTotalSteps() and currentSequence() below.
  var applyRoot = document.getElementById("applyRoot");

  var params = new URLSearchParams(window.location.search);
  var isTestMode = params.get("test") === "1";

  // Answer choices kept to 2–3 options per question (state selector is
  // exempt) so the application is fast to complete on mobile.
  // TIMEFRAME_OPTIONS is intentionally a strict 2-year boundary (not a
  // range) — it exists purely to segment applicants by whether the
  // accident falls inside the relevant 2-year window (see
  // isAttorneyQuestionQualified() below).
  // Recency options — updated from the old 2-year boundary to a
  // tighter 12-month qualification window (see isRecencyQualified()).
  // "Over a year ago" never disqualifies from Crash2Claim storytelling
  // — it only means the applicant skips the attorney/liability
  // qualification branch below.
  var TIMEFRAME_OPTIONS = ["Within the last 6 months", "Within the last year", "Over a year ago"];
  var SITUATION_OPTIONS = ["Settled", "Still ongoing", "Not sure"];
  // "Maybe" removed — only Yes/No going forward. Existing on_camera_comfort
  // field/column is unchanged; only the accepted answer set shrank. Prior
  // Sheet rows that already contain "Maybe" are historical data and are
  // not touched by this change.
  var COMFORT_OPTIONS = ["Yes", "No"];
  var ATTORNEY_REP_OPTIONS = ["No", "Yes"];
  var ATTORNEY_INTEREST_OPTIONS = ["Yes", "No"];
  // "Not sure" removed as of this revision — only "Other person" and
  // "Me" remain. "Other person" is the only value that satisfies the
  // liability leg of HOT LEAD (see isHotLead() below); "Me" does not.
  var LIABILITY_OPTIONS = ["Other person", "Me"];
  var NEW_YORK = "New York";
  var STILL_ONGOING = "Still ongoing";
  // Case-status "Not sure" — as of a prior revision, treated as
  // equivalent to "Still ongoing" for qualification purposes (see
  // isAttorneyRepQualified() below). Named distinctly from
  // primary_fault (a different field) even though LIABILITY_OPTIONS no
  // longer has its own "Not sure" value to disambiguate from.
  var SITUATION_NOT_SURE = "Not sure";
  var OTHER_PERSON = "Other person";

  // Opening question — asked of EVERY applicant, before anything else.
  // Intentionally 4 options (an explicit exception to the general
  // 2–3 option guideline). Icons are small inline SVGs (dark navy line
  // work, no emojis, no external icon library) rendered in a 2x2 grid.
  var PAYMENT_INTENT_OPTIONS = [
    { label: "Take my family to lunch", icon: "meal" },
    { label: "Pay a bill", icon: "bill" },
    { label: "Go shopping", icon: "shopping" },
    { label: "Save it", icon: "piggy" },
  ];

  var ICONS = {
    meal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28" aria-hidden="true"><path d="M6 3v4M8 3v4M10 3v4M8 7v12"/><path d="M16 3c1.5 0 2.5 1.8 2.5 4S17.5 11 16 11v8"/></svg>',
    bill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28" aria-hidden="true"><path d="M6 2h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5V2z"/><path d="M9 7h6M9 10.5h6M9 14h4"/></svg>',
    shopping: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    piggy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28" aria-hidden="true"><path d="M4 12a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1a2 2 0 0 1-2 2h-1v3h-3v-2H9v2H6v-3a6 6 0 0 1-2-3z"/><circle cx="9" cy="9" r="0.6" fill="currentColor" stroke="none"/><path d="M11 6V4"/></svg>',
  };

  // HOT LEAD-only questions (see isHotLead()) — kept short by design.
  // The former INSURANCE_OPTIONS / "had you have car insurance"
  // question was removed as of this revision (see the removal note
  // near clearHotLeadAnswers() further down) — no options array
  // needed for it anymore.
  var INJURY_OPTIONS = ["Back or neck pain", "Broken bones", "Cuts or bruises", "Head injury", "Other"];
  var TREATMENT_TIMING_OPTIONS = ["Within the first week", "More than a week later", "I didn't get treatment"];

  var STATE = {
    // 0 = nothing rendered (static hero button starts flow)
    // -1 = age-gate stop (under 18)
    // -2 = New York disqualification stop
    // 1..N = questions (N depends on branch, see currentSequence())
    // N+1 = thank-you / duplicate screen
    step: 0,
    isSubmitting: false,
    hasSubmitted: false,
    isDuplicate: false,
    applicantId: null,
    webhookWarning: false,
    answers: {
      payment_intent: "",
      first_name: "",
      is_18: null, // derived from date_of_birth as of this revision — see bindQ2()
      date_of_birth: "", // NEW — "YYYY-MM-DD", collected via the DOB question that replaced the old 18+ Yes/No click
      state: "",
      accident_timeframe: "",
      story_summary: "",
      situation_status: "",
      has_hired_attorney: null, // true/false/null — only asked when qualified, see isAttorneyRepQualified()
      interested_in_attorney: null, // true/false/null — only asked when qualified, see isAttorneyInterestQualified()
      primary_fault: "", // "Other person" / "Me" / "Not sure" / "" — only asked when qualified, see isLiabilityQualified()
      injuries: [], // HOT LEAD only — array of selected labels
      medical_treatment_timing: "", // HOT LEAD only
      had_car_insurance: "", // HOT LEAD only
      on_camera_comfort: "",
      phone: "",
      email: "",
      address: "", // NEW — collected on the contact/payment page (Q8)
      consent: false, // Application Agreement checkbox, now on the new consent step
      consent_timestamp: "",
      attorney_contact_consent: null, // NEW — Attorney Contact Consent checkbox, true/false/null, optional
    },
  };

  // Recency qualifies HOT LEAD eligibility only when the accident was
  // within the last 12 months ("Within the last 6 months" OR "Within
  // the last year"). "Over a year ago" does not disqualify the
  // applicant from Crash2Claim storytelling — it only means the
  // attorney/liability qualification branch below is skipped.
  function isRecencyQualified() {
    return (
      STATE.answers.accident_timeframe === "Within the last 6 months" ||
      STATE.answers.accident_timeframe === "Within the last year"
    );
  }

  // The attorney-representation question (Q6a) requires BOTH:
  //   1. Accident happened within the last 12 months (Q4)
  //   2. Case status is "Still ongoing" OR "Not sure" (Q6) — only
  //      "Settled" skips the rest of the qualification branch
  //      entirely and goes straight to normal storytelling. As of
  //      this revision, "Not sure" is treated as equivalent to
  //      "Still ongoing" for qualification purposes — an applicant
  //      who isn't certain whether their case is technically settled
  //      is not excluded from the attorney-connection branch.
  // situation_status itself is always asked/recorded regardless, so
  // every applicant remains reviewable in the Sheet either way.
  function isAttorneyRepQualified() {
    return (
      isRecencyQualified() &&
      (STATE.answers.situation_status === STILL_ONGOING || STATE.answers.situation_status === SITUATION_NOT_SURE)
    );
  }

  // The attorney-interest question (Q6b) only follows when the
  // applicant does NOT already have an attorney. Having one is NOT a
  // disqualifier from storytelling — it just ends the lead-gen branch
  // here (see bindQAttorneyRep()).
  function isAttorneyInterestQualified() {
    return isAttorneyRepQualified() && STATE.answers.has_hired_attorney === false;
  }

  // The liability question (Q6c) only follows when the applicant is
  // both unrepresented and wants a free review.
  function isLiabilityQualified() {
    return isAttorneyInterestQualified() && STATE.answers.interested_in_attorney === true;
  }

  // HOT LEAD = recency (last 12 months) AND case status "Still
  // ongoing" or "Not sure" AND no attorney AND wants a free review AND
  // the other person was at fault. Written out via the full
  // qualification chain (rather than
  // just checking primary_fault) so it stays correct even if the
  // applicant backs up and changes an earlier answer. This is a
  // CLIENT-side mirror only, used purely to decide which questions to
  // show next — the authoritative lead_status is computed server-side
  // at submission time (see netlify/functions/submit-story-application.js)
  // and never trusts a value sent from the browser.
  function isHotLead() {
    return isLiabilityQualified() && STATE.answers.primary_fault === OTHER_PERSON;
  }

  // Ordered list of logical question keys for the CURRENT applicant.
  // "paymentIntent" always comes first. 1–6 are the fixed base
  // questions (name, age, state, timeframe, story, situation).
  // "attorneyRep" / "attorneyInterest" / "liability" are inserted one
  // at a time, each only once the previous answer in the chain
  // qualifies for it (see isAttorneyRepQualified() /
  // isAttorneyInterestQualified() / isLiabilityQualified() above).
  // "injuries"/"treatment" are inserted only for HOT LEAD applicants
  // (isHotLead()). The former "insurance" HOT LEAD-only question
  // ("Did you have car insurance when the accident happened?") was
  // removed as of this revision — see qInsuranceTemplate()'s removal
  // note further down. had_car_insurance stays a defined field/Sheet
  // column (submitted permanently blank now) so nothing downstream
  // shifts. 7–8 are the existing comfort/contact questions, reused
  // unchanged — they just move position depending on which
  // conditional questions are present.
  function currentSequence() {
    var seq = ["paymentIntent", 1, 2, 3, 4, 5, 6];
    if (isAttorneyRepQualified()) seq.push("attorneyRep");
    if (isAttorneyInterestQualified()) seq.push("attorneyInterest");
    if (isLiabilityQualified()) seq.push("liability");
    if (isHotLead()) seq.push("injuries", "treatment");
    seq.push(7, 8, "consent");
    return seq;
  }

  function getTotalSteps() {
    return currentSequence().length;
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof captureAttribution === "function") {
      captureAttribution();
    }

    if (isTestMode) {
      var banner = document.getElementById("applyTestBanner");
      if (banner) banner.style.display = "block";
    }

    bindStaticHeroButton();
    render();
  });

  function bindStaticHeroButton() {
    var btn = document.getElementById("startApplyBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      // Layout-only transition: switch the page into a dedicated,
      // full-page application experience. Hides the landing-page
      // sections (hero, how-it-works strip, info cards) via CSS and
      // lets #applyRoot become the focused surface. Does not change
      // STATE, questions, validation, or submission behavior.
      document.body.classList.add("app-mode");
      STATE.step = 1;
      render();
      scrollToTop();
    });
  }

  // Layout-only: header shown above each question card while in
  // application mode ("Your Story Application" + "Question X of 8"
  // + percentage + progress bar). Not shown on the age-gate stop or
  // thank-you screens, which keep their existing plain-card look.
  function progressHeaderHtml(step) {
    var total = getTotalSteps();
    var percent = Math.floor((step / total) * 100);
    return (
      '<div class="apply-app-header">' +
      '<p class="apply-app-eyebrow">Your Story Application</p>' +
      '<div class="apply-progress-row"><span>Question ' + step + " of " + total + "</span><span>" + percent + "%</span></div>" +
      '<div class="apply-progress-track"><div class="apply-progress-fill" style="width:' + percent + '%"></div></div>' +
      "</div>"
    );
  }

  function render() {
    if (!applyRoot) return;

    if (STATE.step === 0) {
      applyRoot.innerHTML = "";
      return;
    }
    if (STATE.step === -1) {
      applyRoot.innerHTML = ageGateStopTemplate();
      scrollToTopIfAppMode();
      return;
    }
    if (STATE.step === -2) {
      applyRoot.innerHTML = newYorkStopTemplate();
      scrollToTopIfAppMode();
      return;
    }
    if (STATE.step >= 1 && STATE.step <= getTotalSteps()) {
      applyRoot.innerHTML = progressHeaderHtml(STATE.step) + stepTemplate(STATE.step);
      bindStepEvents(STATE.step);
      scrollToTopIfAppMode();
      focusFirstField(STATE.step);
      return;
    }
    if (STATE.step === getTotalSteps() + 1) {
      applyRoot.innerHTML = thankYouTemplate();
      scrollToTopIfAppMode();
      return;
    }
  }

  // Layout-only: keeps the current question the dominant thing on
  // screen as the visitor moves between steps, instead of leaving
  // them scrolled to wherever the previous question left off.
  function scrollToTopIfAppMode() {
    if (document.body.classList.contains("app-mode")) {
      scrollToTop();
    }
  }

  // Guarded scroll helper — some environments (older browsers, test
  // harnesses) don't implement the smooth-scroll options object.
  function scrollToTop() {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    } catch (e) {
      try {
        window.scrollTo(0, 0);
      } catch (e2) {
        // no-op — scrolling is a layout nicety, never block the flow
      }
    }
  }

  // Layout-only: focuses the primary input on questions that have
  // one, so mobile/desktop visitors can start typing immediately.
  // Q2 gained a real input (the DOB field) as of this revision, so
  // it's now included below. No-op on button-only questions (Q4, Q6, Q7).
  function focusFirstField(step) {
    var key = currentSequence()[step - 1];
    var idByKey = { 1: "q1Input", 2: "q2Input", 3: "q3Input", 5: "q5Input", 8: "q8Phone" };
    var id = idByKey[key];
    if (!id) return;
    var el = document.getElementById(id);
    if (el && typeof el.focus === "function") {
      el.focus({ preventScroll: true });
    }
  }

  // -----------------------------------------------------------------
  // Age-gate stop (Q2 answered "No")
  // -----------------------------------------------------------------
  function ageGateStopTemplate() {
    return (
      '<div class="apply-card">' +
      '<h2 class="apply-thankyou-title">Thanks for your interest</h2>' +
      '<p class="apply-thankyou-body">This project is only open to participants who are 18 or older. We appreciate you taking the time to consider it.</p>' +
      "</div>"
    );
  }

  // -----------------------------------------------------------------
  // New York disqualification stop (Q3 state = New York)
  // -----------------------------------------------------------------
  function newYorkStopTemplate() {
    return (
      '<div class="apply-card">' +
      '<h2 class="apply-thankyou-title">Thanks for your interest</h2>' +
      '<p class="apply-thankyou-body">This project isn\'t currently open to residents of New York. We appreciate you taking the time to consider it.</p>' +
      "</div>"
    );
  }

  // -----------------------------------------------------------------
  // Question steps
  // -----------------------------------------------------------------
  function stepTemplate(step) {
    // Note: the old inline "Question X of Y" line is now rendered by
    // progressHeaderHtml() above the card (see render()), so the card
    // itself only contains the question body. `key` is the logical
    // question at this position — see currentSequence().
    var key = currentSequence()[step - 1];
    var body = "";
    switch (key) {
      case "paymentIntent": body = qPaymentIntentTemplate(); break;
      case 1: body = q1Template(); break;
      case 2: body = q2Template(); break;
      case 3: body = q3Template(); break;
      case 4: body = q4Template(); break;
      case 5: body = q5Template(); break;
      case 6: body = q6Template(); break;
      case "attorneyRep": body = qAttorneyRepTemplate(); break;
      case "attorneyInterest": body = qAttorneyInterestTemplate(); break;
      case "liability": body = qLiabilityTemplate(); break;
      case "injuries": body = qInjuriesTemplate(); break;
      case "treatment": body = qTreatmentTemplate(); break;
      case 7: body = q7Template(); break;
      case 8: body = q8Template(); break;
      case "consent": body = qConsentTemplate(); break;
    }
    return '<div class="apply-card">' + body + "</div>";
  }

  function bindStepEvents(step) {
    var key = currentSequence()[step - 1];
    switch (key) {
      case "paymentIntent": bindQPaymentIntent(); break;
      case 1: bindQ1(); break;
      case 2: bindQ2(); break;
      case 3: bindQ3(); break;
      case 4: bindQ4(); break;
      case 5: bindQ5(); break;
      case 6: bindQ6(); break;
      case "attorneyRep": bindQAttorneyRep(); break;
      case "attorneyInterest": bindQAttorneyInterest(); break;
      case "liability": bindQLiability(); break;
      case "injuries": bindQInjuries(); break;
      case "treatment": bindQTreatment(); break;
      case 7: bindQ7(); break;
      case 8: bindQ8(); break;
      case "consent": bindQConsent(); break;
    }
  }

  // Back always returns to the immediately previous position. Positions
  // resolve to logical questions dynamically via currentSequence(), so
  // this stays correct whether or not the attorney-interest question is
  // present in the current applicant's sequence.
  function backButton() {
    return '<button type="button" class="apply-btn-back" id="stepBack">&larr; Back</button>';
  }
  function bindBack() {
    var back = document.getElementById("stepBack");
    if (back) {
      back.addEventListener("click", function () {
        STATE.step = STATE.step - 1;
        render();
      });
    }
  }

  // Opening question — payment intent. Always the very first thing
  // every applicant sees (no back button — nothing comes before it).
  // 2x2 icon grid, 4 options (an intentional exception to the
  // 2–3 option guideline used everywhere else in this application).
  function qPaymentIntentTemplate() {
    var optionsHtml = PAYMENT_INTENT_OPTIONS.map(function (opt, i) {
      return (
        '<button type="button" class="apply-icon-answer-btn" id="qPaymentIntentOpt' + i + '">' +
        (ICONS[opt.icon] || "") +
        '<span>' + escapeHtml(opt.label) + "</span>" +
        "</button>"
      );
    }).join("");
    return (
      '<p class="apply-question">If your interview is published, what would you do with the $50?</p>' +
      '<div class="apply-icon-grid">' + optionsHtml + "</div>"
    );
  }
  function bindQPaymentIntent() {
    PAYMENT_INTENT_OPTIONS.forEach(function (opt, i) {
      document.getElementById("qPaymentIntentOpt" + i).addEventListener("click", function () {
        STATE.answers.payment_intent = opt.label;
        STATE.step = STATE.step + 1;
        render();
      });
    });
    // Intentionally no bindBack() — this is always the first step.
  }

  // Q1 — full name. Displayed copy asks for the applicant's full name;
  // the underlying answer key/field remains "first_name" (unchanged)
  // so the existing payload shape and Google Sheets column alignment
  // are not affected — it now simply holds whatever full-name string
  // the applicant enters.
  function q1Template() {
    return (
      '<p class="apply-question">What\'s your full name?</p>' +
      '<div class="apply-field-group">' +
      '<input type="text" id="q1Input" maxlength="80" placeholder="Full name" value="' + escapeAttr(STATE.answers.first_name) + '">' +
      '<p class="apply-error-text" id="q1Error"></p>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q1Continue">Continue</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ1() {
    var input = document.getElementById("q1Input");
    var btn = document.getElementById("q1Continue");
    btn.addEventListener("click", function () {
      var val = (input.value || "").trim();
      if (!val) {
        document.getElementById("q1Error").textContent = "Please enter your full name.";
        return;
      }
      STATE.answers.first_name = val;
      STATE.step = STATE.step + 1;
      render();
    });
    bindBack();
  }

  // Q2 — date of birth. Replaced the old "Are you 18 or older?" Yes/No
  // click as of this revision — age is now derived from the full DOB
  // (see calculateAge()/parseDob() in the Helpers section) rather than
  // asked directly. is_18 is still populated here exactly as before
  // (true/false), so every downstream consumer of is_18 — including
  // apply-payload.js's age_18_confirmation mapping — is unaffected.
  function q2Template() {
    var today = new Date();
    var maxAttr = today.getFullYear() + "-" + pad2(today.getMonth() + 1) + "-" + pad2(today.getDate());
    return (
      '<p class="apply-question">What is your date of birth?</p>' +
      '<div class="apply-field-group">' +
      '<input type="date" id="q2Input" max="' + maxAttr + '" value="' + escapeAttr(STATE.answers.date_of_birth || "") + '">' +
      '<p class="apply-error-text" id="q2Error"></p>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q2Continue">Continue</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ2() {
    var input = document.getElementById("q2Input");
    var btn = document.getElementById("q2Continue");
    btn.addEventListener("click", function () {
      var errorEl = document.getElementById("q2Error");
      if (errorEl) errorEl.textContent = "";

      var raw = (input.value || "").trim();
      if (!raw) {
        if (errorEl) errorEl.textContent = "Please enter your date of birth.";
        return;
      }

      var dob = parseDob(raw);
      if (!dob) {
        if (errorEl) errorEl.textContent = "Please enter a valid date of birth.";
        return;
      }

      var now = new Date();
      var todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (dob.getTime() > todayMidnight.getTime()) {
        if (errorEl) errorEl.textContent = "Date of birth can't be in the future.";
        return;
      }

      STATE.answers.date_of_birth = raw;

      var age = calculateAge(dob, todayMidnight);
      if (age < 18) {
        STATE.answers.is_18 = false;
        STATE.step = -1;
        render();
        return;
      }

      STATE.answers.is_18 = true;
      STATE.step = STATE.step + 1;
      render();
    });
    bindBack();
  }

  // Q3 — state (New York is immediately disqualified — see bindQ3)
  function q3Template() {
    var options = (typeof APPLY_CONFIG !== "undefined" && APPLY_CONFIG.STATES) || [];
    var optionsHtml = '<option value="">Select your state</option>' + options.map(function (s) {
      return '<option value="' + escapeAttr(s) + '"' + (STATE.answers.state === s ? " selected" : "") + ">" + s + "</option>";
    }).join("");
    return (
      '<p class="apply-question">What state did the accident happen in?</p>' +
      '<div class="apply-field-group">' +
      '<select id="q3Input">' + optionsHtml + "</select>" +
      '<p class="apply-error-text" id="q3Error"></p>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q3Continue">Continue</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ3() {
    var select = document.getElementById("q3Input");
    document.getElementById("q3Continue").addEventListener("click", function () {
      var val = select.value;
      if (!val) {
        document.getElementById("q3Error").textContent = "Please select a state.";
        return;
      }
      STATE.answers.state = val;
      if (val === NEW_YORK) {
        STATE.step = -2;
        render();
        return;
      }
      STATE.step = STATE.step + 1;
      render();
    });
    bindBack();
  }

  // Q4 — accident timeframe
  function q4Template() {
    var optionsHtml = TIMEFRAME_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q4Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">When did the accident happen?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQ4() {
    TIMEFRAME_OPTIONS.forEach(function (label, i) {
      document.getElementById("q4Opt" + i).addEventListener("click", function () {
        STATE.answers.accident_timeframe = label;
        // If this answer means the attorney/liability branch is no
        // longer qualified (e.g. it was showing and is now not needed
        // because the applicant backed up and changed an earlier
        // answer), drop any previously recorded downstream state so it
        // never carries a stale value (or a stale HOT LEAD) into the
        // payload.
        if (!isAttorneyRepQualified()) clearQualificationAnswers();
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // Q5 — story summary
  function q5Template() {
    var val = STATE.answers.story_summary || "";
    return (
      '<p class="apply-question">In a few sentences, what happened?</p>' +
      '<div class="apply-field-group">' +
      '<textarea id="q5Input" maxlength="500" placeholder="Tell us briefly what happened...">' + escapeHtml(val) + "</textarea>" +
      '<p class="apply-char-count" id="q5Count">' + val.length + "/500</p>" +
      '<p class="apply-error-text" id="q5Error"></p>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q5Continue">Continue</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ5() {
    var textarea = document.getElementById("q5Input");
    var count = document.getElementById("q5Count");
    textarea.addEventListener("input", function () {
      count.textContent = textarea.value.length + "/500";
    });
    document.getElementById("q5Continue").addEventListener("click", function () {
      var val = (textarea.value || "").trim();
      if (!val) {
        document.getElementById("q5Error").textContent = "Please share a brief summary.";
        return;
      }
      STATE.answers.story_summary = val;
      STATE.step = STATE.step + 1;
      render();
    });
    bindBack();
  }

  // Q6 — case status. "Still ongoing" OR "Not sure" (combined with an
  // accident within the last 12 months — see isAttorneyRepQualified())
  // continues into the attorney-representation question next. Only
  // "Settled" skips the rest of the qualification branch and goes
  // straight to normal storytelling.
  // situation_status itself is always asked/recorded regardless.
  function q6Template() {
    var optionsHtml = SITUATION_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q6Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">What\'s the status of your case?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQ6() {
    SITUATION_OPTIONS.forEach(function (label, i) {
      document.getElementById("q6Opt" + i).addEventListener("click", function () {
        STATE.answers.situation_status = label;
        // If this answer means the attorney/liability branch is no
        // longer qualified (e.g. it was showing and is now not needed
        // because the applicant backed up and changed an answer), drop
        // any previously recorded downstream state so it never carries
        // a stale value (or a stale HOT LEAD) into the payload.
        if (!isAttorneyRepQualified()) clearQualificationAnswers();
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // Attorney-representation question — only shown once
  // isAttorneyRepQualified() is true (see currentSequence()). Having
  // an attorney does NOT disqualify the applicant from Crash2Claim
  // storytelling — it just ends the lead-gen branch here, so "Yes"
  // skips straight past attorney-interest/liability.
  function qAttorneyRepTemplate() {
    var optionsHtml = ATTORNEY_REP_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="qAttorneyRepOpt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Do you currently have an attorney representing you for this accident?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQAttorneyRep() {
    ATTORNEY_REP_OPTIONS.forEach(function (label, i) {
      document.getElementById("qAttorneyRepOpt" + i).addEventListener("click", function () {
        STATE.answers.has_hired_attorney = label === "Yes";
        // Either answer invalidates whatever was previously recorded
        // further down the chain (attorney-interest, liability, and
        // any HOT LEAD medical answers) — it will be re-asked fresh
        // (if still applicable) or correctly left blank.
        STATE.answers.interested_in_attorney = null;
        STATE.answers.primary_fault = "";
        clearHotLeadAnswers();
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // Attorney-interest question — only shown once
  // isAttorneyInterestQualified() is true (see currentSequence()).
  // Does not disqualify either way.
  //
  // The plain-text disclosure below is copy-only, purely informational
  // fine print — it does not gate, branch, or otherwise affect
  // isAttorneyInterestQualified()/isHotLead()/currentSequence(), and
  // it is not read anywhere in apply-payload.js or the Netlify
  // function. Preserved verbatim from the previously-approved
  // attorney-interest disclosure.
  function qAttorneyInterestTemplate() {
    var optionsHtml = ATTORNEY_INTEREST_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="qAttorneyInterestOpt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Do you want to speak with an attorney for a free review?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton() +
      '<p class="apply-attorney-disclosure">If you select Yes, Crash2Claim may share your information with an independent attorney or legal service provider and may receive compensation for making the connection. Crash2Claim is not a law firm and does not provide legal advice.</p>'
    );
  }
  function bindQAttorneyInterest() {
    ATTORNEY_INTEREST_OPTIONS.forEach(function (label, i) {
      document.getElementById("qAttorneyInterestOpt" + i).addEventListener("click", function () {
        STATE.answers.interested_in_attorney = label === "Yes";
        // "No" means this applicant is not a HOT LEAD (even if they
        // previously answered Yes and filled in liability/case-detail
        // questions during an earlier pass through this step via
        // Back).
        STATE.answers.primary_fault = "";
        clearHotLeadAnswers();
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // Liability question — only shown once isLiabilityQualified() is
  // true (see currentSequence()). Only "Other person" satisfies the
  // liability leg of HOT LEAD; "Me" continues straight into normal
  // storytelling as NOT HOT LEAD.
  function qLiabilityTemplate() {
    var optionsHtml = LIABILITY_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="qLiabilityOpt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Who was at fault for the accident?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQLiability() {
    LIABILITY_OPTIONS.forEach(function (label, i) {
      document.getElementById("qLiabilityOpt" + i).addEventListener("click", function () {
        STATE.answers.primary_fault = label;
        // Anything other than "Other person" means this applicant is
        // not a HOT LEAD (even if they previously answered "Other
        // person" and filled in medical questions during an earlier
        // pass through this step via Back).
        if (label !== OTHER_PERSON) clearHotLeadAnswers();
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // Clears has_hired_attorney / interested_in_attorney / primary_fault
  // (the full attorney/liability qualification chain) plus any HOT
  // LEAD medical answers. Used whenever an upstream answer (recency or
  // case status) changes such that the whole branch is no longer
  // qualified — see bindQ4()/bindQ6() above. There must be no
  // possibility of a hidden stale answer producing a false HOT LEAD.
  function clearQualificationAnswers() {
    STATE.answers.has_hired_attorney = null;
    STATE.answers.interested_in_attorney = null;
    STATE.answers.primary_fault = "";
    clearHotLeadAnswers();
  }

  function clearHotLeadAnswers() {
    STATE.answers.injuries = [];
    STATE.answers.medical_treatment_timing = "";
    // had_car_insurance is no longer collected by any question as of
    // this revision (the insurance question was removed — see the
    // removal note below), so this line is now a harmless no-op that
    // resets an already-always-blank field. Left in place rather than
    // removed: it costs nothing, and it keeps this function's shape
    // stable in case the field is ever revisited.
    STATE.answers.had_car_insurance = "";
  }

  // HOT LEAD Question 1 — injuries (multi-select). Only reachable when
  // isHotLead() is true (see currentSequence()).
  function qInjuriesTemplate() {
    var optionsHtml = INJURY_OPTIONS.map(function (label, i) {
      var checked = STATE.answers.injuries.indexOf(label) !== -1;
      return (
        '<label class="apply-checkbox-card' + (checked ? " selected" : "") + '" for="qInjuriesOpt' + i + '">' +
        '<input type="checkbox" id="qInjuriesOpt' + i + '"' + (checked ? " checked" : "") + ">" +
        "<span>" + escapeHtml(label) + "</span>" +
        "</label>"
      );
    }).join("");
    return (
      '<p class="apply-question">What injuries did you have?</p>' +
      '<p class="apply-subtext">Select all that apply.</p>' +
      '<div class="apply-checkbox-list">' + optionsHtml + "</div>" +
      '<p class="apply-error-text" id="qInjuriesError"></p>' +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="qInjuriesContinue">Continue</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQInjuries() {
    INJURY_OPTIONS.forEach(function (label, i) {
      var checkbox = document.getElementById("qInjuriesOpt" + i);
      checkbox.addEventListener("change", function () {
        var idx = STATE.answers.injuries.indexOf(label);
        if (checkbox.checked && idx === -1) {
          STATE.answers.injuries.push(label);
        } else if (!checkbox.checked && idx !== -1) {
          STATE.answers.injuries.splice(idx, 1);
        }
        checkbox.closest(".apply-checkbox-card").classList.toggle("selected", checkbox.checked);
      });
    });
    document.getElementById("qInjuriesContinue").addEventListener("click", function () {
      if (STATE.answers.injuries.length === 0) {
        document.getElementById("qInjuriesError").textContent = "Please select at least one option.";
        return;
      }
      STATE.step = STATE.step + 1;
      render();
    });
    bindBack();
  }

  // HOT LEAD Question 2 — medical treatment timing (single-select).
  function qTreatmentTemplate() {
    var optionsHtml = TREATMENT_TIMING_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="qTreatmentOpt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">How soon after the accident did you get medical treatment?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQTreatment() {
    TREATMENT_TIMING_OPTIONS.forEach(function (label, i) {
      document.getElementById("qTreatmentOpt" + i).addEventListener("click", function () {
        STATE.answers.medical_treatment_timing = label;
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // HOT LEAD Question 3 — "Did you have car insurance when the
  // accident happened?" — REMOVED as of this revision. qInsuranceTemplate()
  // / bindQInsurance() no longer exist; the "insurance" key was also
  // removed from currentSequence()'s HOT LEAD branch (see above) and
  // from stepTemplate()/bindStepEvents()'s switch statements, so this
  // question can no longer be reached from any branch. had_car_insurance
  // stays a defined answers field/Sheet column, submitted permanently
  // blank — see clearHotLeadAnswers() above and the COLUMNS comment in
  // submit-story-application.js.

  // Q7 — on-camera comfort (does NOT disqualify on "No")
  function q7Template() {
    var optionsHtml = COMFORT_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q7Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Are you comfortable being on camera for a short recorded interview?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQ7() {
    COMFORT_OPTIONS.forEach(function (label, i) {
      document.getElementById("q7Opt" + i).addEventListener("click", function () {
        STATE.answers.on_camera_comfort = label;
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }

  // Q8 — contact info + consent + submit
  // Q8 — contact/payment info. As of this revision, this step no
  // longer submits the application or collects consent — see
  // qConsentTemplate() below, which is now the only place consent is
  // gathered and the only place handleSubmit() is called from. This
  // step now only validates phone/email/address and advances to the
  // new consent step.
  function q8Template() {
    var steps = (typeof APPLY_CONFIG !== "undefined" && APPLY_CONFIG.PAYMENT_DISCLOSURE_STEPS) || [];
    var stepsHtml = steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
    return (
      '<p class="apply-question">Last step &mdash; how can we reach you?</p>' +
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Phone">Phone</label>' +
      '<input type="tel" id="q8Phone" placeholder="(555) 555-5555" value="' + escapeAttr(STATE.answers.phone) + '">' +
      // Dedicated phone-specific error, placed immediately after the
      // phone input and inside its own field-group — so it renders
      // directly beneath the phone field and above the email
      // label/input, never intermixed with email/address errors (see
      // the shared #q8Error below, which those still use unchanged).
      '<p class="apply-error-text" id="q8PhoneError"></p>' +
      "</div>" +
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Email">Email</label>' +
      '<input type="email" id="q8Email" placeholder="you@example.com" value="' + escapeAttr(STATE.answers.email) + '">' +
      "</div>" +
      // NEW — Address, collected alongside Phone/Email. Plain text
      // input (no format validation beyond "not empty"), same pattern
      // Email already uses.
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Address">Address</label>' +
      '<input type="text" id="q8Address" placeholder="Street address, city, state" value="' + escapeAttr(STATE.answers.address) + '">' +
      "</div>" +
      '<p class="apply-error-text" id="q8Error"></p>' +
      '<div class="apply-info-card" style="padding:16px 16px 14px;margin-bottom:0;">' +
      '<h2 style="font-size:14px;">To receive the $50:</h2>' +
      '<ol style="margin:0;">' + stepsHtml + "</ol>" +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q8Continue">Review &amp; Continue</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ8() {
    var phone = document.getElementById("q8Phone");
    var email = document.getElementById("q8Email");
    var address = document.getElementById("q8Address");
    document.getElementById("q8Continue").addEventListener("click", function () {
      validateAndContinue(phone.value, email.value, address.value);
    });
    bindBack();
  }

  // Validates Phone/Email/Address and advances to the new consent
  // step — does NOT submit. Renamed from the old validateAndSubmit()
  // (which both validated AND submitted); submission now only ever
  // happens from validateAndSubmitFromConsent() below.
  function validateAndContinue(phoneVal, emailVal, addressVal) {
    var normalizedPhone = normalizePhone(phoneVal);
    var email = (emailVal || "").trim();
    var address = (addressVal || "").trim();
    var phoneErrorEl = document.getElementById("q8PhoneError");
    var errorEl = document.getElementById("q8Error");

    // Clear both error slots on every attempt so a stale message from a
    // previous failed attempt (e.g. a phone error) doesn't linger once
    // that specific problem has been fixed.
    if (phoneErrorEl) phoneErrorEl.textContent = "";
    if (errorEl) errorEl.textContent = "";

    // Checked first, and rendered into its own element directly below
    // the phone field (q8PhoneError — see q8Template()) rather than the
    // shared q8Error used by the other checks below, so an applicant
    // with a malformed number sees the message right where the problem
    // is instead of down near email/address. This only confirms the
    // number has 10 digits after normalization — it does not (and is
    // not claimed to) verify the number belongs to the applicant or is
    // active. The server independently re-normalizes and re-validates
    // this exact same way (see normalizePhone() in
    // netlify/functions/submit-story-application.js) rather than
    // trusting this client-side check. Unchanged from before this
    // revision.
    if (normalizedPhone.length !== 10) {
      if (phoneErrorEl) phoneErrorEl.textContent = "Please enter a valid 10-digit phone number.";
      return;
    }
    if (!email) {
      if (errorEl) errorEl.textContent = "Please enter both a phone number and an email address.";
      return;
    }
    if (!address) {
      if (errorEl) errorEl.textContent = "Please enter your address.";
      return;
    }

    // Store the normalized 10-digit form — never the raw, differently
    // formatted value the applicant typed — so this is exactly what
    // gets submitted (and independently re-validated + written to the
    // Sheet server-side).
    STATE.answers.phone = normalizedPhone;
    STATE.answers.email = email;
    STATE.answers.address = address;
    STATE.step = STATE.step + 1;
    render();
  }

  // Consent step — the only place consent is gathered and the only
  // place that actually submits the application (see
  // validateAndSubmitFromConsent() below). As of this revision there
  // is exactly ONE checkbox on this page (id "qConsentAgreement",
  // unchanged from before to minimize churn), required to submit.
  // For HOT LEAD applicants, both the attorney-contact paragraph and
  // the application-agreement paragraph are shown as plain text above
  // that single checkbox; checking it constitutes acceptance of BOTH,
  // so attorney_contact_consent and application_agreement_consent are
  // both recorded as true. For non-HOT-LEAD applicants, the attorney
  // paragraph is never shown at all (no heading, no copy, no gap) —
  // only the application-agreement paragraph appears — and checking
  // the box records application_agreement_consent = true while
  // attorney_contact_consent is hardcoded false (never tied to this
  // checkbox for them, since they were never offered that option).
  // The checkbox is never pre-checked, regardless of any earlier
  // answer — this is the applicant's own final affirmative consent.
  function qConsentTemplate() {
    var hotLead = isHotLead();
    var attorneyParagraph = !hotLead ? "" : (
      '<p class="apply-consent-text" style="margin:0 0 10px;">Crash2Claim may share my contact and accident information with an independent attorney or legal service provider who may contact me about my accident. Crash2Claim may receive compensation for this connection. This does not create an attorney-client relationship.</p>'
    );
    return (
      '<p class="apply-question">Almost done &mdash; one final step</p>' +
      '<p class="apply-subtext">Review the options below, then submit your application.</p>' +
      attorneyParagraph +
      '<p class="apply-consent-text" style="margin:0 0 10px;">I confirm that I am 18 or older, the information I provided is accurate, and I understand that applying does not guarantee an interview, publication, or payment. The $50 payment is earned only if Crash2Claim accepts my completed recorded interview for publication. Crash2Claim is not a law firm and does not provide legal advice.</p>' +
      '<div class="apply-field-group">' +
      '<div class="apply-consent-row">' +
      '<input type="checkbox" id="qConsentAgreement"' + (STATE.answers.consent === true ? " checked" : "") + '>' +
      '<label class="apply-consent-text" for="qConsentAgreement">I agree and consent to the above.</label>' +
      "</div>" +
      '<p class="apply-error-text" id="qConsentError"></p>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="qConsentSubmit">Submit My Application</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQConsent() {
    var agreementCheckbox = document.getElementById("qConsentAgreement");
    document.getElementById("qConsentSubmit").addEventListener("click", function () {
      validateAndSubmitFromConsent(agreementCheckbox.checked);
    });
    bindBack();
  }

  // The single consent checkbox is required to submit. This is the
  // ONLY function in the whole flow that calls handleSubmit().
  // attorney_contact_consent is derived from isHotLead() at the
  // moment of a successful check — true for HOT LEAD applicants
  // (who saw and agreed to the attorney paragraph), false for
  // everyone else (who never saw it, so it can't be their consent).
  function validateAndSubmitFromConsent(agreementChecked) {
    var errorEl = document.getElementById("qConsentError");
    if (errorEl) errorEl.textContent = "";

    if (!agreementChecked) {
      if (errorEl) errorEl.textContent = "Please agree and consent to the above to submit your application.";
      return;
    }
    if (STATE.isSubmitting || STATE.hasSubmitted) return;

    STATE.answers.consent = true;
    STATE.answers.consent_timestamp = new Date().toISOString();
    // Derived, not a separate checkbox: HOT LEAD applicants saw and
    // agreed to the attorney paragraph as part of this single
    // checkbox, so it's true for them and only them.
    STATE.answers.attorney_contact_consent = isHotLead();

    handleSubmit();
  }

  // Any synchronous exception thrown while preparing/dispatching the
  // submission (generateApplicantId(), buildApplicationPayload(), or
  // the sendApplicationPayload() call itself) must never leave
  // STATE.isSubmitting stuck true — validateAndSubmit() silently
  // no-ops on every future click once that flag is stuck (see its
  // guard above), which is exactly what made Submit look completely
  // dead with nothing reaching the network. Both prep steps (the ID
  // generator from apply-payload.js and the payload builder) and the
  // call that kicks off the network request are all covered by the
  // same try/catch below, so ANY error in this synchronous chain
  // resets isSubmitting, shows a visible retryable message instead of
  // a silent dead button, and logs the real error for diagnosis. Only
  // the .then()/.catch() on the returned promise (the actual
  // send/response handling) runs outside the try, since that's
  // asynchronous and already has its own error handling below. No
  // change to payload contents, applicant ID format, endpoint,
  // qualification logic, or Sheet mapping.
  function handleSubmit() {
    STATE.isSubmitting = true;

    var sendPromise;
    try {
      STATE.applicantId = generateApplicantId();
      var payload = buildApplicationPayload(STATE.answers, STATE.applicantId, isTestMode);
      sendPromise = sendApplicationPayload(payload);
    } catch (prepErr) {
      STATE.isSubmitting = false;
      console.error("[apply] Failed to prepare/send submission:", prepErr);
      // handleSubmit() is now only ever called from the consent step
      // (see validateAndSubmitFromConsent() above), so the error slot
      // is qConsentError, not the old q8Error.
      var errorEl = document.getElementById("qConsentError");
      if (errorEl) errorEl.textContent = "Something went wrong preparing your application. Please try again.";
      return;
    }

    sendPromise
      .then(function (result) {
        STATE.isSubmitting = false;
        STATE.hasSubmitted = true;
        STATE.webhookWarning = !result.ok;
        // The server checks email/phone against existing applicants and
        // reports duplicate:true instead of writing a second row — see
        // netlify/functions/submit-story-application.js. The applicant
        // still reaches a clean final screen either way, just with
        // different copy (never an accusatory error).
        STATE.isDuplicate = !!result.duplicate;
        STATE.step = STATE.step + 1;
        render();
      })
      .catch(function (sendErr) {
        // sendApplicationPayload() already catches its own network
        // errors internally and resolves rather than rejects, so this
        // is a last-resort safety net in case that ever changes.
        STATE.isSubmitting = false;
        console.error("[apply] Unexpected error sending submission:", sendErr);
        var errorEl = document.getElementById("qConsentError");
        if (errorEl) errorEl.textContent = "Something went wrong submitting your application. Please try again.";
      });
  }

  // -----------------------------------------------------------------
  // Thank-you (final) screen
  // -----------------------------------------------------------------
  function thankYouTemplate() {
    if (STATE.isDuplicate) {
      return (
        '<div class="apply-card">' +
        '<h2 class="apply-thankyou-title">You\'re all set.</h2>' +
        '<p class="apply-thankyou-body">It looks like you\'ve already submitted an application. If we need anything else, we\'ll be in touch.</p>' +
        "</div>"
      );
    }
    return (
      '<div class="apply-card">' +
      '<h2 class="apply-thankyou-title">Application received.</h2>' +
      '<p class="apply-thankyou-body">Thanks for applying to share your story. We review applications on a rolling basis. If we\'re interested in moving forward, we\'ll reach out by phone or email to schedule a short pre-screen conversation.</p>' +
      '<p class="apply-thankyou-body">Applying doesn\'t guarantee selection or payment, and not everyone who applies will be contacted.</p>' +
      '<p class="apply-thankyou-note">Reference ID: ' + escapeHtml(STATE.applicantId || "") + "</p>" +
      "</div>"
    );
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------
  // Strips formatting (parentheses, spaces, hyphens, etc.) down to
  // digits only, then drops a leading US country-code "1" when exactly
  // 11 digits remain — so "5615551234", "(561) 555-1234", and
  // "+1 (561) 555-1234" all normalize to the identical 10-digit value
  // "5615551234". Deliberately mirrors normalizePhone() in
  // netlify/functions/submit-story-application.js byte-for-byte; the
  // server independently re-normalizes and re-validates rather than
  // ever trusting this client-side result.
  function normalizePhone(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.charAt(0) === "1") {
      digits = digits.slice(1);
    }
    return digits;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }

  // Parses a "YYYY-MM-DD" string (the native <input type="date">
  // value format) into a local-time Date at midnight, or returns null
  // for anything that isn't a real calendar date. Explicitly rejects
  // impossible dates (e.g. "2024-02-30", "2024-04-31") by checking
  // that the constructed Date's own year/month/day round-trip back to
  // exactly what was typed — JS's Date constructor silently rolls
  // impossible dates over into the next valid date instead of
  // erroring (new Date(2024, 1, 30) becomes March 1), so that
  // round-trip check is the only reliable way to catch them. Also
  // rejects blank input and anything not matching the expected shape
  // (the regex simply won't match).
  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }
  function parseDob(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!m) return null;
    var year = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    var day = parseInt(m[3], 10);
    var d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  // Full-DOB age calculation — NOT a simple year subtraction. Accounts
  // for whether the birthday has actually occurred yet relative to
  // "today": an applicant whose 18th birthday is tomorrow is still 17
  // today; an applicant whose 18th birthday is today already qualifies.
  function calculateAge(birthDate, today) {
    var age = today.getFullYear() - birthDate.getFullYear();
    var monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }
})();
