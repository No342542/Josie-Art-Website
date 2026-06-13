/* Detail page: renders one artwork from ?id=.
   Layout is driven by SITE.detailLayout:
     - "split"  → image (and speed-paint) on the left, words on the right (Josie)
     - default  → image centered, words centered below (Ann)
   Josie's speed-paints loop until Stop; the player shows Play / Stop only,
   never a progress bar or scrubber. */
(function () {
  var S = window.SITE || {};
  var ART = window.ARTWORKS || [];
  var root = document.getElementById('detail');
  if (!root) return;

  var id = new URLSearchParams(window.location.search).get('id');
  var idx = ART.findIndex(function (a) { return a.id === id; });
  if (idx === -1) {
    root.innerHTML = '<a class="detail__back" href="index.html">' + backArrow() + ' Back to gallery</a>' +
      '<p class="detail__text">Sorry, that piece could not be found.</p>';
    return;
  }
  var a = ART[idx];
  document.title = a.title + ' — ' + (S.name || 'Gallery');

  var prev = ART[(idx - 1 + ART.length) % ART.length];
  var next = ART[(idx + 1) % ART.length];
  var hasVideo = S.hasVideo && a.video;
  var split = (S.detailLayout === 'split');
  if (split) root.classList.add('detail--split');

  var back = '<a class="detail__back" href="index.html">' + backArrow() + ' Back to gallery</a>';
  var image = '<div class="detail__media"><img class="detail__img" src="' + attr(a.image) + '" alt="' + attr(a.title) + '"></div>';
  var vid = hasVideo ? paintBlock(a) : '';
  var yt = a.youtube ? youtube(a.youtube) : '';
  // "Additional art" (related) lives in the media column alongside the main art +
  // speed-paint. relatedUnderMain=true → directly under the main art (above the
  // speed-paint); default → under the speed-paint (and just under the main art
  // when there's no video, since the speed-paint slot is empty).
  var related = a.related ? relatedBlock(a.related) : '';
  var relAbove = (related && a.relatedUnderMain) ? related : '';
  var relBelow = (related && !a.relatedUnderMain) ? related : '';
  var ig = instagramLink(a);                               // per-piece IG icon, shown under the date
  var title = '<h1 class="detail__title">' + esc(a.title) + '</h1>';
  var date = '<div class="detail__date">' + esc(a.date || '') +
    (a.category ? '&nbsp;&middot;&nbsp;' + esc(a.category) : '') + '</div>';
  var text = a.text ? '<p class="detail__text">' + esc(a.text) + '</p>' : '';
  var nav = '<div class="detail__nav">' +
      '<a href="artwork.html?id=' + encodeURIComponent(prev.id) + '">' + backArrow() + ' Prev</a>' +
      '<a href="artwork.html?id=' + encodeURIComponent(next.id) + '">Next ' + fwdArrow() + '</a>' +
    '</div>';

  if (split) {
    // Three blocks so the page reflows correctly: on MOBILE (single column) the
    // order is art → its title/date/IG/comment → extras (related/video/video-title);
    // on DESKTOP a 2-col grid puts the info to the right of the art and the extras
    // below the art. (Before, the info sat in a trailing column that stacked at the
    // very bottom on mobile — under the art AND the video — which was confusing.)
    root.innerHTML = back +
      '<div class="detail__cols">' +
        '<div class="detail__art">' + image + '</div>' +
        '<div class="detail__info">' + title + date + ig + text + '</div>' +
        '<div class="detail__extra">' + relAbove + vid + relBelow + yt + '</div>' +
      '</div>' + nav;
  } else {
    root.innerHTML = back + image +
      '<div class="detail__meta">' + title + date + ig + '</div>' + relAbove + vid + relBelow + yt + text + nav;
  }

  if (hasVideo) wirePlayer();

  // Match the speed-paint video's width to the main art's displayed width. A
  // ResizeObserver on the art keeps them in sync across window resizes / rotation.
  var mainImg = root.querySelector('.detail__img');
  if (mainImg) {
    mainImg.addEventListener('load', sizeVideoToArt);
    if (mainImg.complete) sizeVideoToArt();
    if (window.ResizeObserver) new ResizeObserver(sizeVideoToArt).observe(mainImg);
  }
  window.addEventListener('resize', sizeVideoToArt);
  function sizeVideoToArt() {
    var im = root.querySelector('.detail__img'), paint = root.querySelector('.detail__paint');
    if (!im || !paint) return;
    paint.style.width = '';                               // reset first so the video can't influence the art's measured width
    var w = im.getBoundingClientRect().width;
    if (w) paint.style.width = Math.round(w) + 'px';
  }

  /* ---------- speed-paint block: the looping player + Josie's own title under it ----------
     No "Speed-paint" label — Josie titles it herself. Title sits directly under the
     video (which is sized to the art's width). With no videoTitle it's just the player. */
  function paintBlock(a) {
    var info = a.videoTitle ?
      '<div class="detail__paintinfo"><h2 class="detail__painttitle">' + esc(a.videoTitle) + '</h2></div>' : '';
    return '<div class="detail__paint">' + player(a) + info + '</div>';
  }

  /* ---------- minimal looping player ---------- */
  function player(a) {
    return '<div class="player" id="player">' +
      '<video class="player__video" id="paint" playsinline loop preload="metadata" ' +
        'poster="' + attr(a.image) + '"><source src="' + attr(a.video) + '" type="video/mp4"></video>' +
      '<button class="player__btn player__play" id="playBtn" aria-label="Play speed-paint">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg></button>' +
      '<button class="player__btn player__toggle" id="toggleBtn" aria-label="Pause">' +
        '<svg class="player__ico player__ico-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' +
        '<svg class="player__ico player__ico-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<path d="M7 5v14l12-7z"/></svg></button>' +
      '</div>';
  }

  function wirePlayer() {
    var wrap = document.getElementById('player');
    var video = document.getElementById('paint');
    var playBtn = document.getElementById('playBtn');
    var toggleBtn = document.getElementById('toggleBtn');

    playBtn.addEventListener('click', function () { video.play(); });
    toggleBtn.addEventListener('click', function () { if (video.paused) video.play(); else video.pause(); });
    video.addEventListener('play', function () {
      wrap.classList.add('is-started', 'is-playing');   // big center play hides; corner toggle shows "pause"
      playBtn.hidden = true;
      toggleBtn.setAttribute('aria-label', 'Pause');
    });
    video.addEventListener('pause', function () {
      wrap.classList.remove('is-playing');              // keep is-started so the corner toggle stays visible
      toggleBtn.setAttribute('aria-label', 'Play');     // it now shows a "play" glyph to resume
    });
    video.addEventListener('error', function () {
      playBtn.hidden = true;
      var note = document.createElement('div');
      note.className = 'player__note';
      note.textContent = 'Speed-paint coming soon';
      wrap.appendChild(note);
    });
  }

  /* ---------- YouTube embed + related artwork ---------- */
  function youtube(u) {
    var vidId = ytid(u);
    if (!vidId) return '';
    return '<div class="detail__yt"><iframe src="https://www.youtube.com/embed/' + vidId +
      '?rel=0&modestbranding=1" title="Video" loading="lazy" frameborder="0" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
      'allowfullscreen></iframe></div>';
  }
  function ytid(u) {
    u = String(u || '').trim();
    var m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
    if (m) return m[1];
    return /^[\w-]{11}$/.test(u) ? u : '';
  }
  function relatedBlock(rel) {
    if (typeof rel === 'string') rel = { mode: 'piece', id: rel };   // legacy
    var img, title, href, extra = '';
    if (rel && rel.mode === 'image' && rel.image) {
      img = rel.image; title = rel.title || ''; href = rel.image; extra = ' target="_blank" rel="noopener"';
    } else if (rel && (rel.mode === 'piece' || rel.id)) {
      var r = null;
      for (var i = 0; i < ART.length; i++) { if (ART[i].id === rel.id) { r = ART[i]; break; } }
      if (!r) return '';
      img = r.image; title = r.title || ''; href = 'artwork.html?id=' + encodeURIComponent(r.id);
    } else { return ''; }
    return '<div class="detail__related">' +
      '<a class="relcard" href="' + attr(href) + '"' + extra + '>' +
      '<span class="relcard__img"><img src="' + attr(img) + '" alt="' + attr(title) + '"></span>' +
      '<span class="relcard__title">' + esc(title) + '</span></a></div>';
  }

  /* ---------- per-piece Instagram icon (under the date) ----------
     Uses this piece's own link if Josie set one; otherwise falls back to the
     site Instagram so the icon shows on every piece. No real link → no icon. */
  function instagramLink(a) {
    var url = (a.instagram && String(a.instagram).trim()) || S.instagram || '';
    if (!url || /REPLACE_ME/.test(url)) return '';
    return '<a class="detail__ig" href="' + attr(url) + '" target="_blank" rel="noopener" ' +
      'aria-label="View on Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/>' +
      '<circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/>' +
      '</svg></a>';
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }
  function attr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function backArrow() {
    return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 8 12 15 18"/></svg>';
  }
  function fwdArrow() {
    return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 16 12 9 18"/></svg>';
  }
})();
