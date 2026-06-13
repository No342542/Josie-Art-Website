/* Shared chrome: builds the sidebar (logo, nav, social) from window.SITE
   and wires the mobile hamburger. Loaded on every page after data.js. */
(function () {
  var S = window.SITE || {};
  var name = S.name || 'Gallery';
  var key = name.toLowerCase();
  var page = document.body.getAttribute('data-page') || '';
  var ig = S.instagram || '#';

  var IG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="5"/>' +
    '<circle cx="12" cy="12" r="4"/>' +
    '<circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>';

  // Ann shows the hand-written wordmark inside the circle; Josie is the icon only.
  var wordmark = (key === 'ann') ? '<span class="logo__word">' + name.toUpperCase() + '</span>' : '';
  var galleryActive = (page === 'gallery' || page === 'artwork') ? ' is-active' : '';
  var aboutActive = (page === 'about') ? ' is-active' : '';

  var el = document.getElementById('sidebar');
  if (el) {
    el.innerHTML =
      '<a class="logo logo--' + key + '" href="index.html" aria-label="' + name + ' — home">' + wordmark + '</a>' +
      '<button class="hamburger" id="navToggle" aria-label="Menu" aria-expanded="false">' +
        '<span></span><span></span><span></span></button>' +
      '<nav class="nav" id="nav">' +
        '<a class="nav__link' + galleryActive + '" href="index.html">Gallery</a>' +
        '<a class="nav__link' + aboutActive + '" href="about.html">About</a>' +
        '<a class="nav__link" href="' + ig + '" target="_blank" rel="noopener">Instagram <span class="ig">' + IG + '</span></a>' +
      '</nav>';

    var toggle = document.getElementById('navToggle');
    toggle.addEventListener('click', function () {
      var open = el.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // close the mobile menu after tapping a nav link
    el.querySelectorAll('.nav__link').forEach(function (a) {
      a.addEventListener('click', function () { el.classList.remove('is-open'); });
    });
  }

  // set per-page document title
  document.title = name + (page === 'about' ? ' — About' : '') +
    (page === 'gallery' ? ' — ' + (S.galleryTitle || 'Gallery') : '');
})();
