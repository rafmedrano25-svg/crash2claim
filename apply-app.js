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
  // fixed questions: name, age, state, timeframe, story, situation)
  // plus the 2 trailing questions (on-camera comfort, contact/consent)
  // = 9 for every applicant. It's 10 when the attorney-interest
  // question qualifies (see isAttorneyQuestionQualified()), and 13 for
  // a HOT LEAD applicant (attorney question + injuries + treatment +
  // insurance). Nothing in this file assumes a fixed total — see
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
  var TIMEFRAME_OPTIONS = ["Within the last 2 years", "More than 2 years ago"];
  var SITUATION_OPTIONS = ["Settled", "Still ongoing", "Not sure"];
  var COMFORT_OPTIONS = ["Yes", "Maybe", "No"];
  var ATTORNEY_INTEREST_OPTIONS = ["Yes", "No"];
  var NEW_YORK = "New York";
  var WITHIN_2_YEARS = "Within the last 2 years";
  var STILL_ONGOING = "Still ongoing";
 
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
  var INJURY_OPTIONS = ["Back or neck pain", "Broken bones", "Cuts or bruises", "Head injury", "Other"];
  var TREATMENT_TIMING_OPTIONS = ["Within the first week", "More than a week later", "I didn't get treatment"];
  var INSURANCE_OPTIONS = ["Yes", "No"];
 
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
      is_18: null,
      state: "",
      accident_timeframe: "",
      story_summary: "",
      situation_status: "",
      interested_in_attorney: null, // true/false/null — only asked when qualified, see isAttorneyQuestionQualified()
      injuries: [], // HOT LEAD only — array of selected labels
      medical_treatment_timing: "", // HOT LEAD only
      had_car_insurance: "", // HOT LEAD only
      on_camera_comfort: "",
      phone: "",
      email: "",
      consent: false,
      consent_timestamp: "",
    },
  };
 
  // The attorney-interest question requires BOTH conditions to be true:
  //   1. Accident happened within the last 2 years (Q4)
  //   2. Situation is "Still ongoing" (Q6) — "Settled" and "Not sure"
  //      are both excluded. "Not sure" is deliberately NOT treated as
  //      unsettled; situation_status is still recorded either way so
  //      those applicants remain reviewable in the Sheet.
  function isAttorneyQuestionQualified() {
    return STATE.answers.accident_timeframe === WITHIN_2_YEARS && STATE.answers.situation_status === STILL_ONGOING;
  }
 
  // HOT LEAD = within 2 years + still ongoing + answered Yes to the
  // attorney question. Written out in full (rather than just checking
  // interested_in_attorney) so it stays correct even if the applicant
  // backs up and changes an earlier answer. This is a CLIENT-side
  // mirror only, used purely to decide which questions to show next —
  // the authoritative lead_status is computed server-side at
  // submission time (see netlify/functions/submit-story-application.js)
  // and never trusts a value sent from the browser.
  function isHotLead() {
    return isAttorneyQuestionQualified() && STATE.answers.interested_in_attorney === true;
  }
 
  // Ordered list of logical question keys for the CURRENT applicant.
  // "paymentIntent" always comes first. 1–6 are the fixed base
  // questions (name, age, state, timeframe, story, situation).
  // "attorney" is inserted only when isAttorneyQuestionQualified() is
  // true. "injuries"/"treatment"/"insurance" are inserted only for
  // HOT LEAD applicants (isHotLead()). 7–8 are the existing
  // comfort/contact questions, reused unchanged — they just move
  // position depending on which conditional questions are present.
  function currentSequence() {
    var seq = ["paymentIntent", 1, 2, 3, 4, 5, 6];
    if (isAttorneyQuestionQualified()) seq.push("attorney");
    if (isHotLead()) seq.push("injuries", "treatment", "insurance");
    seq.push(7, 8);
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
  // No-op on button-only questions (Q2, Q4, Q6, Q7).
  function focusFirstField(step) {
    var key = currentSequence()[step - 1];
    var idByKey = { 1: "q1Input", 3: "q3Input", 5: "q5Input", 8: "q8Phone" };
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
      case "attorney": body = qAttorneyTemplate(); break;
      case "injuries": body = qInjuriesTemplate(); break;
      case "treatment": body = qTreatmentTemplate(); break;
      case "insurance": body = qInsuranceTemplate(); break;
      case 7: body = q7Template(); break;
      case 8: body = q8Template(); break;
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
      case "attorney": bindQAttorney(); break;
      case "injuries": bindQInjuries(); break;
      case "treatment": bindQTreatment(); break;
      case "insurance": bindQInsurance(); break;
      case 7: bindQ7(); break;
      case 8: bindQ8(); break;
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
 
  // Q1 — first name
  function q1Template() {
    return (
      '<p class="apply-question">What\'s your first name?</p>' +
      '<div class="apply-field-group">' +
      '<input type="text" id="q1Input" maxlength="60" placeholder="First name" value="' + escapeAttr(STATE.answers.first_name) + '">' +
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
        document.getElementById("q1Error").textContent = "Please enter your first name.";
        return;
      }
      STATE.answers.first_name = val;
      STATE.step = STATE.step + 1;
      render();
    });
    bindBack();
  }
 
  // Q2 — 18+ confirmation
  function q2Template() {
    return (
      '<p class="apply-question">Are you 18 or older?</p>' +
      '<div class="apply-answer-list">' +
      '<button type="button" class="apply-answer-btn" id="q2Yes">Yes</button>' +
      '<button type="button" class="apply-answer-btn" id="q2No">No</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ2() {
    document.getElementById("q2Yes").addEventListener("click", function () {
      STATE.answers.is_18 = true;
      STATE.step = STATE.step + 1;
      render();
    });
    document.getElementById("q2No").addEventListener("click", function () {
      STATE.answers.is_18 = false;
      STATE.step = -1;
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
 
  // Q6 — situation status. "Still ongoing" (combined with an
  // accident within the last 2 years — see isAttorneyQuestionQualified())
  // triggers the attorney-interest question next. "Not sure" is
  // deliberately NOT treated as unsettled/qualifying.
  function q6Template() {
    var optionsHtml = SITUATION_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q6Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">What\'s the status of your situation now?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQ6() {
    SITUATION_OPTIONS.forEach(function (label, i) {
      document.getElementById("q6Opt" + i).addEventListener("click", function () {
        STATE.answers.situation_status = label;
        // If this answer means the attorney question is no longer
        // qualified (e.g. it was showing and is now not needed because
        // the applicant backed up and changed an answer), drop any
        // previously recorded value so it never carries a stale
        // interested_in_attorney (or stale HOT LEAD case-detail
        // answers) into the payload.
        if (!isAttorneyQuestionQualified()) {
          STATE.answers.interested_in_attorney = null;
          clearHotLeadAnswers();
        }
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }
 
  // Attorney-interest question — only shown when both conditions in
  // isAttorneyQuestionQualified() are true (see currentSequence()).
  // Does not disqualify either way.
  function qAttorneyTemplate() {
    var optionsHtml = ATTORNEY_INTEREST_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="qAttorneyOpt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Are you interested in speaking with an attorney about your case?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQAttorney() {
    ATTORNEY_INTEREST_OPTIONS.forEach(function (label, i) {
      document.getElementById("qAttorneyOpt" + i).addEventListener("click", function () {
        STATE.answers.interested_in_attorney = label === "Yes";
        // "No" means this applicant is not a HOT LEAD (even if they
        // previously answered Yes and filled in the case-detail
        // questions during an earlier pass through this step via Back).
        if (label !== "Yes") clearHotLeadAnswers();
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }
 
  function clearHotLeadAnswers() {
    STATE.answers.injuries = [];
    STATE.answers.medical_treatment_timing = "";
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
 
  // HOT LEAD Question 3 — had car insurance (single-select).
  function qInsuranceTemplate() {
    var optionsHtml = INSURANCE_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="qInsuranceOpt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Did you have car insurance when the accident happened?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton()
    );
  }
  function bindQInsurance() {
    INSURANCE_OPTIONS.forEach(function (label, i) {
      document.getElementById("qInsuranceOpt" + i).addEventListener("click", function () {
        STATE.answers.had_car_insurance = label;
        STATE.step = STATE.step + 1;
        render();
      });
    });
    bindBack();
  }
 
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
  function q8Template() {
    var steps = (typeof APPLY_CONFIG !== "undefined" && APPLY_CONFIG.PAYMENT_DISCLOSURE_STEPS) || [];
    var stepsHtml = steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
    var consentText = (typeof APPLY_CONFIG !== "undefined" && APPLY_CONFIG.RECRUITMENT_CONSENT) || "";
    return (
      '<p class="apply-question">Last step &mdash; how can we reach you?</p>' +
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Phone">Phone</label>' +
      '<input type="tel" id="q8Phone" placeholder="(555) 555-5555" value="' + escapeAttr(STATE.answers.phone) + '">' +
      "</div>" +
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Email">Email</label>' +
      '<input type="email" id="q8Email" placeholder="you@example.com" value="' + escapeAttr(STATE.answers.email) + '">' +
      "</div>" +
      '<p class="apply-error-text" id="q8Error"></p>' +
      '<div class="apply-info-card" style="padding:16px 16px 14px;margin-bottom:0;">' +
      '<h2 style="font-size:14px;">To receive the $50:</h2>' +
      '<ol style="margin:0;">' + stepsHtml + "</ol>" +
      "</div>" +
      '<div class="apply-consent-row">' +
      '<input type="checkbox" id="q8Consent">' +
      '<label class="apply-consent-text" for="q8Consent">' + escapeHtml(consentText) + "</label>" +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q8Submit">Submit Application</button>' +
      "</div>" +
      backButton()
    );
  }
  function bindQ8() {
    var phone = document.getElementById("q8Phone");
    var email = document.getElementById("q8Email");
    var consent = document.getElementById("q8Consent");
    document.getElementById("q8Submit").addEventListener("click", function () {
      validateAndSubmit(phone.value, email.value, consent.checked);
    });
    bindBack();
  }
 
  function validateAndSubmit(phoneVal, emailVal, consentChecked) {
    var phone = (phoneVal || "").trim();
    var email = (emailVal || "").trim();
    var errorEl = document.getElementById("q8Error");
 
    if (!phone || !email) {
      if (errorEl) errorEl.textContent = "Please enter both a phone number and an email address.";
      return;
    }
    if (!consentChecked) {
      if (errorEl) errorEl.textContent = "Please check the box to confirm before submitting.";
      return;
    }
    if (STATE.isSubmitting || STATE.hasSubmitted) return;
 
    STATE.answers.phone = phone;
    STATE.answers.email = email;
    STATE.answers.consent = true;
    STATE.answers.consent_timestamp = new Date().toISOString();
 
    handleSubmit();
  }
 
  function handleSubmit() {
    STATE.isSubmitting = true;
    STATE.applicantId = generateApplicantId();
 
    var payload = buildApplicationPayload(STATE.answers, STATE.applicantId, isTestMode);
 
    sendApplicationPayload(payload).then(function (result) {
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
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;");
  }
})();
