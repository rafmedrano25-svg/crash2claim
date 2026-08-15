/**
 * Crash2Claim — /apply Recruitment Application
 * -----------------------------------------------------------------
 * Owns the recruitment application state machine only. Completely
 * independent from js/app.js (the case-evaluation survey) — no
 * shared STATE, no shared step logic, no shared field names. Reads
 * js/config-apply.js and js/apply-payload.js, and the shared
 * js/attribution.js utility (unmodified).
 *
 * 8 questions, one per screen, mobile-first. Consent + submit live
 * on the final question screen, matching the same pattern already
 * used on the case-evaluation funnel's last step.
 * -----------------------------------------------------------------
 */

(function () {
  "use strict";

  var TOTAL_STEPS = 8;

  var applyRoot = document.getElementById("applyRoot");

  var params = new URLSearchParams(window.location.search);
  var isTestMode = params.get("test") === "1";

  var STATE = {
    step: 0, // 0 = intro/CTA, 1-8 = questions, 9 = thank-you, -1 = age-gate stop
    isSubmitting: false,
    hasSubmitted: false,
    applicantId: null,
    webhookWarning: false,
    answers: {
      first_name: "",
      is_18: null, // true | false | null
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
    render();
  });

  function render() {
    if (STATE.step === 0) {
      applyRoot.innerHTML = introTemplate();
      bindIntroEvents();
    } else if (STATE.step === -1) {
      applyRoot.innerHTML = ageGateStopTemplate();
    } else if (STATE.step >= 1 && STATE.step <= TOTAL_STEPS) {
      applyRoot.innerHTML = stepTemplate(STATE.step);
      bindStepEvents(STATE.step);
    } else if (STATE.step === TOTAL_STEPS + 1) {
      applyRoot.innerHTML = thankYouTemplate();
    }
    if (typeof applyRoot.scrollIntoView === "function") {
      applyRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function progressLabel(step) {
    return '<div class="apply-progress"><span>Question ' + step + " of " + TOTAL_STEPS + "</span></div>";
  }

  // ---------------------------------------------------------------
  // Intro / CTA card
  // ---------------------------------------------------------------
  function introTemplate() {
    return (
      '<div class="apply-card">' +
      '<h2 class="apply-question">Ready to share your story?</h2>' +
      '<p style="text-align:center; color:var(--gray-600); font-size:14px; margin:0 0 18px;">Takes about 2 minutes. No documents needed to apply.</p>' +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="startApplyBtn">Start Your Application</button>' +
      "</div>" +
      "</div>"
    );
  }

  function bindIntroEvents() {
    document.getElementById("startApplyBtn").addEventListener("click", function () {
      STATE.step = 1;
      render();
    });
  }

  // ---------------------------------------------------------------
  // Age-gate stop screen
  // ---------------------------------------------------------------
  function ageGateStopTemplate() {
    return (
      '<div class="apply-card">' +
      '<h2 class="apply-thankyou-title">Thanks for your interest</h2>' +
      '<p class="apply-thankyou-body">This opportunity is only open to applicants who are 18 years of age or older. We appreciate you stopping by.</p>' +
      "</div>"
    );
  }

  // ---------------------------------------------------------------
  // Step dispatch
  // ---------------------------------------------------------------
  function stepTemplate(step) {
    var backBtn = step > 1
      ? '<button type="button" class="apply-btn-back" id="applyBackBtn">&larr; Back</button>'
      : "";
    var body = "";
    if (step === 1) body = q1Template();
    if (step === 2) body = q2Template();
    if (step === 3) body = q3Template();
    if (step === 4) body = q4Template();
    if (step === 5) body = q5Template();
    if (step === 6) body = q6Template();
    if (step === 7) body = q7Template();
    if (step === 8) body = q8Template();

    return (
      progressLabel(step) +
      '<div class="apply-card">' +
      backBtn +
      body +
      "</div>"
    );
  }

  function bindStepEvents(step) {
    var backBtn = document.getElementById("applyBackBtn");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        STATE.step -= 1;
        render();
      });
    }
    if (step === 1) bindQ1();
    if (step === 2) bindQ2();
    if (step === 3) bindQ3();
    if (step === 4) bindQ4();
    if (step === 5) bindQ5();
    if (step === 6) bindQ6();
    if (step === 7) bindQ7();
    if (step === 8) bindQ8();
  }

  function goNext() {
    STATE.step += 1;
    render();
  }

  // ---------------------------------------------------------------
  // Q1 — First name
  // ---------------------------------------------------------------
  function q1Template() {
    return (
      '<h2 class="apply-question">What\'s your first name?</h2>' +
      '<div class="apply-field-group">' +
      '<input type="text" id="q1Input" autocomplete="given-name" value="' + escapeAttr(STATE.answers.first_name) + '">' +
      '<div class="apply-error-text" id="q1Error"></div>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q1Continue">Continue</button>' +
      "</div>"
    );
  }
  function bindQ1() {
    document.getElementById("q1Continue").addEventListener("click", function () {
      var val = document.getElementById("q1Input").value.trim();
      if (!val) {
        document.getElementById("q1Error").textContent = "Please enter your first name.";
        return;
      }
      STATE.answers.first_name = val;
      goNext();
    });
  }

  // ---------------------------------------------------------------
  // Q2 — 18+
  // ---------------------------------------------------------------
  function q2Template() {
    return (
      '<h2 class="apply-question">Are you 18 or older?</h2>' +
      '<div class="apply-answer-list">' +
      answerBtn("q2Yes", "Yes") +
      answerBtn("q2No", "No") +
      "</div>"
    );
  }
  function bindQ2() {
    document.getElementById("q2Yes").addEventListener("click", function () {
      STATE.answers.is_18 = true;
      goNext();
    });
    document.getElementById("q2No").addEventListener("click", function () {
      STATE.answers.is_18 = false;
      STATE.step = -1;
      render();
    });
  }

  // ---------------------------------------------------------------
  // Q3 — State
  // ---------------------------------------------------------------
  function q3Template() {
    var opts = APPLY_CONFIG.STATES.map(function (s) {
      var sel = STATE.answers.state === s ? " selected" : "";
      return '<option value="' + s + '"' + sel + ">" + s + "</option>";
    }).join("");
    return (
      '<h2 class="apply-question">What state did the accident happen in?</h2>' +
      '<div class="apply-field-group">' +
      '<select id="q3Input">' +
      '<option value="">Select a state&hellip;</option>' +
      opts +
      "</select>" +
      '<div class="apply-error-text" id="q3Error"></div>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q3Continue">Continue</button>' +
      "</div>"
    );
  }
  function bindQ3() {
    document.getElementById("q3Continue").addEventListener("click", function () {
      var val = document.getElementById("q3Input").value;
      if (!val) {
        document.getElementById("q3Error").textContent = "Please select a state.";
        return;
      }
      STATE.answers.state = val;
      goNext();
    });
  }

  // ---------------------------------------------------------------
  // Q4 — Accident timeframe
  // ---------------------------------------------------------------
  function q4Template() {
    var opts = ["This year", "1–2 years ago", "3–5 years ago", "More than 5 years ago"];
    return (
      '<h2 class="apply-question">Roughly when did the accident happen?</h2>' +
      '<div class="apply-answer-list">' +
      opts.map(function (o, i) {
        return answerBtn("q4Opt" + i, o, STATE.answers.accident_timeframe === o);
      }).join("") +
      "</div>"
    );
  }
  function bindQ4() {
    var opts = ["This year", "1–2 years ago", "3–5 years ago", "More than 5 years ago"];
    opts.forEach(function (o, i) {
      document.getElementById("q4Opt" + i).addEventListener("click", function () {
        STATE.answers.accident_timeframe = o;
        goNext();
      });
    });
  }

  // ---------------------------------------------------------------
  // Q5 — Short story
  // ---------------------------------------------------------------
  function q5Template() {
    return (
      '<h2 class="apply-question">In a few sentences, what happened?</h2>' +
      '<div class="apply-field-group">' +
      '<textarea id="q5Input" maxlength="500">' + escapeHtml(STATE.answers.story_summary) + "</textarea>" +
      '<div class="apply-char-count" id="q5Count">0 / 500</div>' +
      '<div class="apply-error-text" id="q5Error"></div>' +
      "</div>" +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q5Continue">Continue</button>' +
      "</div>"
    );
  }
  function bindQ5() {
    var input = document.getElementById("q5Input");
    var count = document.getElementById("q5Count");
    count.textContent = input.value.length + " / 500";
    input.addEventListener("input", function () {
      count.textContent = input.value.length + " / 500";
    });
    document.getElementById("q5Continue").addEventListener("click", function () {
      var val = input.value.trim();
      if (!val) {
        document.getElementById("q5Error").textContent = "Please briefly describe what happened.";
        return;
      }
      STATE.answers.story_summary = val;
      goNext();
    });
  }

  // ---------------------------------------------------------------
  // Q6 — Situation status
  // ---------------------------------------------------------------
  function q6Template() {
    var opts = ["Fully resolved / settled", "Still ongoing", "Never filed a claim", "Other"];
    return (
      '<h2 class="apply-question">Where does your situation stand today?</h2>' +
      '<div class="apply-answer-list">' +
      opts.map(function (o, i) {
        return answerBtn("q6Opt" + i, o, STATE.answers.situation_status === o);
      }).join("") +
      "</div>"
    );
  }
  function bindQ6() {
    var opts = ["Fully resolved / settled", "Still ongoing", "Never filed a claim", "Other"];
    opts.forEach(function (o, i) {
      document.getElementById("q6Opt" + i).addEventListener("click", function () {
        STATE.answers.situation_status = o;
        goNext();
      });
    });
  }

  // ---------------------------------------------------------------
  // Q7 — On-camera comfort
  // ---------------------------------------------------------------
  function q7Template() {
    var opts = ["Yes", "Maybe — I'd like to know more first", "No"];
    return (
      '<h2 class="apply-question">Would you be comfortable being recorded and having Crash2Claim publish your interview (with your permission)?</h2>' +
      '<div class="apply-answer-list">' +
      opts.map(function (o, i) {
        return answerBtn("q7Opt" + i, o, STATE.answers.on_camera_comfort === o);
      }).join("") +
      "</div>"
    );
  }
  function bindQ7() {
    var opts = ["Yes", "Maybe — I'd like to know more first", "No"];
    opts.forEach(function (o, i) {
      document.getElementById("q7Opt" + i).addEventListener("click", function () {
        STATE.answers.on_camera_comfort = o;
        goNext(); // "No" still proceeds to finish the application — not an automatic disqualifier
      });
    });
  }

  // ---------------------------------------------------------------
  // Q8 — Contact info + consent + submit
  // ---------------------------------------------------------------
  function q8Template() {
    var a = STATE.answers;
    var stepsHtml = APPLY_CONFIG.PAYMENT_DISCLOSURE_STEPS.map(function (s) {
      return "<li>" + s + "</li>";
    }).join("");
    return (
      '<h2 class="apply-question">Best way to reach you</h2>' +
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Phone">Phone number</label>' +
      '<input type="tel" id="q8Phone" autocomplete="tel" value="' + escapeAttr(a.phone) + '">' +
      '<div class="apply-error-text" id="q8PhoneError"></div>' +
      "</div>" +
      '<div class="apply-field-group">' +
      '<label class="apply-field-label" for="q8Email">Email address</label>' +
      '<input type="email" id="q8Email" autocomplete="email" value="' + escapeAttr(a.email) + '">' +
      '<div class="apply-error-text" id="q8EmailError"></div>' +
      "</div>" +
      '<div class="apply-info-card" style="padding:16px; margin-bottom:12px;">' +
      "<p style=\"margin:0 0 6px; font-weight:700; color:var(--navy); font-size:13px;\">$50 is paid after you:</p>" +
      '<ol style="font-size:13px;">' + stepsHtml + "</ol>" +
      "</div>" +
      '<label class="apply-consent-row" for="q8Consent">' +
      '<input type="checkbox" id="q8Consent"' + (a.consent ? " checked" : "") + ">" +
      '<span class="apply-consent-text">' + APPLY_CONFIG.RECRUITMENT_CONSENT + "</span>" +
      "</label>" +
      '<div class="apply-error-text" id="q8ConsentError"></div>' +
      '<div class="apply-step-actions">' +
      '<button type="button" class="apply-btn apply-btn-primary" id="q8Submit">Submit Application</button>' +
      "</div>"
    );
  }
  function bindQ8() {
    document.getElementById("q8Phone").addEventListener("input", function (e) {
      STATE.answers.phone = e.target.value;
    });
    document.getElementById("q8Email").addEventListener("input", function (e) {
      STATE.answers.email = e.target.value;
    });
    document.getElementById("q8Consent").addEventListener("change", function (e) {
      STATE.answers.consent = e.target.checked;
      STATE.answers.consent_timestamp = e.target.checked ? new Date().toISOString() : "";
    });
    document.getElementById("q8Submit").addEventListener("click", function () {
      validateAndSubmit();
    });
  }

  function validateAndSubmit() {
    if (STATE.isSubmitting || STATE.hasSubmitted) return;
    var a = STATE.answers;
    var ok = true;

    var phoneErr = document.getElementById("q8PhoneError");
    if (!a.phone || a.phone.replace(/\D/g, "").length < 10) {
      phoneErr.textContent = "Enter a valid phone number.";
      ok = false;
    } else {
      phoneErr.textContent = "";
    }

    var emailErr = document.getElementById("q8EmailError");
    if (!a.email || a.email.indexOf("@") === -1) {
      emailErr.textContent = "Enter a valid email address.";
      ok = false;
    } else {
      emailErr.textContent = "";
    }

    var consentErr = document.getElementById("q8ConsentError");
    if (!a.consent) {
      consentErr.textContent = "Please check the box to continue.";
      ok = false;
    } else {
      consentErr.textContent = "";
    }

    if (ok) handleSubmit();
  }

  function handleSubmit() {
    STATE.isSubmitting = true;
    var submitBtn = document.getElementById("q8Submit");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
    }

    var applicantId = generateApplicantId();
    STATE.applicantId = applicantId;

    var payload = buildApplicationPayload(STATE.answers, applicantId, isTestMode);

    sendApplicationPayload(payload)
      .then(function (result) {
        STATE.webhookWarning = !result.ok;
      })
      .catch(function () {
        STATE.webhookWarning = true;
      })
      .then(function () {
        STATE.isSubmitting = false;
        STATE.hasSubmitted = true;
        STATE.step = TOTAL_STEPS + 1;
        render();
      });
  }

  // ---------------------------------------------------------------
  // Thank you
  // ---------------------------------------------------------------
  function thankYouTemplate() {
    var warning = STATE.webhookWarning
      ? '<div class="apply-thankyou-note" style="margin-top:14px; background:var(--gray-50); border-radius:8px; padding:10px 12px;">We saved your application, but had trouble reaching our system just now. No action is needed on your end.</div>'
      : "";
    return (
      '<div class="apply-card">' +
      '<h2 class="apply-thankyou-title">Application received.</h2>' +
      '<p class="apply-thankyou-body">We review applications on a rolling basis. If we\'re interested in your story, we\'ll reach out by phone or email &mdash; that outreach may include a request for reasonable proof that the accident occurred and a short pre-screen conversation before anything is scheduled.</p>' +
      '<p class="apply-thankyou-note">Applying doesn\'t guarantee selection or payment. If you don\'t hear from us, it isn\'t a reflection on your story &mdash; we\'re only able to select a limited number of participants at a time.</p>' +
      warning +
      "</div>"
    );
  }

  // ---------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------
  function answerBtn(id, label, selected) {
    return (
      '<button type="button" class="apply-answer-btn' + (selected ? " selected" : "") + '" id="' + id + '">' +
      "<span>" + label + "</span>" +
      "</button>"
    );
  }

  function escapeAttr(value) {
    return String(value || "").replace(/"/g, "&quot;");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
