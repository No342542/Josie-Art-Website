/* Gallery page: renders the category filter bar + ROW-MAJOR masonry grid from
   window.SITE / window.ARTWORKS, and handles filtering + touch reveal.

   Order model (matches the Manage tool):
     • "All"          → window.ARTWORKS, in their saved order (the master list).
     • a subcategory  → window.SITE.collections[cat], a curated ordered list of ids.
     • legacy/no data → falls back to filtering ARTWORKS by the single `category`
                        field, so the site still works before Manage writes collections.

   Masonry is laid out left-to-right (row-major) via CSS-grid row spans, so going
   ACROSS a row here matches going across a row in the Manage tool. Heights still
   vary (images are never cropped); shorter cards just let the next row tuck up. */
(function () {
  var S = window.SITE || {};
  var ART = window.ARTWORKS || [];
  var cats = S.categories || ['All'];
  var collections = (S.collections && typeof S.collections === 'object') ? S.collections : null;
  var ALL = cats[0] || 'All';

  var byId = {};
  ART.forEach(function (a) { byId[a.id] = a; });

  var titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = S.galleryTitle || 'Gallery';

  var FACETS =
    '<svg class="card__facets" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon class="facet facet--tl" points="0,0 60,0 0,56" fill="#fff" fill-opacity="0.14"/>' +
      '<polygon class="facet facet--tr" points="100,0 100,48 52,0" fill="#fff" fill-opacity="0.10"/>' +
      '<polygon class="facet facet--bl" points="0,100 0,52 48,100" fill="#fff" fill-opacity="0.08"/>' +
      '<polygon class="facet facet--br" points="100,100 100,50 50,100" fill="#fff" fill-opacity="0.12"/>' +
      '<polygon class="facet facet--center" points="50,28 82,76 18,76" fill="#fff" fill-opacity="0.07"/>' +
    '</svg>';
  var ARROW =
    '<svg class="card__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="9 5 16 12 9 19"/></svg>';

  /* ---- filter bar ---- */
  var bar = document.getElementById('filters');
  var buttons = [];
  cats.forEach(function (cat, i) {
    if (i > 0) {
      var sep = document.createElement('span');
      sep.className = 'filters__sep';
      sep.textContent = '|';
      bar.appendChild(sep);
    }
    var b = document.createElement('button');
    b.className = 'filter' + (i === 0 ? ' is-active' : '');
    b.type = 'button';
    b.textContent = cat;
    b.addEventListener('click', function () { apply(cat); });
    bar.appendChild(b);
    buttons.push(b);
  });

  /* ---- which artworks (and in what order) for a given tab ---- */
  function listFor(cat) {
    if (cat === ALL) return ART.slice();
    if (collections && collections[cat]) {
      return collections[cat].map(function (id) { return byId[id]; }).filter(Boolean);
    }
    return ART.filter(function (a) { return a.category === cat; });   // legacy fallback
  }

  /* ---- grid ---- */
  var grid = document.getElementById('grid');

  function buildCard(a) {
    var card = document.createElement('a');
    card.className = 'card';
    card.href = 'artwork.html?id=' + encodeURIComponent(a.id);
    card.setAttribute('data-category', a.category || '');
    card.innerHTML =
      '<img class="card__img" src="' + a.image + '" alt="' + escapeAttr(a.title) + '">' +
      '<span class="card__overlay">' + FACETS +
        '<span class="card__title">' + escapeHtml(a.title) + '</span>' + ARROW +
      '</span>';
    var img = card.querySelector('.card__img');
    img.addEventListener('load', relayout);
    img.addEventListener('error', relayout);
    if (img.complete) relayout();                        // already cached — lay out now too
    return card;
  }

  function render(cat) {
    grid.innerHTML = '';
    listFor(cat).forEach(function (a) { grid.appendChild(buildCard(a)); });
    relayout();
  }

  /* ---- row-major masonry: set each card's grid-row span from its height ----
     Debounced (cancel+reschedule) rather than swallowed, and re-runs while any
     card still has no height. Without this, switching to a subtab whose images
     are already CACHED fires all their load events in one burst that the old
     throttle swallowed → the single pass measured height 0 → no spans → the grid
     collapsed into columns. Now every tab lays out row-major. */
  var _raf = 0, _tries = 0;
  function relayout() { _tries = 0; _schedule(); }       // external trigger: reset the retry budget
  function _schedule() { if (_raf) cancelAnimationFrame(_raf); _raf = requestAnimationFrame(_doLayout); }
  function _doLayout() {
    _raf = 0;
    var cs = getComputedStyle(grid);
    if (cs.display !== 'grid') return;                    // CSS not in masonry mode
    var rowUnit = parseFloat(cs.gridAutoRows) || 8;
    var gap = parseFloat(cs.columnGap) || 20;
    var cards = grid.querySelectorAll('.card'), pending = 0;
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].getBoundingClientRect().height;
      if (!h) { pending++; continue; }                   // image not laid out yet
      cards[i].style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + gap) / rowUnit));
    }
    if (pending && _tries++ < 40) _schedule();           // still settling — try again next frame (bounded)
  }
  window.addEventListener('resize', relayout);
  window.addEventListener('load', relayout);

  /* ---- filtering ---- */
  function apply(cat) {
    buttons.forEach(function (b) { b.classList.toggle('is-active', b.textContent === cat); });
    render(cat);
  }

  render(ALL);   // initial

  /* ---- touch: first tap reveals overlay, second tap opens (delegated, survives re-render) ---- */
  var coarse = window.matchMedia && window.matchMedia('(hover: none)').matches;
  if (coarse) {
    grid.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      if (!card.classList.contains('is-active')) {
        e.preventDefault();
        grid.querySelectorAll('.card.is-active').forEach(function (c) { c.classList.remove('is-active'); });
        card.classList.add('is-active');
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
})();
