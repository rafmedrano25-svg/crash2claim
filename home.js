/**
 * Crash2Claim — Homepage interactivity
 * -----------------------------------------------------------------
 * Deliberately separate from app.js (archived case-eval funnel) and
 * apply-app.js (/apply — must never be touched). This file only
 * drives presentational behavior on the new brand homepage: the
 * mobile nav toggle, the featured-stories carousel arrows, and the
 * placeholder video modal. No lead logic, no form submission, no
 * network calls of any kind live here.
 * -----------------------------------------------------------------
 */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    initMobileNav();
    initCarousel();
    initStoryModal();
  });

  // ---------------------------------------------------------------
  // Mobile hamburger menu
  // ---------------------------------------------------------------
  function initMobileNav() {
    var hamburger = document.getElementById("hpHamburger");
    var menu = document.getElementById("hpMobileMenu");
    if (!hamburger || !menu) return;

    hamburger.addEventListener("click", function () {
      var isOpen = menu.classList.toggle("open");
      hamburger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    // Close the mobile menu after tapping a link.
    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        menu.classList.remove("open");
        hamburger.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ---------------------------------------------------------------
  // Featured stories carousel (arrow buttons; native scroll + swipe
  // already work via CSS scroll-snap without any JS needed)
  // ---------------------------------------------------------------
  function initCarousel() {
    var track = document.getElementById("hpCarousel");
    var prevBtn = document.getElementById("hpCarouselPrev");
    var nextBtn = document.getElementById("hpCarouselNext");
    if (!track) return;

    function cardStep() {
      var firstCard = track.querySelector(".hp-story-card");
      if (!firstCard) return 260;
      var style = window.getComputedStyle(track);
      var gap = parseFloat(style.columnGap || style.gap || "18") || 18;
      return firstCard.getBoundingClientRect().width + gap;
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        track.scrollBy({ left: -cardStep() * 2, behavior: "smooth" });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        track.scrollBy({ left: cardStep() * 2, behavior: "smooth" });
      });
    }
  }

  // ---------------------------------------------------------------
  // Placeholder video modal
  // ---------------------------------------------------------------
  function initStoryModal() {
    var overlay = document.getElementById("hpModalOverlay");
    var closeBtn = document.getElementById("hpModalClose");
    var nameEl = document.getElementById("hpModalName");
    var metaEl = document.getElementById("hpModalMeta");
    var noteEl = document.getElementById("hpModalNote");
    if (!overlay) return;

    var cards = document.querySelectorAll(".hp-story-card");
    cards.forEach(function (card) {
      card.addEventListener("click", function () {
        var videoUrl = card.getAttribute("data-video-url") || "";

        // Intentionally NOT displaying data-name/data-state/data-descriptor
        // here — those attributes are inert placeholder architecture for
        // later real-participant data, not content meant to be shown to
        // visitors. Showing a neutral, honest label instead so the modal
        // never implies these are real Crash2Claim participants.
        if (nameEl) nameEl.textContent = "Sample Interview";
        if (metaEl) metaEl.textContent = "Not an actual participant";

        // As soon as a real hosted video URL is present on a card
        // (data-video-url), this is the one spot that needs updating
        // to actually play it — everything else in the modal already
        // works. Left as a placeholder note until real footage exists.
        if (noteEl) {
          noteEl.textContent = videoUrl
            ? "Video playback not yet wired up for this sample build."
            : "This is placeholder content for the Crash2Claim story library. Real interview video will appear here once published.";
        }

        openModal();
      });
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.classList.contains("open")) closeModal();
    });

    function openModal() {
      overlay.classList.add("open");
    }
    function closeModal() {
      overlay.classList.remove("open");
    }
  }
})();
