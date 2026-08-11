/**
 * Crash2Claim — Survey App
 * -----------------------------------------------------------------
 * Owns the UI/state machine only. Reads config from js/config.js,
 * delegates qualification to js/qualification.js, attribution to
 * js/attribution.js, field checks to js/validation.js, and payload
 * assembly/delivery to js/payload.js. This file should not contain
 * business rules — if you're tempted to add an "if injured and not
 * at fault" check here, it belongs in qualification.js instead.
 * -----------------------------------------------------------------
 */

(function () {
  "use strict";

  var TOTAL_STEPS = 9;

  var INJURY_OPTIONS = [
    { value: "back_neck_pain", label: "Back or neck pain" },
    { value: "broken_bones", label: "Broken bones" },
    { value: "cuts_bruises", label: "Cuts or bruises" },
    { value: "headaches", label: "Headaches" },
    { value: "loss_of_limb", label: "Loss of limb" },
    { value: "head_injury", label: "Head injury" },
    { value: "whiplash", label: "Whiplash" },
    { value: "spinal_cord_injury", label: "Spinal cord injury" },
    { value: "other", label: "Other" },
    { value: "no_injury", label: "No injury" },
  ];

  var STATE = {
    step: 0, // 0 = hero, 1-9 = questions, 10 = result
    isSubmitting: false,
    hasSubmitted: false,
    answers: {
      settlement_intent: "",
      accident_date: "",
      vehicle_type: "",
      injuries: [], // array of INJURY_OPTIONS values
      treatment_timing: "",
      at_fault: "", // "yes" | "no" | "not_sure"
      had_insurance: null, // true | false | null
      has_attorney: null, // true | false | null
      first_name: "",
      last_name: "",
      phone: "",
      email: "",
      consent: false,
    },
    qualificationStatus: null,
    lastPayload: null,
    webhookWarning: false,
  };

  var cardRoot = document.getElementById("cardRoot");
  var progressWrap = document.getElementById("progressWrap");
  var progressText = document.getElementById("progressText");
  var progressPercent = document.getElementById("progressPercent");
  var progressFill = document.getElementById("progressFill");
  var progressBarWrap = document.getElementById("progressWrap");
  var progressBeads = document.getElementById("progressBeads");

  // ---------------------------------------------------------------
  // Gamification-only state (purely presentational — never read by
  // qualification.js, payload.js, or any test assertion). Safe to
  // delete this whole block and its call sites to fully revert the
  // visual layer without touching survey logic.
  // ---------------------------------------------------------------
  var lastDirection = null; // "forward" | "back" | null — drives step-slide animation
  var milestonesShown = { half: false, almost: false };
  var FEEDBACK_MESSAGES = ["Got it ✓", "Locked in ✓", "Nice ✓"];
  var feedbackIndex = 0;

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    captureAttribution();
    render();
    maybeInitTrackingScripts();
  });

  // ---------------------------------------------------------------
  // Rendering dispatch
  // ---------------------------------------------------------------
  function render() {
    updateProgress();
    if (STATE.step === 0) {
      cardRoot.innerHTML = heroTemplate();
      bindHeroEvents();
    } else if (STATE.step >= 1 && STATE.step <= TOTAL_STEPS) {
      cardRoot.innerHTML = stepTemplate(STATE.step);
      bindStepEvents(STATE.step);
      maybeShowMilestone(STATE.step);
    } else if (STATE.step === TOTAL_STEPS + 1) {
      cardRoot.innerHTML = resultTemplate();
    }
    cardRoot.classList.remove("step-enter", "step-slide-fwd", "step-slide-back");
    // Force reflow so the animation replays on every render.
    void cardRoot.offsetWidth;
    if (STATE.step >= 1 && STATE.step <= TOTAL_STEPS && lastDirection) {
      cardRoot.classList.add(lastDirection === "back" ? "step-slide-back" : "step-slide-fwd");
    } else {
      cardRoot.classList.add("step-enter");
    }
    lastDirection = null;
    if (typeof cardRoot.scrollIntoView === "function") {
      cardRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function updateProgress() {
    if (STATE.step >= 1 && STATE.step <= TOTAL_STEPS) {
      progressWrap.style.display = "block";
      var pct = Math.round((STATE.step / TOTAL_STEPS) * 100);
      progressText.textContent = "Question " + STATE.step + " of " + TOTAL_STEPS;
      progressPercent.textContent = pct + "%";
      progressFill.style.width = pct + "%";
      progressBarWrap.setAttribute("aria-valuenow", String(pct));
      // Brief shine/glow pulse on the bar whenever it repaints at a new step.
      progressFill.classList.remove("pulse-glow");
      void progressFill.offsetWidth;
      progressFill.classList.add("pulse-glow");
      renderProgressBeads();
    } else {
      progressWrap.style.display = "none";
    }
  }

  // Secondary "level meter" — one bead per question, lighting up as
  // the user advances. Purely decorative alongside the existing bar.
  function renderProgressBeads() {
    if (!progressBeads) return;
    var html = "";
    for (var i = 1; i <= TOTAL_STEPS; i++) {
      var cls = "progress-bead";
      if (i <= STATE.step) cls += " lit";
      if (i === STATE.step) cls += " current";
      html += '<span class="' + cls + '"></span>';
    }
    progressBeads.innerHTML = html;
  }

  // Small non-blocking milestone toasts — purely cosmetic, shown once
  // each per session so they don't spam the user on back/forward nav.
  function maybeShowMilestone(step) {
    var halfStep = Math.ceil(TOTAL_STEPS / 2) + 1; // step 6 of 9 (~56% complete)
    if (step === halfStep && !milestonesShown.half) {
      milestonesShown.half = true;
      showToast("Halfway there ✓", "c2c-milestone", 1700);
    }
    if (step === TOTAL_STEPS && !milestonesShown.almost) {
      milestonesShown.almost = true;
      showToast("Almost done", "c2c-milestone", 1700);
    }
  }

  // Generic transient message helper used for both the per-answer
  // feedback chip ("Got it ✓") and the milestone banners.
  function showToast(message, className, duration) {
    var el = document.createElement("div");
    el.className = className;
    el.textContent = message;
    cardRoot.insertBefore(el, cardRoot.firstChild);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, duration);
  }

  // ---------------------------------------------------------------
  // Hero
  // ---------------------------------------------------------------
  function heroTemplate() {
    return (
      '<h2 class="sr-only">Crash2Claim accident check landing page</h2>' +
      '<h1 class="hero-headline">Were You Injured in a Recent Auto Accident?</h1>' +
      '<p class="hero-sub">Answer a few quick questions to see if you may qualify for a free case evaluation.</p>' +
      '<ul class="hero-points">' +
      '<li><span class="dot"></span> Just a few taps on your phone</li>' +
      '<li><span class="dot"></span> Simple questions, no obligation</li>' +
      '<li><span class="dot"></span> See if you may qualify for a free case evaluation</li>' +
      "</ul>" +
      '<button type="button" class="btn btn-primary" id="startBtn">Start My Accident Check</button>' +
      '<p class="hero-disclaimer">Crash2Claim is a consumer connection service, not a law firm, and does not provide legal advice.</p>'
    );
  }

  function bindHeroEvents() {
    document.getElementById("startBtn").addEventListener("click", function () {
      STATE.step = 1;
      render();
    });
  }

  // ---------------------------------------------------------------
  // Step dispatch
  // ---------------------------------------------------------------
  function stepTemplate(step) {
    var backBtn =
      '<button type="button" class="btn-back" id="backBtn" aria-label="Go back to previous question">&larr; Back</button>';
    var header =
      '<div class="step-header">' + (step > 1 ? backBtn : "<span></span>") + "</div>";

    var body = "";
    if (step === 1) body = step1Template();
    if (step === 2) body = step2Template();
    if (step === 3) body = step3Template();
    if (step === 4) body = step4Template();
    if (step === 5) body = step5Template();
    if (step === 6) body = step6Template();
    if (step === 7) body = step7Template();
    if (step === 8) body = step8Template();
    if (step === 9) body = step9Template();

    return header + body;
  }

  function bindStepEvents(step) {
    var backBtn = document.getElementById("backBtn");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        goBack();
      });
    }
    if (step === 1) bindStep1Events();
    if (step === 2) bindStep2Events();
    if (step === 3) bindStep3Events();
    if (step === 4) bindStep4Events();
    if (step === 5) bindStep5Events();
    if (step === 6) bindStep6Events();
    if (step === 7) bindStep7Events();
    if (step === 8) bindStep8Events();
    if (step === 9) bindStep9Events();
  }

  function goBack() {
    lastDirection = "back";
    if (STATE.step > 1) {
      STATE.step -= 1;
    } else {
      STATE.step = 0;
    }
    render();
  }

  function goNext() {
    if (STATE.step < TOTAL_STEPS) {
      lastDirection = "forward";
      STATE.step += 1;
      render();
    }
  }

  // ---------------------------------------------------------------
  // Question 1 — settlement money intent (single choice -> auto-advance)
  // ---------------------------------------------------------------
  function step1Template() {
    var v = STATE.answers.settlement_intent;
    return (
      '<h2 class="step-question">What do you intend on doing with your settlement money?</h2>' +
      '<div class="icon-card-grid">' +
      iconCardButton("intentDebt", "Pay off debt", v === "pay_off_debt",
        '<rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line>') +
      iconCardButton("intentShopping", "Shopping", v === "shopping",
        '<path d="M6 8h12l-1.2 12.5a1 1 0 0 1-1 .5H8.2a1 1 0 0 1-1-.9L6 8z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path>') +
      iconCardButton("intentSave", "Save", v === "save",
        '<ellipse cx="12" cy="13" rx="8" ry="6"></ellipse><path d="M9 8L8 5"></path><path d="M15 8l1-3"></path><line x1="10" y1="13" x2="13" y2="13"></line><circle cx="17" cy="12" r="1" fill="currentColor" stroke="none"></circle>') +
      iconCardButton("intentTrip", "Go on a trip", v === "trip",
        '<path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path>') +
      "</div>"
    );
  }

  function bindStep1Events() {
    document.getElementById("intentDebt").addEventListener("click", function () {
      STATE.answers.settlement_intent = "pay_off_debt";
      autoAdvanceAfterSelect("intentDebt");
    });
    document.getElementById("intentShopping").addEventListener("click", function () {
      STATE.answers.settlement_intent = "shopping";
      autoAdvanceAfterSelect("intentShopping");
    });
    document.getElementById("intentSave").addEventListener("click", function () {
      STATE.answers.settlement_intent = "save";
      autoAdvanceAfterSelect("intentSave");
    });
    document.getElementById("intentTrip").addEventListener("click", function () {
      STATE.answers.settlement_intent = "trip";
      autoAdvanceAfterSelect("intentTrip");
    });
  }

  // ---------------------------------------------------------------
  // Question 2 — accident date (date picker -> Continue)
  // ---------------------------------------------------------------
  function step2Template() {
    return (
      '<h2 class="step-question">When did the accident happen?</h2>' +
      '<div class="field-group">' +
      '<label class="field-label" for="accidentDate">Accident date</label>' +
      '<input type="date" id="accidentDate" value="' +
      escapeAttr(STATE.answers.accident_date) +
      '" max="' + todayISO() + '">' +
      '<div class="error-text" id="accidentDateError"></div>' +
      "</div>" +
      '<div class="step-actions">' +
      '<button type="button" class="btn btn-primary" id="step2Continue">Continue</button>' +
      "</div>"
    );
  }

  function bindStep2Events() {
    document.getElementById("accidentDate").addEventListener("input", function (e) {
      STATE.answers.accident_date = e.target.value;
    });
    document.getElementById("step2Continue").addEventListener("click", function () {
      var dateInput = document.getElementById("accidentDate");
      var errEl = document.getElementById("accidentDateError");
      if (!isValidAccidentDate(dateInput.value)) {
        dateInput.classList.add("input-error");
        errEl.textContent = "Please enter the accident date.";
        return;
      }
      dateInput.classList.remove("input-error");
      errEl.textContent = "";
      goNext();
    });
  }

  // ---------------------------------------------------------------
  // Question 3 — vehicle type (single choice -> auto-advance)
  // ---------------------------------------------------------------
  function step3Template() {
    var v = STATE.answers.vehicle_type;
    return (
      '<h2 class="step-question">Were you in a car, truck, or motorcycle?</h2>' +
      '<div class="icon-card-grid">' +
      iconCardButton("vehicleCar", "Car", v === "car",
        '<rect x="3" y="11" width="18" height="5" rx="1"></rect><path d="M5 11l2-4h10l2 4"></path><circle cx="7.5" cy="16.5" r="1.5" fill="currentColor" stroke="none"></circle><circle cx="16.5" cy="16.5" r="1.5" fill="currentColor" stroke="none"></circle>') +
      iconCardButton("vehicleTruck", "Truck", v === "truck",
        '<rect x="2" y="9" width="12" height="8"></rect><path d="M14 12h4l3 3v2h-7"></path><circle cx="6" cy="18" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="17" cy="18" r="1.6" fill="currentColor" stroke="none"></circle>') +
      iconCardButton("vehicleMoto", "Motorcycle", v === "motorcycle",
        '<circle cx="5.5" cy="17.5" r="2.5"></circle><circle cx="18.5" cy="17.5" r="2.5"></circle><path d="M5.5 17.5h6l3-6h4"></path><path d="M11.5 11.5L14 17.5"></path>') +
      iconCardButton("vehicleOther", "Something else", v === "other",
        '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.5 1-1.5 2"></path><line x1="12" y1="16.5" x2="12" y2="16.6"></line>') +
      "</div>"
    );
  }

  function bindStep3Events() {
    document.getElementById("vehicleCar").addEventListener("click", function () {
      STATE.answers.vehicle_type = "car";
      autoAdvanceAfterSelect("vehicleCar");
    });
    document.getElementById("vehicleTruck").addEventListener("click", function () {
      STATE.answers.vehicle_type = "truck";
      autoAdvanceAfterSelect("vehicleTruck");
    });
    document.getElementById("vehicleMoto").addEventListener("click", function () {
      STATE.answers.vehicle_type = "motorcycle";
      autoAdvanceAfterSelect("vehicleMoto");
    });
    document.getElementById("vehicleOther").addEventListener("click", function () {
      STATE.answers.vehicle_type = "other";
      autoAdvanceAfterSelect("vehicleOther");
    });
  }

  // ---------------------------------------------------------------
  // Question 4 — injuries (multi-select checkboxes -> Continue)
  // ---------------------------------------------------------------
  function step4Template() {
    var rows = INJURY_OPTIONS.map(function (opt) {
      var checked = STATE.answers.injuries.indexOf(opt.value) !== -1;
      return (
        '<label class="answer-btn' +
        (checked ? " selected" : "") +
        '" style="display:flex; align-items:center; gap:10px; cursor:pointer;" data-injury-row="' +
        opt.value +
        '">' +
        '<input type="checkbox" class="injury-checkbox" value="' +
        opt.value +
        '" style="width:18px; height:18px; flex:none;"' +
        (checked ? " checked" : "") +
        ">" +
        "<span>" +
        opt.label +
        "</span>" +
        (checked ? '<span class="answer-check">✓</span>' : "") +
        "</label>"
      );
    }).join("");

    var count = STATE.answers.injuries.length;
    return (
      '<h2 class="step-question">What injuries did you have?</h2>' +
      '<p class="step-help">Select all that apply.</p>' +
      '<div class="answer-list" id="injuryList">' +
      rows +
      "</div>" +
      '<div class="injury-counter" id="injuryCounter">' +
      (count > 0 ? "<strong>" + count + "</strong> selected" : "") +
      "</div>" +
      '<div class="error-text" id="injuryError"></div>' +
      '<div class="step-actions">' +
      '<button type="button" class="btn btn-primary" id="step4Continue">Continue</button>' +
      "</div>"
    );
  }

  function bindStep4Events() {
    var checkboxes = Array.prototype.slice.call(document.querySelectorAll(".injury-checkbox"));

    function syncSelectedStyles() {
      checkboxes.forEach(function (cb) {
        var row = cb.closest('[data-injury-row]');
        if (!row) return;
        row.classList.toggle("selected", cb.checked);
        var existingCheck = row.querySelector(".answer-check");
        if (cb.checked && !existingCheck) {
          var span = document.createElement("span");
          span.className = "answer-check";
          span.textContent = "✓";
          row.appendChild(span);
        } else if (!cb.checked && existingCheck) {
          existingCheck.parentNode.removeChild(existingCheck);
        }
      });
      var counterEl = document.getElementById("injuryCounter");
      var count = checkboxes.filter(function (c) {
        return c.checked;
      }).length;
      counterEl.innerHTML = count > 0 ? "<strong>" + count + "</strong> selected" : "";
    }

    checkboxes.forEach(function (cb) {
      cb.addEventListener("change", function () {
        var value = cb.value;
        if (value === "no_injury" && cb.checked) {
          // "No injury" is exclusive of every other option.
          checkboxes.forEach(function (other) {
            if (other !== cb) other.checked = false;
          });
        } else if (cb.checked) {
          // Any other selection clears "No injury".
          checkboxes.forEach(function (other) {
            if (other.value === "no_injury") other.checked = false;
          });
        }
        STATE.answers.injuries = checkboxes.filter(function (c) {
          return c.checked;
        }).map(function (c) {
          return c.value;
        });
        document.getElementById("injuryError").textContent = "";
        syncSelectedStyles();
      });
    });

    document.getElementById("step4Continue").addEventListener("click", function () {
      if (STATE.answers.injuries.length === 0) {
        document.getElementById("injuryError").textContent = "Please select at least one option.";
        return;
      }
      goNext();
    });
  }

  // ---------------------------------------------------------------
  // Question 5 — treatment timing (single choice -> auto-advance)
  // ---------------------------------------------------------------
  function step5Template() {
    var v = STATE.answers.treatment_timing;
    return (
      '<h2 class="step-question">How soon after the accident did you get medical treatment?</h2>' +
      '<div class="answer-list">' +
      answerButton("treatFirstWeek", "First week", v === "first_week") +
      answerButton("treatTwoWeeks", "Within two weeks", v === "within_two_weeks") +
      answerButton("treat30", "Within 30 days", v === "within_30_days") +
      answerButton("treat60", "Less than 60 days", v === "less_than_60_days") +
      answerButton("treatMore60", "More than 60 days", v === "more_than_60_days") +
      answerButton("treatNever", "Never", v === "never") +
      "</div>"
    );
  }

  function bindStep5Events() {
    var map = {
      treatFirstWeek: "first_week",
      treatTwoWeeks: "within_two_weeks",
      treat30: "within_30_days",
      treat60: "less_than_60_days",
      treatMore60: "more_than_60_days",
      treatNever: "never",
    };
    Object.keys(map).forEach(function (id) {
      document.getElementById(id).addEventListener("click", function () {
        STATE.answers.treatment_timing = map[id];
        autoAdvanceAfterSelect(id);
      });
    });
  }

  // ---------------------------------------------------------------
  // Question 6 — at fault (single choice -> auto-advance)
  // ---------------------------------------------------------------
  function step6Template() {
    var v = STATE.answers.at_fault;
    return (
      '<h2 class="step-question">Was someone else at least partly at fault?</h2>' +
      '<div class="answer-list">' +
      answerButton("faultYes", "Yes", v === "yes") +
      answerButton("faultNo", "No", v === "no") +
      answerButton("faultNotSure", "Not sure", v === "not_sure") +
      "</div>"
    );
  }

  function bindStep6Events() {
    document.getElementById("faultYes").addEventListener("click", function () {
      STATE.answers.at_fault = "yes";
      autoAdvanceAfterSelect("faultYes");
    });
    document.getElementById("faultNo").addEventListener("click", function () {
      STATE.answers.at_fault = "no";
      autoAdvanceAfterSelect("faultNo");
    });
    document.getElementById("faultNotSure").addEventListener("click", function () {
      STATE.answers.at_fault = "not_sure";
      autoAdvanceAfterSelect("faultNotSure");
    });
  }

  // ---------------------------------------------------------------
  // Question 7 — insurance (single choice -> auto-advance)
  // ---------------------------------------------------------------
  function step7Template() {
    var v = STATE.answers.had_insurance;
    return (
      '<h2 class="step-question">Did you have car insurance when the accident happened?</h2>' +
      '<div class="answer-list">' +
      answerButton("insuranceYes", "Yes", v === true) +
      answerButton("insuranceNo", "No", v === false) +
      "</div>"
    );
  }

  function bindStep7Events() {
    document.getElementById("insuranceYes").addEventListener("click", function () {
      STATE.answers.had_insurance = true;
      autoAdvanceAfterSelect("insuranceYes");
    });
    document.getElementById("insuranceNo").addEventListener("click", function () {
      STATE.answers.had_insurance = false;
      autoAdvanceAfterSelect("insuranceNo");
    });
  }

  // ---------------------------------------------------------------
  // Question 8 — has attorney (single choice -> auto-advance)
  // ---------------------------------------------------------------
  function step8Template() {
    var v = STATE.answers.has_attorney;
    return (
      '<h2 class="step-question">Do you already have a lawyer for this accident?</h2>' +
      '<div class="answer-list">' +
      answerButton("attorneyYes", "Yes", v === true) +
      answerButton("attorneyNo", "No", v === false) +
      "</div>"
    );
  }

  function bindStep8Events() {
    document.getElementById("attorneyYes").addEventListener("click", function () {
      STATE.answers.has_attorney = true;
      autoAdvanceAfterSelect("attorneyYes");
    });
    document.getElementById("attorneyNo").addEventListener("click", function () {
      STATE.answers.has_attorney = false;
      autoAdvanceAfterSelect("attorneyNo");
    });
  }

  // ---------------------------------------------------------------
  // Question 9 — contact info (form -> final submit)
  // ---------------------------------------------------------------
  function step9Template() {
    var a = STATE.answers;
    return (
      '<h2 class="step-question">Great — where can we reach you about your free case evaluation?</h2>' +
      '<div class="field-group field-row">' +
      "<div>" +
      '<label class="field-label" for="firstName">First name</label>' +
      '<input type="text" id="firstName" autocomplete="given-name" value="' +
      escapeAttr(a.first_name) +
      '">' +
      "</div>" +
      "<div>" +
      '<label class="field-label" for="lastName">Last name</label>' +
      '<input type="text" id="lastName" autocomplete="family-name" value="' +
      escapeAttr(a.last_name) +
      '">' +
      "</div>" +
      "</div>" +
      '<div class="error-text" id="nameError"></div>' +
      '<div class="field-group">' +
      '<label class="field-label" for="phone">Phone number</label>' +
      '<input type="tel" id="phone" autocomplete="tel" placeholder="(555) 555-5555" value="' +
      escapeAttr(a.phone) +
      '">' +
      '<div class="error-text" id="phoneError"></div>' +
      "</div>" +
      '<div class="field-group">' +
      '<label class="field-label" for="email">Email address</label>' +
      '<input type="email" id="email" autocomplete="email" placeholder="name@example.com" value="' +
      escapeAttr(a.email) +
      '">' +
      '<div class="error-text" id="emailError"></div>' +
      "</div>" +
      '<label class="consent-row" for="consentCheck">' +
      '<input type="checkbox" id="consentCheck"' +
      (a.consent ? " checked" : "") +
      ">" +
      '<span class="consent-text"><span class="consent-placeholder-tag">Placeholder text</span><br>' +
      CONFIG.CONSENT_DISCLOSURE +
      "</span>" +
      "</label>" +
      '<div class="error-text" id="consentError"></div>' +
      '<div class="step-actions">' +
      '<button type="button" class="btn btn-primary" id="submitBtn">Get My Free Case Evaluation</button>' +
      "</div>"
    );
  }

  function bindStep9Events() {
    document.getElementById("firstName").addEventListener("input", function (e) {
      STATE.answers.first_name = e.target.value;
    });
    document.getElementById("lastName").addEventListener("input", function (e) {
      STATE.answers.last_name = e.target.value;
    });
    document.getElementById("phone").addEventListener("input", function (e) {
      var formatted = formatUSPhone(e.target.value);
      e.target.value = formatted;
      STATE.answers.phone = formatted;
    });
    document.getElementById("email").addEventListener("input", function (e) {
      STATE.answers.email = e.target.value;
    });
    document.getElementById("consentCheck").addEventListener("change", function (e) {
      STATE.answers.consent = e.target.checked;
    });
    document.getElementById("submitBtn").addEventListener("click", function () {
      validateAndSubmitStep9();
    });
  }

  function validateAndSubmitStep9() {
    if (STATE.isSubmitting || STATE.hasSubmitted) return; // duplicate-submit guard

    var a = STATE.answers;
    var ok = true;

    var firstEl = document.getElementById("firstName");
    var lastEl = document.getElementById("lastName");
    var nameErr = document.getElementById("nameError");
    if (!isNonEmpty(a.first_name) || !isNonEmpty(a.last_name)) {
      firstEl.classList.toggle("input-error", !isNonEmpty(a.first_name));
      lastEl.classList.toggle("input-error", !isNonEmpty(a.last_name));
      nameErr.textContent = "Please enter your first and last name.";
      ok = false;
    } else {
      firstEl.classList.remove("input-error");
      lastEl.classList.remove("input-error");
      nameErr.textContent = "";
    }

    var phoneEl = document.getElementById("phone");
    var phoneErr = document.getElementById("phoneError");
    if (!isValidUSPhone(a.phone)) {
      phoneEl.classList.add("input-error");
      phoneErr.textContent = "Enter a valid 10-digit US phone number.";
      ok = false;
    } else {
      phoneEl.classList.remove("input-error");
      phoneErr.textContent = "";
    }

    var emailEl = document.getElementById("email");
    var emailErr = document.getElementById("emailError");
    if (!isValidEmail(a.email)) {
      emailEl.classList.add("input-error");
      emailErr.textContent = "Enter a valid email address.";
      ok = false;
    } else {
      emailEl.classList.remove("input-error");
      emailErr.textContent = "";
    }

    var consentErr = document.getElementById("consentError");
    if (!a.consent) {
      consentErr.textContent = "Please check the box to continue.";
      ok = false;
    } else {
      consentErr.textContent = "";
    }

    if (ok) handleSubmit();
  }

  // ---------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------
  function handleSubmit() {
    if (STATE.isSubmitting || STATE.hasSubmitted) return;
    STATE.isSubmitting = true;

    var submitBtn = document.getElementById("submitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
    }

    var status = evaluateQualification(STATE.answers, CONFIG.QUALIFYING_RULES);
    STATE.qualificationStatus = status;

    var payload = buildLeadPayload(STATE.answers, status);
    STATE.lastPayload = payload;

    sendLeadPayload(payload)
      .then(function (result) {
        STATE.webhookWarning = !result.ok;
      })
      .catch(function () {
        STATE.webhookWarning = true;
      })
      .then(function () {
        // NOTE: the real qualification result (STATE.qualificationStatus)
        // and the real payload/webhook call above are already complete
        // by this point — the "checking" screen below is a purely
        // cosmetic delay before revealing the result that was already
        // decided. It never changes what gets shown.
        STATE.isSubmitting = false;
        STATE.hasSubmitted = true;
        runCheckingSequence(function () {
          STATE.step = TOTAL_STEPS + 1;
          render();
        });
      });
  }

  // Bigger "Checking your answers…" reveal shown between submit and
  // the real result screen: a charging ring, a sequential checklist,
  // and a brief anticipation beat right before reveal. Purely
  // presentational — does not compute, alter, or delay the actual
  // qualification logic above (that already ran and finished before
  // this function is ever called).
  function checkingTemplate() {
    return (
      '<div class="checking-wrap" id="checkingWrap">' +
      '<div class="checking-ring">' +
      '<svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle class="ring-track" cx="32" cy="32" r="27"></circle>' +
      '<circle class="ring-fill" cx="32" cy="32" r="27"></circle>' +
      "</svg>" +
      "</div>" +
      '<h2 class="checking-title" id="checkingTitle">Checking your answers…</h2>' +
      '<ul class="checking-list">' +
      '<li class="checking-line">Accident details</li>' +
      '<li class="checking-line">Injury details</li>' +
      '<li class="checking-line">Claim factors</li>' +
      "</ul>" +
      "</div>"
    );
  }

  function runCheckingSequence(onDone) {
    progressWrap.style.display = "none";
    cardRoot.classList.remove("step-enter", "step-slide-fwd", "step-slide-back");
    cardRoot.innerHTML = checkingTemplate();
    void cardRoot.offsetWidth;
    cardRoot.classList.add("step-enter");
    var lines = cardRoot.querySelectorAll(".checking-line");
    var delays = [200, 750, 1300];
    lines.forEach(function (line, i) {
      window.setTimeout(function () {
        line.classList.add("checked");
      }, delays[i] || 200 * (i + 1));
    });
    window.setTimeout(function () {
      var titleEl = document.getElementById("checkingTitle");
      if (titleEl) titleEl.textContent = "Almost ready…";
    }, 1450);
    window.setTimeout(function () {
      var wrap = document.getElementById("checkingWrap");
      if (wrap) wrap.classList.add("climax");
    }, 1650);
    window.setTimeout(onDone, 1900);
  }

  // ---------------------------------------------------------------
  // Result
  // ---------------------------------------------------------------
  function resultTemplate() {
    if (STATE.qualificationStatus === "qualified") {
      return (
        '<div class="result-badge-wrap">' +
        confettiMarkup() +
        '<div class="result-badge qualified" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 2l7 3v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V5l7-3z"></path>' +
        '<path d="M9 12l2 2 4-4"></path>' +
        "</svg>" +
        "</div>" +
        "</div>" +
        '<h2 class="result-title">Thank You</h2>' +
        '<p class="result-body">Based on your responses, you may qualify for a free case evaluation. A representative may contact you shortly to discuss your accident.</p>' +
        '<p class="result-note">Crash2Claim is not a law firm and does not provide legal advice. This is not a guarantee of compensation or case acceptance.</p>' +
        webhookWarningTemplate()
      );
    }
    return (
      '<div class="result-badge-wrap">' +
      '<div class="result-badge unqualified" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 2l7 3v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V5l7-3z"></path>' +
      '<line x1="9" y1="12" x2="15" y2="12"></line>' +
      "</svg>" +
      "</div>" +
      "</div>" +
      '<h2 class="result-title">Thank You</h2>' +
      '<p class="result-body">Thank you for your information. Based on your responses, we may not be able to connect you with a participating provider at this time.</p>' +
      '<p class="result-note">Crash2Claim is not a law firm and does not provide legal advice.</p>' +
      webhookWarningTemplate()
    );
  }

  // Abstract confetti burst (brand-color shapes only — no coins,
  // cash, or prize iconography) shown behind the badge on a
  // qualified result. Purely decorative, auto-plays via CSS.
  function confettiMarkup() {
    var colors = ["c-teal", "c-coral", "c-navy"];
    var pieces = "";
    for (var i = 0; i < 10; i++) {
      var angle = i * 36;
      var dist = 34 + (i % 3) * 10;
      var delay = i * 15;
      pieces +=
        '<span class="confetti-piece ' +
        colors[i % colors.length] +
        '" style="--ang:' +
        angle +
        "deg; --dist:" +
        dist +
        "px; animation-delay:" +
        delay +
        'ms;"></span>';
    }
    return '<div class="confetti-burst" aria-hidden="true">' + pieces + "</div>";
  }

  function webhookWarningTemplate() {
    if (!STATE.webhookWarning) return "";
    return (
      '<div class="webhook-warning">We saved your responses, but had trouble reaching our intake system just now. ' +
      "No action is needed on your end — our team can retrieve your submission.</div>"
    );
  }

  // ---------------------------------------------------------------
  // Shared UI helpers
  // ---------------------------------------------------------------
  function answerButton(id, label, selected) {
    return (
      '<button type="button" class="answer-btn' +
      (selected ? " selected" : "") +
      '" id="' +
      id +
      '">' +
      "<span>" + label + "</span>" +
      (selected ? '<span class="answer-check">✓</span>' : "") +
      "</button>"
    );
  }

  // Simple inline icon-card button used for Question 1 and Question 3.
  // Same click/id/value contract as answerButton() — only the markup
  // is richer (icon + label instead of plain text).
  function iconCardButton(id, label, selected, svgInner) {
    return (
      '<button type="button" class="icon-card' +
      (selected ? " selected" : "") +
      '" id="' +
      id +
      '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      svgInner +
      "</svg>" +
      '<span class="icon-card-label">' + label + "</span>" +
      (selected ? '<span class="answer-check icon-card-check">✓</span>' : "") +
      "</button>"
    );
  }

  function autoAdvanceAfterSelect(selectedId) {
    var buttons = cardRoot.querySelectorAll(".answer-btn, .icon-card");
    buttons.forEach(function (btn) {
      var isSelected = btn.id === selectedId;
      btn.classList.toggle("selected", isSelected);
      btn.disabled = true;
      if (isSelected && !btn.querySelector(".answer-check")) {
        var check = document.createElement("span");
        check.className = btn.classList.contains("icon-card") ? "answer-check icon-card-check" : "answer-check";
        check.textContent = "✓";
        btn.appendChild(check);
      }
    });
    var message = FEEDBACK_MESSAGES[feedbackIndex % FEEDBACK_MESSAGES.length];
    feedbackIndex += 1;
    showToast(message, "c2c-toast", 380);
    window.setTimeout(function () {
      goNext();
    }, 380);
  }

  function escapeAttr(value) {
    return String(value || "").replace(/"/g, "&quot;");
  }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  // ---------------------------------------------------------------
  // Tracking / compliance script placeholders
  // -----------------------------------------------------------------
  // Intentionally does nothing until real IDs are added to
  // CONFIG.TRACKING_SETTINGS. This is the single spot where GA4,
  // Meta Pixel, Google Ads, TrustedForm, Jornaya, and Retreaver
  // script tags would be conditionally injected.
  // ---------------------------------------------------------------
  function maybeInitTrackingScripts() {
    var t = CONFIG.TRACKING_SETTINGS;
    if (t.GA4_MEASUREMENT_ID) {
      // TODO: inject GA4 gtag.js loader using t.GA4_MEASUREMENT_ID
    }
    if (t.META_PIXEL_ID) {
      // TODO: inject Meta Pixel base code using t.META_PIXEL_ID
    }
    if (t.GOOGLE_ADS_CONVERSION_ID) {
      // TODO: inject Google Ads gtag loader + conversion event on submit
    }
    if (t.TRUSTEDFORM_ENABLED) {
      // TODO: inject TrustedForm script + hidden xxTrustedFormCertUrl field
    }
    if (t.JORNAYA_ENABLED) {
      // TODO: inject Jornaya LeadiD script + hidden leadid_token field
    }
    if (t.RETREAVER_ENABLED) {
      // TODO: inject Retreaver JS tag for call tracking number swap
    }
  }
})();
