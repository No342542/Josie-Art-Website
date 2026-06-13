/* Manage tool — visual gallery manager.

   Model:
     • ALL_ARTS  = the master list (window.ARTWORKS) — every photo, in order.
     • COLLECTIONS[cat] = an ordered list of ids = the curated "<cat>" gallery.
       A photo can be in several galleries. Uploading adds to ALL only.
       "Removing" from a gallery just drops it from that collection (stays in ALL).

   Pages (tabs): "All" is the master grid (upload / reorder / trash). Each other
   category is a curated page with NO upload — you drag photos in from the ALL panel
   on the right, drag to reorder, and drag down to the bar to remove from that gallery.

   Talks to the local admin server (reads/writes data.js via /api/*). */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var grid = $('grid'), statusEl = $('status'), trashcan = $('trashcan');
  var dropveil = $('dropveil'), emptyEl = $('empty'), poolRemove = $('poolRemove');
  var filePick = $('filePick'), videoPick = $('videoPick'), relatedPick = $('relatedPick');
  var cardTpl = $('cardTpl');

  var SITE = {}, CATS = [], HAS_VIDEO = false;
  var ALL_ARTS = [];        // master list (the "All" tab)
  var COLLECTIONS = {};     // { category: [id, …] } — curated, ordered subsets of ALL
  var currentTab = 'All';
  var editing = null, saveTimer = null, dragCard = null, poolDragId = null, lastDragEnd = 0;
  var EASE = 'transform .25s cubic-bezier(.22,.61,.36,1)';

  function setStatus(t, c) { statusEl.textContent = t; statusEl.className = 'save' + (c ? ' ' + c : ''); }
  function hasFiles(e) { return e.dataTransfer && [].indexOf.call(e.dataTransfer.types, 'Files') >= 0; }
  function esc(s){ return String(s==null?'':s); }
  function fileToBase64(f){ return new Promise(function(res,rej){ var r=new FileReader(); r.onload=function(){res(String(r.result));}; r.onerror=rej; r.readAsDataURL(f); }); }
  function api(path, body){
    return fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){ return r.json().then(function(j){ if(!r.ok||j.error) throw new Error(j.error||r.status); return j; }); });
  }
  function basename(p){ return String(p||'').split('/').pop(); }

  /* ---------- model helpers ---------- */
  function tabsList(){ return ['All'].concat(CATS); }
  function artById(id){ for (var i=0;i<ALL_ARTS.length;i++) if (ALL_ARTS[i].id===id) return ALL_ARTS[i]; return null; }
  function membershipOf(id){ return CATS.filter(function(c){ return (COLLECTIONS[c]||[]).indexOf(id) >= 0; }); }
  function isArray(x){ return Object.prototype.toString.call(x) === '[object Array]'; }

  // Build COLLECTIONS from saved data, or (first run) seed each gallery from the
  // old single `category` field so nothing is lost. Prunes ids no longer in ALL.
  function migrateCollections(existing){
    var idset = {}; ALL_ARTS.forEach(function(a){ if (a.id) idset[a.id]=true; });
    var out = {};
    CATS.forEach(function(c){
      if (existing && isArray(existing[c])){
        out[c] = existing[c].filter(function(id){ return idset[id]; });
      } else {
        out[c] = ALL_ARTS.filter(function(a){ return a.category===c && a.id; }).map(function(a){ return a.id; });
      }
    });
    return out;
  }
  function addToCollection(cat, id, index){
    var list = COLLECTIONS[cat] || (COLLECTIONS[cat]=[]);
    if (list.indexOf(id) >= 0) return false;                 // already in this gallery
    if (index==null || index<0 || index>list.length) list.push(id); else list.splice(index, 0, id);
    return true;
  }
  function removeFromCollection(cat, id){
    if (COLLECTIONS[cat]) COLLECTIONS[cat] = COLLECTIONS[cat].filter(function(x){ return x!==id; });
  }
  function removeArtEverywhere(id){
    ALL_ARTS = ALL_ARTS.filter(function(a){ return a.id !== id; });
    CATS.forEach(function(c){ removeFromCollection(c, id); });
  }
  // After a drag-reorder, read the new DOM order back into the right list.
  function syncOrderFromDOM(){
    var arts = [].map.call(grid.querySelectorAll('.card'), function(c){ return c._art; });
    if (currentTab === 'All') ALL_ARTS = arts.slice();
    else COLLECTIONS[currentTab] = arts.map(function(a){ return a.id; }).filter(Boolean);
  }

  /* ---------- load ---------- */
  fetch('/api/data').then(function(r){return r.json();}).then(function(d){
    SITE = d.site || {}; HAS_VIDEO = !!SITE.hasVideo;
    CATS = (SITE.categories||[]).filter(function(c){return c!=='All';});
    ALL_ARTS = (d.artworks||[]).slice();
    COLLECTIONS = migrateCollections(SITE.collections);
    $('siteName').textContent = SITE.name || '';
    document.title = 'Manage ' + (SITE.name||'gallery');
    var key = (SITE.name||'').toLowerCase();
    $('brandMark').style.backgroundImage = "url('/assets/img/logo/" + (key==='josie'?'josie-icon.jpg':'ann-icon.png') + "')";
    if ($('sAbout')) $('sAbout').value = SITE.about || '';
    if ($('sInsta')) $('sInsta').value = SITE.instagram || '';
    currentTab = 'All';
    renderTab();
    refreshTrashCount(); setStatus('All changes saved','saved');
  }).catch(function(e){ setStatus('Could not load','err'); });

  /* ---------- tabs ---------- */
  function renderTabs(){
    var el = $('tabs'); if (!el) return; el.innerHTML='';
    tabsList().forEach(function(tab){
      var n = tab==='All' ? ALL_ARTS.filter(function(a){return a.image;}).length : (COLLECTIONS[tab]||[]).length;
      var b = document.createElement('button');
      b.className = 'tab' + (tab===currentTab ? ' is-active' : ''); b.type='button';
      b.innerHTML = '<span class="tab__name"></span><span class="tab__count">'+n+'</span>';
      b.querySelector('.tab__name').textContent = tab;
      b.addEventListener('click', function(){ switchTab(tab); });
      el.appendChild(b);
    });
  }
  function switchTab(tab){ if (tab===currentTab) return; closeDrawers(); currentTab = tab; renderTab(); }

  /* ---------- render the current tab ---------- */
  function renderTab(){
    grid.innerHTML='';
    var list = currentTab==='All' ? ALL_ARTS : (COLLECTIONS[currentTab]||[]).map(artById).filter(Boolean);
    list.forEach(function(a){ grid.appendChild(buildCard(a)); });
    applyMode(); renderTabs(); updateEmpty();
    if (currentTab!=='All') renderPool();
  }
  function applyMode(){
    var isAll = currentTab==='All';
    document.body.classList.toggle('mode-subcat', !isAll);
    $('addBtn').style.display = isAll ? '' : 'none';
    trashcan.style.display = isAll ? '' : 'none';
    if ($('pool')) $('pool').setAttribute('aria-hidden', isAll?'true':'false');
    var lead = $('lead');
    if (lead) lead.textContent = isAll
      ? 'Drag to reorder. Drop photos from your computer anywhere here to add. Drag a photo to the trash can to remove it.'
      : 'Your “'+currentTab+'” gallery. Drag photos in from the panel on the right to add them, drag to reorder, and drag a photo onto “Remove from collection” (top of that panel) to take it out — it stays in All.';
    if ($('removeLabel')) $('removeLabel').textContent = 'Remove from “'+currentTab+'”';
    if ($('eTrash')) $('eTrash').textContent = isAll ? '🗑 Move to Trash' : '✕ Remove from “'+currentTab+'”';
    emptyEl.textContent = isAll
      ? 'No photos yet — drop images here or press ＋ Add photos.'
      : 'Nothing in “'+currentTab+'” yet — drag photos in from the panel on the right.';
  }
  function updateEmpty(){ var n=grid.querySelectorAll('.card').length; emptyEl.hidden = n>0; }

  /* ---------- card ---------- */
  function buildCard(art){
    var card = cardTpl.content.firstElementChild.cloneNode(true);
    card._art = art;
    if (art.image) card.querySelector('.card__media img').src = '/' + art.image;
    paintCard(card);
    card.addEventListener('click', function(){ if (Date.now()-lastDragEnd < 250) return; openEdit(card); });
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    card.addEventListener('dragover', onCardDragOver);
    return card;
  }
  function paintCard(card){
    var a = card._art;
    card.querySelector('.card__title').textContent = a.title || 'Untitled';
    var chip = card.querySelector('.card__cat');
    if (currentTab === 'All'){
      var mem = membershipOf(a.id);                 // which galleries this photo is in
      chip.textContent = mem.join(' · ');
      chip.style.display = mem.length ? '' : 'none';
    } else {
      chip.style.display = 'none';
    }
  }

  /* ---------- drag reorder (+ arm the right drop target) ---------- */
  function onDragStart(e){
    dragCard = this; this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain','reorder');
    if (currentTab === 'All') trashcan.classList.add('armed');
    else if (poolRemove) poolRemove.classList.add('armed');
  }
  function onDragEnd(){
    var was = dragCard;
    if (dragCard) dragCard.classList.remove('dragging');
    trashcan.classList.remove('armed','hot');
    if (poolRemove) poolRemove.classList.remove('armed','hot');
    lastDragEnd = Date.now();
    if (was){ syncOrderFromDOM(); scheduleSave(); }   // a genuine reorder (a drop target would have cleared dragCard)
    dragCard = null;
  }
  function onCardDragOver(e){
    if (!dragCard || hasFiles(e) || this === dragCard) return;
    e.preventDefault();
    var r = this.getBoundingClientRect();
    // Row-major grid: the pointer's horizontal half of the hovered card decides — the LEFT half inserts
    // BEFORE it (so a card dragged to its left pushes it rightwards), the RIGHT half inserts after it.
    // (Cards are uniform height, and dragover only fires on the card under the pointer, so left/right
    //  is the correct reading-order discriminator — the old vertical-first test broke column-1 slots.)
    var after = (e.clientX - r.left) > r.width / 2;
    flip(function(){ grid.insertBefore(dragCard, after ? this.nextSibling : this); }.bind(this));
  }
  function flip(mutate){
    var els = [].slice.call(grid.querySelectorAll('.card'));
    var old = new Map(); els.forEach(function(el){ old.set(el, el.getBoundingClientRect()); });
    mutate();
    els.forEach(function(el){
      var o = old.get(el); if(!o) return;
      var n = el.getBoundingClientRect(); var dx=o.left-n.left, dy=o.top-n.top;
      if (dx||dy){ el.style.transition='none'; el.style.transform='translate('+dx+'px,'+dy+'px)';
        requestAnimationFrame(function(){ el.style.transition=EASE; el.style.transform=''; }); }
    });
  }

  /* ---------- trash can (All tab: remove from the site entirely, 30-day undo) ---------- */
  trashcan.addEventListener('dragover', function(e){ if (dragCard && !hasFiles(e)){ e.preventDefault(); trashcan.classList.add('hot'); } });
  trashcan.addEventListener('dragleave', function(){ trashcan.classList.remove('hot'); });
  trashcan.addEventListener('drop', function(e){
    if (dragCard && !hasFiles(e)){ e.preventDefault(); var c=dragCard; dragCard=null;
      trashcan.classList.remove('hot','armed'); c.classList.remove('dragging'); trashCard(c); }
  });

  /* ---------- remove zone (top of the ALL panel: drop a gallery card here to take it OUT of this gallery) ---------- */
  if (poolRemove){
    poolRemove.addEventListener('dragover', function(e){ if (dragCard && currentTab!=='All' && !hasFiles(e)){ e.preventDefault(); poolRemove.classList.add('hot'); } });
    poolRemove.addEventListener('dragleave', function(){ poolRemove.classList.remove('hot'); });
    poolRemove.addEventListener('drop', function(e){
      if (dragCard && currentTab!=='All' && !hasFiles(e)){ e.preventDefault(); var c=dragCard; dragCard=null;
        poolRemove.classList.remove('hot','armed'); c.classList.remove('dragging');
        removeFromCurrentUI(c._art.id);
      }
    });
  }

  /* ---------- ALL-photos pool: drag a thumbnail onto the grid to add it to this gallery ----------
     Adds/removes are SURGICAL — they touch just the one card + the one pool thumbnail, and never
     rebuild the whole view. So you stay in the gallery and keep your scroll position, and can keep
     dragging photos in/out without the view jumping. (Full renders only happen when you switch tabs.) */
  function poolChip(a){
    var inSet = (COLLECTIONS[currentTab]||[]).indexOf(a.id) >= 0;
    var t = document.createElement('div');
    t.className = 'pchip' + (inSet ? ' is-in' : '');
    t.setAttribute('data-id', a.id);
    t.innerHTML = '<img src="/'+a.image+'" alt=""><span class="pchip__t"></span>' + (inSet ? '<span class="pchip__badge">in</span>' : '');
    t.querySelector('.pchip__t').textContent = a.title || 'Untitled';
    if (!inSet){
      t.draggable = true;
      t.title = 'Drag in, or click to add to “'+currentTab+'”';
      t.addEventListener('dragstart', function(e){ poolDragId=a.id; e.dataTransfer.effectAllowed='copy'; e.dataTransfer.setData('text/plain','pool'); t.classList.add('dragging'); });
      t.addEventListener('dragend', function(){ poolDragId=null; t.classList.remove('dragging'); });
      t.addEventListener('click', function(){ addToCurrentUI(a.id, null); });
    }
    return t;
  }
  function poolChipById(id){
    var pg = $('poolGrid'); if (!pg) return null;
    for (var i=0;i<pg.children.length;i++){ if (pg.children[i].getAttribute('data-id')===id) return pg.children[i]; }
    return null;
  }
  function refreshChip(id){                                   // swap one chip in place (added ↔ available)
    var a = artById(id), old = poolChipById(id);
    if (a && old) old.parentNode.replaceChild(poolChip(a), old);
    var pg = $('poolGrid');
    if ($('poolEmpty')) $('poolEmpty').hidden = !pg || pg.querySelectorAll('.pchip:not(.is-in)').length > 0;
  }
  function renderPool(){                                      // full pool build (on tab switch only)
    var pg = $('poolGrid'); if (!pg) return;
    pg.innerHTML='';
    if ($('poolHint')) $('poolHint').textContent = 'Drag (or click) a photo to add it to “'+currentTab+'.”';
    var available = 0;
    ALL_ARTS.forEach(function(a){ if (!a.id || !a.image) return; var c = poolChip(a); if (c.className.indexOf('is-in')<0) available++; pg.appendChild(c); });
    if ($('poolEmpty')) $('poolEmpty').hidden = available > 0;
  }
  function addToCurrentUI(id, idx){                           // add ONE card + flip ONE chip; no teardown
    if (currentTab==='All') return;
    if (!addToCollection(currentTab, id, idx)) return;        // already in this gallery
    var a = artById(id); if (!a) return;
    var card = buildCard(a);
    var cards = grid.querySelectorAll('.card');
    if (idx==null || idx>=cards.length) grid.appendChild(card); else grid.insertBefore(card, cards[idx]);
    updateEmpty(); refreshChip(id); renderTabs(); saveNow();
  }
  function removeFromCurrentUI(id){                           // remove ONE card + flip ONE chip back
    if (currentTab==='All') return;
    removeFromCollection(currentTab, id);
    var cards = grid.querySelectorAll('.card');
    for (var i=0;i<cards.length;i++){ if (cards[i]._art && cards[i]._art.id===id){ cards[i].remove(); break; } }
    updateEmpty(); refreshChip(id); renderTabs(); saveNow();
    setStatus('Removed from “'+currentTab+'”','saved');
  }
  function dropIndex(e){
    var cards = grid.querySelectorAll('.card');
    for (var i=0;i<cards.length;i++){
      var r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top) return i;                                   // pointer is above this row
      if (e.clientY <= r.bottom && e.clientX <= r.left + r.width/2) return i;  // left half of a card in this row
    }
    return cards.length;
  }
  grid.addEventListener('dragover', function(e){
    if (!poolDragId) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect='copy'; grid.classList.add('pool-target');
  });
  grid.addEventListener('dragleave', function(e){ if (!grid.contains(e.relatedTarget)) grid.classList.remove('pool-target'); });
  grid.addEventListener('drop', function(e){
    if (!poolDragId) return; e.preventDefault(); e.stopPropagation(); grid.classList.remove('pool-target');
    var id = poolDragId; poolDragId = null;
    if (currentTab!=='All') addToCurrentUI(id, dropIndex(e));
  });

  /* ---------- trash a card (site-wide delete; 30-day trash) ---------- */
  function trashCard(card){
    var a = card._art;
    setStatus('Removing…','saving');
    api('/api/trash', { art: { id:a.id, title:a.title, date:a.date, category:a.category, image:a.image, text:a.text, video:a.video||null, videoTitle:a.videoTitle||null } })
      .then(function(res){
        if (editing===card) closeDrawers();
        removeArtEverywhere(a.id);
        card.style.transition='transform .2s ease, opacity .2s ease'; card.style.transform='scale(.85)'; card.style.opacity='0';
        setTimeout(function(){ card.remove(); updateEmpty(); }, 180);
        setTrashCount(res.count); renderTabs(); if (currentTab!=='All') renderPool();
        saveNow(); setStatus('Moved to Trash','saved');
        if (trashOpen()) loadTrash();      // if the Trash panel is open, show the item right away
      })
      .catch(function(){ setStatus('Could not remove','err'); });
  }

  /* ---------- upload (button + drag-drop) — always lands in ALL ---------- */
  $('addBtn').addEventListener('click', function(){ filePick.value=''; filePick.click(); });
  filePick.addEventListener('change', function(){ handleFiles(filePick.files); });

  function handleFiles(files){
    var imgs = [].filter.call(files, function(f){ return /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|avif|tiff?|heic|heif|bmp)$/i.test(f.name); });
    if (!imgs.length) return;
    if (currentTab !== 'All') switchTab('All');     // new uploads belong to the master list
    imgs.forEach(function(f){
      var art = { id:'', title:f.name.replace(/\.[^.]+$/,''), date:String(new Date().getFullYear()),
        category:'', image:'', text:'', video:null, videoTitle:null, youtube:null,
        related:null, relatedUnderMain:false, instagram:null };
      ALL_ARTS.push(art);
      var card = buildCard(art); card.classList.add('card--uploading'); grid.appendChild(card); updateEmpty();
      setStatus('Uploading…','saving');
      fileToBase64(f).then(function(b64){ return api('/api/upload',{kind:'image',filename:f.name,dataBase64:b64}); })
        .then(function(res){
          art.image = res.path; art.id = res.id;
          card.querySelector('.card__media img').src = '/' + res.path;
          card.classList.remove('card--uploading'); renderTabs(); saveNow();
        })
        .catch(function(e){ ALL_ARTS = ALL_ARTS.filter(function(x){return x!==art;}); card.remove(); updateEmpty(); setStatus(String((e && e.message) || 'Upload failed'),'err'); });
    });
  }

  // External file drops (Finder, Photos…). Gate on !dragCard && !poolDragId so this
  // never collides with internal card reorder or a pool-thumbnail drag.
  var fileDepth = 0;
  window.addEventListener('dragenter', function(e){ if (dragCard || poolDragId) return; fileDepth++; dropveil.classList.add('show'); });
  window.addEventListener('dragover',  function(e){ if (!dragCard && !poolDragId) e.preventDefault(); });
  window.addEventListener('dragleave', function(e){ if (dragCard || poolDragId) return; fileDepth--; if (fileDepth<=0){ fileDepth=0; dropveil.classList.remove('show'); } });
  window.addEventListener('drop', function(e){
    if (dragCard || poolDragId) return;
    e.preventDefault(); fileDepth=0; dropveil.classList.remove('show');
    var f = e.dataTransfer && e.dataTransfer.files;
    if (f && f.length) handleFiles(f);
  });

  /* ---------- edit drawer ---------- */
  function openEdit(card){
    editing = card; var a = card._art;
    $('eImg').src = a.image ? '/'+a.image : '';
    $('eTitle').value = a.title||''; $('eDate').value = a.date||''; $('eText').value = a.text||'';
    var sel = $('eCat'); sel.innerHTML='';
    CATS.forEach(function(c){ var o=document.createElement('option'); o.value=c; o.textContent=c; if(c===a.category)o.selected=true; sel.appendChild(o); });
    $('eVideoField').style.display = HAS_VIDEO ? '' : 'none';
    renderEditVideo(a);
    if ($('eYoutube')) $('eYoutube').value = a.youtube || '';
    if ($('eInstagram')) $('eInstagram').value = a.instagram || '';
    renderRelated(a);
    var dl=$('eDownload'); dl.href = a.image?'/'+a.image:'#'; dl.setAttribute('download', basename(a.image));
    showDrawer('editDrawer');
  }
  function renderEditVideo(a){
    $('eVideoName').textContent = a.video ? basename(a.video) : 'none';
    $('eVideoName').classList.toggle('has', !!a.video);
    $('eClearVideo').hidden = !a.video;
    var tf = $('eVideoTitleField');                          // title only matters when a video exists
    if (tf){ tf.hidden = !a.video; $('eVideoTitle').value = a.videoTitle || ''; }
  }
  function renderRelated(a){
    var sel = $('eRelated'); if (!sel) return;
    var rel = a.related;
    var isImg = rel && typeof rel === 'object' && rel.mode === 'image';
    var curId = (rel && typeof rel === 'object' && rel.mode === 'piece') ? rel.id : (typeof rel === 'string' ? rel : '');
    function opt(v, t){ var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
    sel.innerHTML = '';
    sel.appendChild(opt('', '— None —'));
    sel.appendChild(opt('__upload__', '＋ Upload a new image…'));
    if (isImg) { var io = opt('__image__', '🖼 Uploaded image'); io.selected = true; sel.appendChild(io); }
    var grp = document.createElement('optgroup'); grp.label = 'From your gallery';
    ALL_ARTS.forEach(function(o){                              // pick related from the whole gallery
      if (!o.id || o === a) return;                            // skip self + still-uploading
      var op = opt(o.id, o.title || o.id); if (o.id === curId) op.selected = true; grp.appendChild(op);
    });
    if (grp.children.length) sel.appendChild(grp);
    if (!isImg && !curId) sel.value = '';
    var posField = $('eRelatedPosField');                  // the "under main art" checkbox only matters with a related art
    if (posField){ posField.hidden = !(isImg || curId); $('eRelatedUnderMain').checked = !!a.relatedUnderMain; }
    renderRelatedUpload(a);
  }
  function renderRelatedUpload(a){
    var box = $('eRelatedUpload'); if (!box) return;
    var rel = a.related;
    if (rel && typeof rel === 'object' && rel.mode === 'image') {
      box.hidden = false;
      $('eRelatedThumb').src = '/' + rel.image;
      $('eRelatedTitle').value = rel.title || '';
    } else { box.hidden = true; }
  }
  $('eTitle').addEventListener('input', function(){ if(!editing)return; editing._art.title=this.value; paintCard(editing); scheduleSave(); });
  $('eDate').addEventListener('input', function(){ if(!editing)return; editing._art.date=this.value; scheduleSave(); });
  $('eText').addEventListener('input', function(){ if(!editing)return; editing._art.text=this.value; scheduleSave(); });
  if ($('eCat')) $('eCat').addEventListener('change', function(){ if(!editing)return; editing._art.category=this.value; scheduleSave(); });
  $('eAddVideo').addEventListener('click', function(){ if(!editing)return; videoPick.value=''; videoPick.click(); });
  $('eClearVideo').addEventListener('click', function(){ if(!editing)return; editing._art.video=null; renderEditVideo(editing._art); scheduleSave(); });
  if ($('eVideoTitle')) $('eVideoTitle').addEventListener('input', function(){ if(!editing)return; editing._art.videoTitle=this.value; scheduleSave(); });
  if ($('eYoutube')) $('eYoutube').addEventListener('input', function(){ if(!editing)return; editing._art.youtube=this.value.trim()||null; scheduleSave(); });
  if ($('eRelated')) $('eRelated').addEventListener('change', function(){
    if(!editing) return; var a = editing._art; var v = this.value;
    if (v === '__upload__') { relatedPick.value=''; relatedPick.click(); renderRelated(a); return; }
    if (v === '__image__') return;                          // keep the current uploaded image
    a.related = v ? { mode:'piece', id:v } : null;
    renderRelated(a); scheduleSave();
  });
  if ($('eRelatedTitle')) $('eRelatedTitle').addEventListener('input', function(){
    if(!editing) return; var a = editing._art;
    if (a.related && a.related.mode === 'image') { a.related.title = this.value; scheduleSave(); }
  });
  if ($('eRelatedRemove')) $('eRelatedRemove').addEventListener('click', function(){
    if(!editing) return; editing._art.related = null; renderRelated(editing._art); scheduleSave();
  });
  if ($('eRelatedUnderMain')) $('eRelatedUnderMain').addEventListener('change', function(){
    if(!editing) return; editing._art.relatedUnderMain = this.checked; scheduleSave();
  });
  if ($('eInstagram')) $('eInstagram').addEventListener('input', function(){
    if(!editing) return; editing._art.instagram = this.value.trim() || null; scheduleSave();
  });
  // The danger button means different things per page: delete site-wide (All) vs
  // remove from just this gallery (a subcategory).
  $('eTrash').addEventListener('click', function(){
    if (!editing) return;
    if (currentTab === 'All'){ trashCard(editing); }
    else { var id = editing._art.id; closeDrawers(); removeFromCurrentUI(id); }
  });
  $('editClose').addEventListener('click', closeDrawers);
  videoPick.addEventListener('change', function(){
    var f=videoPick.files[0]; if(!f||!editing) return; var a=editing._art;
    setStatus('Uploading video…','saving');
    fileToBase64(f).then(function(b64){ return api('/api/upload',{kind:'video',filename:f.name,dataBase64:b64}); })
      .then(function(res){ a.video=res.path; renderEditVideo(a); saveNow(); })
      .catch(function(){ setStatus('Video upload failed — use .mp4','err'); });
  });
  relatedPick.addEventListener('change', function(){
    var f=relatedPick.files[0]; if(!f||!editing) return; var a=editing._art;
    setStatus('Uploading…','saving');
    fileToBase64(f).then(function(b64){ return api('/api/upload',{kind:'related',filename:f.name,dataBase64:b64}); })
      .then(function(res){ a.related={ mode:'image', image:res.path, title:'' }; renderRelated(a); saveNow(); })
      .catch(function(){ setStatus('Upload failed — use jpg/png/gif/webp','err'); });
  });

  /* ---------- settings (about / instagram) ---------- */
  if ($('settingsBtn')) $('settingsBtn').addEventListener('click', function(){ showDrawer('settingsDrawer'); });
  if ($('settingsClose')) $('settingsClose').addEventListener('click', closeDrawers);
  if ($('sAbout')) $('sAbout').addEventListener('input', function(){ SITE.about=this.value; scheduleSave(); });
  if ($('sInsta')) $('sInsta').addEventListener('input', function(){ SITE.instagram=this.value; scheduleSave(); });

  /* ---------- trash drawer (non-modal: drag photos into it to delete — All tab only) ---------- */
  var trashDrawer = $('trashDrawer');
  function trashOpen(){ return trashDrawer.getAttribute('aria-hidden') === 'false'; }
  $('trashBtn').addEventListener('click', function(){ trashOpen() ? closeDrawers() : openTrash(); });
  $('trashClose').addEventListener('click', closeDrawers);
  function openTrash(){ showDrawer('trashDrawer'); loadTrash(); }
  function loadTrash(){
    var list=$('trashList'); list.innerHTML='<p class="lead">Loading…</p>';
    return fetch('/api/trash').then(function(r){return r.json();}).then(function(d){
      setTrashCount(d.count); list.innerHTML='';
      $('trashEmpty').hidden = d.items.length>0;
      d.items.forEach(function(it){ list.appendChild(buildTrashItem(it)); });
    }).catch(function(){ list.innerHTML='<p class="lead">Could not load trash.</p>'; });
  }
  trashDrawer.addEventListener('dragover', function(e){ if (dragCard && currentTab==='All' && !hasFiles(e)){ e.preventDefault(); trashDrawer.classList.add('drop'); } });
  trashDrawer.addEventListener('dragleave', function(e){ if (!trashDrawer.contains(e.relatedTarget)) trashDrawer.classList.remove('drop'); });
  trashDrawer.addEventListener('drop', function(e){
    if (dragCard && currentTab==='All' && !hasFiles(e)){ e.preventDefault(); var c=dragCard; dragCard=null;
      trashDrawer.classList.remove('drop'); trashcan.classList.remove('hot','armed'); c.classList.remove('dragging'); trashCard(c); }
  });
  function buildTrashItem(it){
    var el=document.createElement('div'); el.className='titem';
    var days = it.daysLeft===0 ? 'deletes today' : (it.daysLeft+' day'+(it.daysLeft===1?'':'s')+' left');
    el.innerHTML =
      '<img class="titem__thumb" alt="" src="'+(it.thumb||'')+'">' +
      '<div class="titem__main"><div class="titem__title"></div>' +
      '<div class="titem__meta">'+days+'</div>' +
      '<div class="titem__acts"><button class="minibtn minibtn--primary js-restore">Restore</button>' +
      '<button class="minibtn minibtn--danger js-forever">Delete now</button></div></div>';
    el.querySelector('.titem__title').textContent = it.art.title || 'Untitled';
    el.querySelector('.js-restore').addEventListener('click', function(){
      api('/api/restore',{id:it.art.id}).then(function(res){
        ALL_ARTS.push(res.art);
        if (currentTab==='All') grid.appendChild(buildCard(res.art));
        updateEmpty(); renderTabs(); if (currentTab!=='All') renderPool();
        saveNow(); setTrashCount(res.count); el.remove();
        if (res.count===0) $('trashEmpty').hidden=false;
      }).catch(function(){ setStatus('Restore failed','err'); });
    });
    el.querySelector('.js-forever').addEventListener('click', function(){
      if(!confirm('Permanently delete “'+(it.art.title||'this photo')+'”? This cannot be undone.')) return;
      api('/api/purge',{id:it.art.id}).then(function(res){ setTrashCount(res.count); el.remove(); if(res.count===0)$('trashEmpty').hidden=false; });
    });
    return el;
  }
  function refreshTrashCount(){ fetch('/api/trash').then(function(r){return r.json();}).then(function(d){ setTrashCount(d.count); }).catch(function(){}); }
  function setTrashCount(n){ var b=$('trashCount'); b.textContent=n; b.hidden = !n; }

  /* ---------- drawers ---------- */
  function showDrawer(id){
    ['editDrawer','trashDrawer','settingsDrawer'].forEach(function(d){ var el=$(d); if(el) el.setAttribute('aria-hidden', d===id?'false':'true'); });
    $('scrim').hidden = (id === 'trashDrawer');   // trash panel is non-modal so you can drag photos into it
  }
  function closeDrawers(){
    ['editDrawer','trashDrawer','settingsDrawer'].forEach(function(d){ var el=$(d); if(el) el.setAttribute('aria-hidden','true'); });
    $('scrim').hidden=true; editing=null;
  }
  $('scrim').addEventListener('click', closeDrawers);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeDrawers(); });

  /* ---------- publish ---------- */
  $('publishBtn').addEventListener('click', function(){
    setStatus('Publishing…','saving');
    api('/api/save', { site:siteForSave(), artworks:cleanArts() })
      .then(function(){ return api('/api/publish', {}); })
      .then(function(res){
        if (res.ok){ setStatus('Published ✓ · live in ~1 min','saved'); }
        else { setStatus('Not published yet','err'); alert(res.message || 'Could not publish.'); }
      })
      .catch(function(e){ setStatus('Publish failed','err'); alert('Could not publish: ' + e.message); });
  });

  /* ---------- save ---------- */
  function siteForSave(){ SITE.collections = COLLECTIONS; return SITE; }
  function cleanArts(){
    return ALL_ARTS.map(function(a){ return { id:a.id, title:a.title||'', date:a.date||'', category:a.category||'',
        image:a.image, text:a.text||'', video:a.video||null, videoTitle:(a.videoTitle && String(a.videoTitle).trim())||null,
        youtube:a.youtube||null, related:a.related||null, relatedUnderMain:!!a.relatedUnderMain,
        instagram:(a.instagram && String(a.instagram).trim())||null }; })
      .filter(function(a){ return a.image; });
  }
  function saveNow(){
    setStatus('Saving…','saving');
    api('/api/save', { site:siteForSave(), artworks:cleanArts() })
      .then(function(){ setStatus('All changes saved','saved'); })
      .catch(function(){ setStatus('Save failed','err'); });
  }
  function scheduleSave(){ setStatus('Editing…','saving'); clearTimeout(saveTimer); saveTimer=setTimeout(saveNow, 600); }
})();
