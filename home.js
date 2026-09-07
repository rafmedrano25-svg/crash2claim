/**
 * Crash2Claim — Homepage interactivity
 * -----------------------------------------------------------------
 * Deliberately separate from app.js (archived case-eval funnel) and
 * apply-app.js (/apply — must never be touched). This file only
 * drives presentational behavior on the new brand homepage: the
 * mobile nav toggle and the featured-stories carousel arrows. No
 * lead logic, no form submission, no network calls of any kind live
 * here.
 *
 * REDESIGN NOTE: the "Real Stories" carousel cards are now static
 * typographic cards (see index.html / styles-home.css) with no photo,
 * no click target, and no video preview — so the placeholder video
 * modal that used to open on card click (initStoryModal(), plus the
 * .hp-modal-* markup/CSS it drove) has been removed as obsolete. The
 * carousel arrows below are unaffected and still work exactly as
 * before.
 * -----------------------------------------------------------------
 */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    initMobileNav();
    initCarousel();
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
})();
