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
 * card. Clicking that button sets STATE.step = 1 and renders Q1.
 * -----------------------------------------------------------------
 */

(function () {
  "use strict";

  var TOTAL_STEPS = 8;
  var applyRoot = document.getElementById("applyRoot");

  var params = new URLSearchParams(window.location.search);
  var isTestMode = params.get("test") === "1";

  var TIMEFRAME_OPTIONS = ["This year", "1–2 years ago", "3–5 years ago", "More than 5 years ago"];
  var SITUATION_OPTIONS = ["Settled / closed", "Still ongoing", "Not sure", "Other"];
  var COMFORT_OPTIONS = ["Yes", "Maybe", "No"];

  // Layout-only: percentage shown alongside "Question X of 8" in
  // application mode. Index 0 = step 1 ... index 7 = step 8.
  var PROGRESS_PERCENT = [12, 25, 37, 50, 62, 75, 87, 100];

  var STATE = {
    step: 0, // 0 = nothing rendered (static hero button starts flow), -1 = age-gate stop, 1-8 = questions, 9 = thank-you
    isSubmitting: false,
    hasSubmitted: false,
    applicantId: null,
    webhookWarning: false,
    answers: {
      first_name: "",
      is_18: null,
      state: "",
      accident_timeframe: "",
      story_summary: "",
      situation_status: "",
      on_camera_comfort: "",
      phone: "",
      email: "",
      consent: false,
      consent_timestamp: "",
    },
  };

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
    var percent = PROGRESS_PERCENT[step - 1];
    return (
      '<div class="apply-app-header">' +
      '<p class="apply-app-eyebrow">Your Story Application</p>' +
      '<div class="apply-progress-row"><span>Question ' + step + " of " + TOTAL_STEPS + "</span><span>" + percent + "%</span></div>" +
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
    if (STATE.step >= 1 && STATE.step <= TOTAL_STEPS) {
      applyRoot.innerHTML = progressHeaderHtml(STATE.step) + stepTemplate(STATE.step);
      bindStepEvents(STATE.step);
      scrollToTopIfAppMode();
      focusFirstField(STATE.step);
      return;
    }
    if (STATE.step === TOTAL_STEPS + 1) {
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
    var idByStep = { 1: "q1Input", 3: "q3Input", 5: "q5Input", 8: "q8Phone" };
    var id = idByStep[step];
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
  // Question steps
  // -----------------------------------------------------------------
  function stepTemplate(step) {
    // Note: the old inline "Question X of Y" line is now rendered by
    // progressHeaderHtml() above the card (see render()), so the card
    // itself only contains the question body.
    var body = "";
    switch (step) {
      case 1: body = q1Template(); break;
      case 2: body = q2Template(); break;
      case 3: body = q3Template(); break;
      case 4: body = q4Template(); break;
      case 5: body = q5Template(); break;
      case 6: body = q6Template(); break;
      case 7: body = q7Template(); break;
      case 8: body = q8Template(); break;
    }
    return '<div class="apply-card">' + body + "</div>";
  }

  function bindStepEvents(step) {
    switch (step) {
      case 1: bindQ1(); break;
      case 2: bindQ2(); break;
      case 3: bindQ3(); break;
      case 4: bindQ4(); break;
      case 5: bindQ5(); break;
      case 6: bindQ6(); break;
      case 7: bindQ7(); break;
      case 8: bindQ8(); break;
    }
  }

  function backButton(toStep) {
    return '<button type="button" class="apply-btn-back" id="stepBack">&larr; Back</button>';
  }
  function bindBack(toStep) {
    var back = document.getElementById("stepBack");
    if (back) {
      back.addEventListener("click", function () {
        STATE.step = toStep;
        render();
      });
    }
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
      "</div>"
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
      STATE.step = 2;
      render();
    });
  }

  // Q2 — 18+ confirmation
  function q2Template() {
    return (
      '<p class="apply-question">Are you 18 or older?</p>' +
      '<div class="apply-answer-list">' +
      '<button type="button" class="apply-answer-btn" id="q2Yes">Yes</button>' +
      '<button type="button" class="apply-answer-btn" id="q2No">No</button>' +
      "</div>" +
      backButton(1)
    );
  }
  function bindQ2() {
    document.getElementById("q2Yes").addEventListener("click", function () {
      STATE.answers.is_18 = true;
      STATE.step = 3;
      render();
    });
    document.getElementById("q2No").addEventListener("click", function () {
      STATE.answers.is_18 = false;
      STATE.step = -1;
      render();
    });
    bindBack(1);
  }

  // Q3 — state
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
      backButton(2)
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
      STATE.step = 4;
      render();
    });
    bindBack(2);
  }

  // Q4 — accident timeframe
  function q4Template() {
    var optionsHtml = TIMEFRAME_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q4Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">When did the accident happen?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton(3)
    );
  }
  function bindQ4() {
    TIMEFRAME_OPTIONS.forEach(function (label, i) {
      document.getElementById("q4Opt" + i).addEventListener("click", function () {
        STATE.answers.accident_timeframe = label;
        STATE.step = 5;
        render();
      });
    });
    bindBack(3);
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
      backButton(4)
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
      STATE.step = 6;
      render();
    });
    bindBack(4);
  }

  // Q6 — situation status
  function q6Template() {
    var optionsHtml = SITUATION_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q6Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">What\'s the status of your situation now?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton(5)
    );
  }
  function bindQ6() {
    SITUATION_OPTIONS.forEach(function (label, i) {
      document.getElementById("q6Opt" + i).addEventListener("click", function () {
        STATE.answers.situation_status = label;
        STATE.step = 7;
        render();
      });
    });
    bindBack(5);
  }

  // Q7 — on-camera comfort (does NOT disqualify on "No")
  function q7Template() {
    var optionsHtml = COMFORT_OPTIONS.map(function (label, i) {
      return '<button type="button" class="apply-answer-btn" id="q7Opt' + i + '">' + label + "</button>";
    }).join("");
    return (
      '<p class="apply-question">Are you comfortable being on camera for a short recorded interview?</p>' +
      '<div class="apply-answer-list">' + optionsHtml + "</div>" +
      backButton(6)
    );
  }
  function bindQ7() {
    COMFORT_OPTIONS.forEach(function (label, i) {
      document.getElementById("q7Opt" + i).addEventListener("click", function () {
        STATE.answers.on_camera_comfort = label;
        STATE.step = 8;
        render();
      });
    });
    bindBack(6);
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
      '<h2 style="font-size:14px;">$50 is paid after you:</h2>' +
      '<ol style="margin:0;">' + stepsHtml + "</ol>" +
      "</div>" +
      '<div class="apply-consent-row">' +
      '<input type="checkbox" id="q8Consent">' +
      '<label class="apply-consent-text" for="q8Consent">' + escapeHtml(consentText) + "</label>" +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q8Submit">Submit Application</button>' +
      "</div>" +
      backButton(7)
    );
  }
  function bindQ8() {
    var phone = document.getElementById("q8Phone");
    var email = document.getElementById("q8Email");
    var consent = document.getElementById("q8Consent");
    document.getElementById("q8Submit").addEventListener("click", function () {
      validateAndSubmit(phone.value, email.value, consent.checked);
    });
    bindBack(7);
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
      STATE.step = TOTAL_STEPS + 1;
      render();
    });
  }

  // -----------------------------------------------------------------
  // Thank-you (final) screen
  // -----------------------------------------------------------------
  function thankYouTemplate() {
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
