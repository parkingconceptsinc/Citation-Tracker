/* PCI Citation Tracker — shared Google Sheet sync layer (ACTPROD)
 * One authoritative backend for Management and Supervisor.
 * IndexedDB is used only as a visible offline read cache.
 * Every call carries the supervisor session the launcher passed in ?token=.
 */
(function(){
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbzWtAKS2m7Wye8glheRN70FnUhbKgTHbhip9bFSv3rmwuA1MUQ1acb5NX65vVRNg0AF/exec';
  var SESSION_KEY = 'pci-citation-session';

  // The supervisor launcher opens this page with ?token=<Supervisor Auth
  // session>. Keep it for this tab only and take it out of the address bar
  // so it is not copied, bookmarked or left in history.
  var sessionToken = '';
  (function captureSession(){
    try {
      var url = new URL(window.location.href);
      var fromUrl = url.searchParams.get('token');
      if (fromUrl) {
        sessionStorage.setItem(SESSION_KEY, fromUrl);
        url.searchParams.delete('token');
        history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
      }
      sessionToken = sessionStorage.getItem(SESSION_KEY) || '';
    } catch (_) {}
  })();

  function unauthorizedError(){
    var err = new Error('Supervisor session required. Open Citation Tracker from the supervisor launcher.');
    err.code = 'unauthorized';
    return err;
  }
  var localAll = window.idbAll;
  var localPut = window.idbBulkPut;
  var localClear = window.idbClear;
  var originalRender = window.render;
  var originalCommitImport = window.commitImport;
  var sharedState = { source:'loading', error:'', lastSync:null };

  // Apps Script cold starts plus a full Sheet read can take well over 15s;
  // timing out earlier labelled a slow-but-working read as "Offline Cache".
  var READ_TIMEOUT_MS = 45000;
  // Apps Script rejects more than 5000 records per call (Code.gs
  // MAX_RECORDS_PER_IMPORT); bigger CSVs are sent in several calls.
  var IMPORT_CHUNK = 2000;

  // The offline copy is only shown before the server answers when it was
  // saved under this same supervisor session. The key stores a hash of the
  // session, never the session itself.
  var CACHE_OWNER_KEY = 'pci-citation-cache-owner';
  function sessionFingerprint(){
    if (!sessionToken || !window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve('');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode('pci-citation:' + sessionToken)).then(function(buf){
      return Array.prototype.map.call(new Uint8Array(buf), function(b){ return ('0' + b.toString(16)).slice(-2); }).join('');
    }).catch(function(){ return ''; });
  }
  function setCacheOwner(on){
    if (!on) { try { localStorage.removeItem(CACHE_OWNER_KEY); } catch (_) {} return Promise.resolve(); }
    return sessionFingerprint().then(function(fp){
      try { if (fp) localStorage.setItem(CACHE_OWNER_KEY, fp); } catch (_) {}
    });
  }

  // Records already read from the server that the next idbAll() can use
  // instead of reading the whole Sheet again (after an import's verify read,
  // or the saved copy shown at boot).
  var nextRead = null;

  // Remove the obsolete per-browser endpoint override. Management and
  // Supervisor must never be able to point at different Citation APIs.
  try { localStorage.removeItem('pci-citation-api-url'); } catch (_) {}

  function jsonp(params){
    return new Promise(function(resolve, reject){
      var cb = '__pciCitationCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var s = document.createElement('script');
      var timer;
      function cleanup(){
        clearTimeout(timer);
        try { delete window[cb]; } catch (_) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function(data){
        cleanup();
        if (data && data.ok === false && data.error === 'unauthorized') return reject(unauthorizedError());
        if (data && data.ok === false) return reject(new Error(data.error || 'Citation API error'));
        resolve(data || {});
      };
      params = params || {};
      if (!sessionToken) { cleanup(); return reject(unauthorizedError()); }
      params.token = sessionToken;
      params.callback = cb;
      params._ = Date.now();
      var q = Object.keys(params).map(function(k){
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      s.src = API_URL + '?' + q;
      s.onerror = function(){ cleanup(); reject(new Error('Could not reach shared Citation API')); };
      timer = setTimeout(function(){
        cleanup();
        // A response that still arrives later must not throw "callback is
        // not defined" into the page.
        window[cb] = function(){ try { delete window[cb]; } catch (_) {} };
        reject(new Error('Shared Citation API timed out'));
      }, READ_TIMEOUT_MS);
      document.head.appendChild(s);
    });
  }

  function post(payload){
    if (!sessionToken) return Promise.reject(unauthorizedError());
    payload = Object.assign({ token: sessionToken }, payload);
    return fetch(API_URL, {
      method:'POST',
      mode:'no-cors',
      cache:'no-store',
      headers:{ 'Content-Type':'text/plain;charset=UTF-8' },
      body:JSON.stringify(payload)
    }).catch(function(){
      // The browser only says "Failed to fetch". Importing again is safe:
      // citations are upserted by number, never duplicated.
      throw new Error('Couldn\u2019t reach the shared sheet. Try again.');
    });
  }

  function padTime(value){
    var s = String(value || '').trim();
    var m = s.match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return '';
    return String(m[1]).padStart(2,'0') + ':' + m[2] + ':' + (m[3] || '00');
  }

  function normalizeForWrite(rec){
    var out = {};
    Object.keys(rec || {}).forEach(function(k){ out[k] = rec[k]; });
    var rawDate = String(out.issueDate || '').trim();
    var rawTime = String(out.issueTime || '').trim();
    if (!rawTime && /\d{1,2}:\d{2}/.test(rawDate)) rawTime = rawDate;
    out.issueDate = (rawDate.match(/\d{4}-\d{2}-\d{2}/) || [rawDate])[0];
    out.issueTime = padTime(rawTime);
    return out;
  }

  function cacheShared(records){
    if (!localClear || !localPut) return Promise.resolve();
    return localClear().then(function(){
      return records.length ? localPut(records) : undefined;
    }).then(function(){
      return setCacheOwner(records.length > 0);
    }).catch(function(err){
      console.warn('[Citation Tracker] offline cache update failed', err);
    });
  }

  function setSharedState(source, error){
    sharedState.source = source;
    sharedState.error = error ? String(error.message || error) : '';
    sharedState.lastSync = new Date();
  }

  // Shared Sheet is authoritative. A failed read may show the local cache,
  // but the UI explicitly labels it as Offline cache instead of claiming
  // that a shared refresh succeeded.
  window.idbAll = function(){
    if (nextRead) {
      var ready = nextRead;
      nextRead = null;
      if (Date.now() - ready.at < 15000) return Promise.resolve(ready.records);
    }
    return jsonp({action:'list'}).then(function(data){
      var records = Array.isArray(data.records) ? data.records : [];
      setSharedState('shared');
      cacheShared(records);
      return records;
    }).catch(function(err){
      if (err && err.code === 'unauthorized') {
        // No session: show nothing and drop this device's copy of the data.
        setSharedState('unauthorized', err);
        setCacheOwner(false);
        if (localClear) localClear().catch(function(){});
        return [];
      }
      setSharedState('offline', err);
      console.warn('[Citation Tracker] shared read failed; showing offline cache', err);
      return localAll ? localAll() : [];
    });
  };

  // POST is no-cors because of Apps Script. Verify every write with a
  // subsequent readable list response before treating the import as saved.
  // onProgress(done, total, phase) is optional; phase is 'saving' or 'verifying'.
  window.idbBulkPut = function(records, onProgress){
    records = (Array.isArray(records) ? records : []).map(normalizeForWrite);
    if (!records.length) return Promise.resolve();
    var progress = typeof onProgress === 'function' ? onProgress : function(){};
    var expected = {};
    records.forEach(function(r){
      var k = String(r.citationNo || r.id || '').trim();
      if (k) expected[k] = true;
    });
    var sent = 0;
    var chain = Promise.resolve();
    for (var i = 0; i < records.length; i += IMPORT_CHUNK) {
      (function(chunk){
        chain = chain.then(function(){
          return post({action:'upsert', records:chunk});
        }).then(function(){
          sent += chunk.length;
          if (sent < records.length) progress(sent, records.length, 'saving');
        });
      })(records.slice(i, i + IMPORT_CHUNK));
    }
    return chain.then(function(){
      progress(sent, records.length, 'verifying');
      return jsonp({action:'list'});
    }).then(function(data){
      var server = Array.isArray(data.records) ? data.records : [];
      var seen = {};
      server.forEach(function(r){ seen[String(r.citationNo || r.id || '').trim()] = true; });
      var missing = Object.keys(expected).filter(function(k){ return !seen[k]; });
      if (missing.length) throw new Error('Shared write could not be verified for ' + missing.length + ' citation(s)');
      setSharedState('shared');
      // The page refreshes right after an import; this verify read already
      // is the whole Sheet, so that refresh doesn't need to read it again.
      nextRead = { records:server, at:Date.now() };
      return cacheShared(server);
    }).catch(function(err){
      setSharedState(err && err.code === 'unauthorized' ? 'unauthorized' : 'offline', err);
      throw err;
    });
  };

  // Destructive shared clear is disabled until the production auth gateway
  // exists. This prevents an unauthenticated /exec caller from wiping DEV.
  window.idbClear = function(){
    return Promise.reject(new Error('Shared clear is disabled for data protection.'));
  };

  // iParq supplies one column named "Issue Date & Time". The legacy mapper
  // allowed a source column to be used only once, so issueTime was lost.
  // Reuse that combined source for issueTime; normalizeForWrite extracts only
  // the HH:mm:ss portion before it reaches Apps Script.
  if (typeof originalCommitImport === 'function') {
    window.commitImport = function(built){
      if (built && built.map) {
        var map = {};
        Object.keys(built.map).forEach(function(k){ map[k] = built.map[k]; });
        var combined = String(map.issueDate || '');
        if (!map.issueTime && /time/i.test(combined)) map.issueTime = combined;
        built = { map:map, headers:built.headers };
      }
      return originalCommitImport(built);
    };
  }

  // Always open Management and Supervisor on the same neutral dashboard
  // state. Filters remain usable during the session but no partitioned
  // browser storage can make the two launchers appear to have different data.
  function resetViewState(){
    var defaults = {range:'30d', dateFrom:'', dateTo:'', lot:'', officer:'', status:'', q:''};
    try { localStorage.setItem('cit-filters', JSON.stringify(defaults)); } catch (_) {}
    if ('filters' in window) window.filters = defaults;
    if ('sortKey' in window) window.sortKey = 'issueDate';
    if ('sortDir' in window) window.sortDir = -1;
    if ('pageNo' in window) window.pageNo = 1;
    var search = document.getElementById('fSearch');
    var status = document.getElementById('fStatus');
    var dateFrom = document.getElementById('fDateFrom');
    var dateTo = document.getElementById('fDateTo');
    if (search) search.value = '';
    if (status) status.value = '';
    if (dateFrom) dateFrom.value = '';
    if (dateTo) dateTo.value = '';
    Array.prototype.forEach.call(document.querySelectorAll('#rangeSeg button'), function(b){
      b.classList.toggle('on', b.dataset.range === '30d');
    });
  }

  var COLUMN_ORDER = [5,3,0,2,4,1];
  var LABELS = ['Violation Type','Officer Name','Citation Number','Location','License Plate','Issued Date'];

  function installSharedStyles(){
    if (document.getElementById('pci-shared-dashboard-style')) return;
    var style = document.createElement('style');
    style.id = 'pci-shared-dashboard-style';
    style.textContent =
      '#tbl thead th{position:sticky;top:0;z-index:2;background:var(--surface);border-bottom:2px solid var(--line);}' +
      // Same glow the header stripe uses, on the refresh button too — the
      // family's Dashboard pages do both together (see #reloadBtn.loading
      // in the Apps Script Dashboard files) so the button reads as busy as
      // hard as the stripe, not just dimmed.
      '#sharedRefreshBtn{position:relative;}' +
      '#sharedRefreshBtn[data-busy="1"]{cursor:progress;pointer-events:none;background:rgba(14,22,59,.92);border-color:rgba(255,255,255,.18);color:#fff;}' +
      '#sharedRefreshBtn[data-busy="1"]::before{content:"";position:absolute;inset:0;border-radius:inherit;animation:hazardGlowInset 1.2s ease-in-out infinite;}' +
      '@keyframes hazardGlowInset{0%,100%{opacity:.55;box-shadow:inset 0 0 8px 2px #f2a900,inset 0 0 18px 4px #f2a90055;}50%{opacity:1;box-shadow:inset 0 0 14px 4px #f2a900,inset 0 0 28px 8px #f2a90088;}}' +
      '#sharedRefreshBtn:focus-visible{outline:2px solid var(--blue,#2563eb);outline-offset:3px;}' +
      '#sharedRefreshStamp{font-size:11px;color:var(--ink-soft,var(--ink-faint,#5B6478));white-space:nowrap;}' +
      '@media(prefers-reduced-motion:reduce){#hazardStripe.moving,#sharedRefreshBtn[data-busy="1"]::before{animation:none !important;}}';
    document.head.appendChild(style);
  }

  // The header's #hazardStripe (index.html) is the one loading indicator
  // the whole PCI family uses — invisible at rest, glowing while .moving.
  // This app used to build its own separate one (#sharedHazardLine, above
  // the table, blue) before anyone noticed the shared convention existed.
  //
  // Unlike the old one (a permanently-visible ring that just pulsed
  // brighter when busy), this element is invisible until .moving is
  // added, so it depends on the class actually getting painted. Without
  // a session (a direct/standalone open, not from the supervisor
  // launcher — a common path, not a rare one) jsonp() rejects
  // synchronously inside its own Promise executor: the whole
  // stripeOn()/stripeOff() pair around it then runs as microtasks in the
  // same task, with no paint in between, so the glow never becomes
  // visible at all. stripeOff() enforces a minimum visible time so a
  // same-tick (or just very fast) resolution can't erase it before the
  // browser ever draws it.
  var STRIPE_MIN_MS = 400;
  var stripeShownAt = 0;
  // Matches Patrol/Fuel Dashboard's own stripeOn() (clearTimeout(stripeTimer)
  // first): cancels a still-pending stripeOffNow() from a previous cycle so
  // it can't fire later and clear a newer, still-genuinely-loading glow.
  // Both handles a stripeOff() can leave pending — the rAF request and the
  // setTimeout it schedules — are cancelled, the same way this codebase's
  // own label_editor_pro_pwa (src/fabric/useFabric.js) stores an rAF handle
  // and calls cancelAnimationFrame() before rescheduling.
  var stripeTimer = null;
  var stripeRaf = null;
  function stripeOn(){
    cancelAnimationFrame(stripeRaf);
    stripeRaf = null;
    clearTimeout(stripeTimer);
    stripeTimer = null;
    var el = document.getElementById('hazardStripe');
    if (el) el.classList.add('moving');
    var btn = document.getElementById('sharedRefreshBtn');
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Refreshing…'; }
    stripeShownAt = performance.now();
  }
  function stripeOff(){
    cancelAnimationFrame(stripeRaf);
    clearTimeout(stripeTimer);
    // requestAnimationFrame never fires in a hidden/backgrounded document
    // (browsers pause it), so gating on it there would leave the button
    // stuck disabled/glowing until the tab is foregrounded again — but a
    // hidden document also isn't painting anything for anyone to see, so
    // the race this whole guard exists for can't happen either; skip
    // straight to the real work.
    if (document.hidden) { stripeOffNow(); return; }
    // A wall-clock setTimeout alone only makes the original no-paint bug
    // rare, not impossible: under heavy main-thread contention the event
    // loop can blow past STRIPE_MIN_MS without ever yielding to render.
    // requestAnimationFrame runs right before the next real paint, so by
    // the time this callback fires, the browser has actually rendered at
    // least once since stripeOn() added .moving — an actual guarantee,
    // not a probability.
    stripeRaf = requestAnimationFrame(function(){
      stripeRaf = null;
      var wait = STRIPE_MIN_MS - (performance.now() - stripeShownAt);
      if (wait > 0) { stripeTimer = setTimeout(stripeOffNow, wait); return; }
      stripeOffNow();
    });
  }
  // Button text/disabled state moved here from runSharedRefresh() so they
  // clear together with the glow (data-busy) instead of snapping back to
  // idle immediately while the glow is still being held for its minimum
  // visible time — a glowing button that already looks re-enabled again
  // was worse than the original bug.
  function stripeOffNow(){
    var el = document.getElementById('hazardStripe');
    if (el) el.classList.remove('moving');
    var btn = document.getElementById('sharedRefreshBtn');
    if (btn) { btn.dataset.busy = '0'; btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }

  function applyColumnOrder(){
    var table = document.getElementById('tbl');
    if (!table) return;
    var headRow = table.querySelector('thead tr');
    if (headRow) {
      var heads = Array.prototype.slice.call(headRow.children);
      if (heads.length === 9) {
        COLUMN_ORDER.forEach(function(i,n){
          if (!heads[i]) return;
          heads[i].textContent = LABELS[n];
          heads[i].removeAttribute('data-i18n');
          headRow.appendChild(heads[i]);
        });
        heads.forEach(function(th,i){ if (COLUMN_ORDER.indexOf(i) < 0) th.remove(); });
      } else if (heads.length === 6) {
        heads.forEach(function(th,n){
          th.textContent = LABELS[n];
          th.removeAttribute('data-i18n');
        });
      }
    }
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function(tr){
      if (tr.children.length === 9) {
        var cells = Array.prototype.slice.call(tr.children);
        COLUMN_ORDER.forEach(function(i){ if (cells[i]) tr.appendChild(cells[i]); });
        cells.forEach(function(td,i){ if (COLUMN_ORDER.indexOf(i) < 0) td.remove(); });
      }
      if (tr.children.length === 1 && tr.children[0].hasAttribute('colspan')) tr.children[0].setAttribute('colspan','6');
    });
  }

  /* Without records the dashboard (and its stamp) stays hidden and the page
     shows its empty "import a CSV" card. Without a session that card must
     say how to get in instead of inviting an import that will fail. */
  function showSessionRequired(on){
    var view = document.getElementById('emptyView');
    if (!view) return;
    var title = view.querySelector('h2');
    var body = view.querySelector('p');
    var drop = document.getElementById('dropzone');
    if (on) {
      var es = /^es/i.test(document.documentElement.lang || '');
      if (title) { title.removeAttribute('data-i18n'); title.textContent = es ? 'Se necesita la sesión de supervisor' : 'Supervisor session required'; }
      if (body) {
        body.removeAttribute('data-i18n');
        body.textContent = es
          ? 'Abrí Citation Tracker desde el launcher de supervisor (Supervisor o Management) con tu sesión iniciada.'
          : 'Open Citation Tracker from the supervisor launcher (Supervisor or Management) while signed in.';
      }
      if (drop) drop.hidden = true;
      view.dataset.session = 'required';
    } else if (view.dataset.session === 'required') {
      if (drop) drop.hidden = false;
      delete view.dataset.session;
    }
  }

  function updateRefreshStamp(){
    showSessionRequired(sharedState.source === 'unauthorized');
    var stamp = document.getElementById('sharedRefreshStamp');
    if (!stamp) return;
    var when = sharedState.lastSync ? sharedState.lastSync.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    stamp.dataset.source = sharedState.source;
    stamp.setAttribute('role','status');
    stamp.setAttribute('aria-live','polite');
    stamp.setAttribute('aria-atomic','true');
    if (sharedState.source === 'loading') {
      stamp.textContent = 'Loading shared citations…';
      stamp.title = 'Loading the shared Google Sheet';
    } else if (sharedState.source === 'connecting') {
      stamp.textContent = sharedState.showingCache ? 'Saved copy · checking for updates…' : 'Connecting to shared citations…';
      stamp.title = 'Connecting to the shared Google Sheet';
    } else if (sharedState.source === 'cached') {
      stamp.textContent = 'Saved copy · checking for updates…';
      stamp.title = 'Showing this device’s last copy while the shared Google Sheet loads';
    } else if (sharedState.source === 'shared') {
      stamp.textContent = 'Shared · Updated ' + when;
      stamp.title = 'Loaded from the shared Google Sheet';
    } else if (sharedState.source === 'offline') {
      stamp.textContent = 'Offline Cache · ' + when;
      stamp.title = sharedState.error || 'Shared Sheet unavailable';
    } else if (sharedState.source === 'unauthorized') {
      stamp.textContent = 'Session required · open from the supervisor launcher';
      stamp.title = sharedState.error;
    } else {
      stamp.textContent = 'Loading shared citations…';
    }
  }

  // stripeOn()/stripeOff() own #sharedRefreshBtn's data-busy too now (see
  // above) so its glow shares the same minimum-visible-time guard as the
  // stripe instead of being cleared out from under it immediately.
  function setRefreshBusy(busy){
    if (busy) stripeOn(); else stripeOff();
  }

  // Separate from the glow's own on/off state: stripeOff() can hold the
  // glow visible for STRIPE_MIN_MS after the real work is done, and this
  // guard must not mistake that cosmetic hold for still being in flight
  // (it used to read btn.dataset.busy for this, which stayed '1' during
  // that hold — a real refresh request arriving in that window was
  // silently dropped instead of running).
  var refreshInFlight = false;
  // Shared by both failure paths below (a synchronous throw before any
  // real work starts, and a rejection from the real async work) so they
  // can't quietly diverge from each other over time.
  function failRefresh(err){
    if (sharedState.source !== 'offline') setSharedState('offline', err);
    updateRefreshStamp();
  }
  function runSharedRefresh(){
    if (refreshInFlight) return Promise.resolve();
    refreshInFlight = true;
    // Everything from here down that can throw synchronously (not just
    // window.refresh(), already guarded below) is wrapped so a failure
    // resets refreshInFlight instead of latching it true forever — the
    // whole point of a re-entrancy flag disappears if there's a path
    // that sets it without a matching path to clear it.
    var work;
    try {
      sharedState.source = 'connecting';
      sharedState.error = '';
      updateRefreshStamp();
      setRefreshBusy(true);
      try {
        work = typeof window.refresh === 'function' ? window.refresh() : Promise.resolve();
      } catch (err) {
        work = Promise.reject(err);
      }
    } catch (err) {
      refreshInFlight = false;
      failRefresh(err);
      setRefreshBusy(false);
      return Promise.reject(err);
    }
    return Promise.resolve(work).then(function(){
      applyColumnOrder();
      updateRefreshStamp();
    }).catch(function(err){
      failRefresh(err);
      throw err;
    }).finally(function(){
      refreshInFlight = false;
      setRefreshBusy(false);
    });
  }

  function installRefreshButton(){
    if (document.getElementById('sharedRefreshBtn')) return;
    var exportBtn = document.getElementById('exportBtn');
    if (!exportBtn || !exportBtn.parentNode) return;
    var stamp = document.createElement('span');
    stamp.id = 'sharedRefreshStamp';
    stamp.setAttribute('role','status');
    stamp.setAttribute('aria-live','polite');
    stamp.setAttribute('aria-atomic','true');
    stamp.textContent = 'Loading shared citations…';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn sm';
    btn.id = 'sharedRefreshBtn';
    btn.textContent = '↻ Refresh';
    btn.title = 'Reload citations from the shared Google Sheet';
    btn.addEventListener('click', function(){ runSharedRefresh().catch(function(err){
      console.warn('[Citation Tracker] shared refresh failed', err);
    }); });
    exportBtn.parentNode.insertBefore(stamp, exportBtn);
    exportBtn.parentNode.insertBefore(btn, exportBtn);
  }

  if (typeof originalRender === 'function') {
    window.render = function(){
      var result = originalRender.apply(this, arguments);
      applyColumnOrder();
      return result;
    };
  }

  function showMode(){
    if (window.I18N && window.I18N.en) {
      window.I18N.en.appSub = 'iParq / The Permit Store · shared across devices';
      window.I18N.en.manageNote = 'Google Sheets is the shared data source. Offline cache is read-only fallback.';
      window.I18N.en.confirmClear = 'Shared clear is disabled.';
      // The legacy text said citations stay in this browser; they are shared now.
      window.I18N.en.emptyBody = 'In The Permit Store admin, export your citations report as CSV, then drop the file here. Citations are saved to the shared Google Sheet.';
      if (window.I18N.es) window.I18N.es.emptyBody = 'En el admin de The Permit Store, exportá el reporte de citaciones como CSV y soltalo acá. Las citaciones se guardan en el Google Sheet compartido.';
    }
    var sub = document.querySelector('.head-txt p');
    if (sub) sub.textContent = 'iParq / The Permit Store · shared across devices';
  }

  resetViewState();
  installSharedStyles();
  installRefreshButton();
  showMode();
  applyColumnOrder();
  updateRefreshStamp();

  // The service worker replaces legacy index.html refresh() during shared
  // boot and leaves this guarded hand-off marker for the injected runtime.
  // Direct/standalone loads have no marker and still get one reliable boot
  // refresh. Repeated runtime injection cannot start another one.
  var sharedBootPending = window.__PCI_SHARED_BOOT_PENDING__ === true;
  if (sharedBootPending) window.__PCI_SHARED_BOOT_PENDING__ = false;

  // Same session as the last successful read: show that saved copy right
  // away and replace it when the server answers. A different or missing
  // session waits for the server, as before.
  function showSavedCopy(){
    if (!sessionToken || !localAll) return Promise.resolve(false);
    var owner = '';
    try { owner = localStorage.getItem(CACHE_OWNER_KEY) || ''; } catch (_) {}
    if (!owner) return Promise.resolve(false);
    return sessionFingerprint().then(function(fp){
      if (!fp || fp !== owner) return false;
      return localAll().then(function(list){
        if (!list || !list.length || sharedState.source !== 'loading') return false;
        nextRead = { records:list, at:Date.now() };
        sharedState.source = 'cached';
        sharedState.showingCache = true;
        return Promise.resolve(window.refresh()).then(function(){
          applyColumnOrder();
          updateRefreshStamp();
          return true;
        });
      });
    }).catch(function(err){
      nextRead = null;
      console.warn('[Citation Tracker] saved copy unavailable', err);
      return false;
    });
  }

  function bootRefresh(){
    runSharedRefresh().catch(function(err){
      console.error('[Citation Tracker] shared refresh failed', err);
      updateRefreshStamp();
    }).then(function(){ sharedState.showingCache = false; updateRefreshStamp(); });
  }

  if (!window.__PCI_SHARED_BOOT_STARTED__) {
    window.__PCI_SHARED_BOOT_STARTED__ = true;
    // The read is a <script> request, and a script added before the page's
    // load event holds that event back until the Sheet answers. The
    // Supervisor launcher keeps its loading cover up until this frame's load
    // event and gives up after 9s with "Open in browser instead", so the read
    // starts once the page has loaded (or after 3s at the latest).
    // The saved copy is local (IndexedDB) and can show immediately.
    var savedCopy = showSavedCopy();
    var started = false;
    var startRead = function(){
      if (started) return;
      started = true;
      savedCopy.then(bootRefresh, bootRefresh);
    };
    if (document.readyState === 'complete') startRead();
    else {
      window.addEventListener('load', function(){ setTimeout(startRead, 0); }, {once:true});
      setTimeout(startRead, 3000);
    }
  }
})();
