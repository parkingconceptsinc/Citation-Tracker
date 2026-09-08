/* PCI Citation Tracker — shared Google Sheet sync layer (DEV)
 * One authoritative backend for Management and Supervisor.
 * IndexedDB is used only as a visible offline read cache.
 */
(function(){
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbzWtAKS2m7Wye8glheRN70FnUhbKgTHbhip9bFSv3rmwuA1MUQ1acb5NX65vVRNg0AF/exec';
  var localAll = window.idbAll;
  var localPut = window.idbBulkPut;
  var localClear = window.idbClear;
  var originalRender = window.render;
  var originalCommitImport = window.commitImport;
  var sharedState = { source:'boot', error:'', lastSync:null };

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
        if (data && data.ok === false) return reject(new Error(data.error || 'Citation API error'));
        resolve(data || {});
      };
      params = params || {};
      params.callback = cb;
      params._ = Date.now();
      var q = Object.keys(params).map(function(k){
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      s.src = API_URL + '?' + q;
      s.onerror = function(){ cleanup(); reject(new Error('Could not reach shared Citation API')); };
      timer = setTimeout(function(){ cleanup(); reject(new Error('Shared Citation API timed out')); }, 15000);
      document.head.appendChild(s);
    });
  }

  function post(payload){
    return fetch(API_URL, {
      method:'POST',
      mode:'no-cors',
      cache:'no-store',
      headers:{ 'Content-Type':'text/plain;charset=UTF-8' },
      body:JSON.stringify(payload)
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
    return jsonp({action:'list'}).then(function(data){
      var records = Array.isArray(data.records) ? data.records : [];
      setSharedState('shared');
      cacheShared(records);
      return records;
    }).catch(function(err){
      setSharedState('offline', err);
      console.warn('[Citation Tracker] shared read failed; showing offline cache', err);
      return localAll ? localAll() : [];
    });
  };

  // POST is no-cors because of Apps Script. Verify every write with a
  // subsequent readable list response before treating the import as saved.
  window.idbBulkPut = function(records){
    records = (Array.isArray(records) ? records : []).map(normalizeForWrite);
    if (!records.length) return Promise.resolve();
    var expected = {};
    records.forEach(function(r){
      var k = String(r.citationNo || r.id || '').trim();
      if (k) expected[k] = true;
    });
    return post({action:'upsert', records:records}).then(function(){
      return jsonp({action:'list'});
    }).then(function(data){
      var server = Array.isArray(data.records) ? data.records : [];
      var seen = {};
      server.forEach(function(r){ seen[String(r.citationNo || r.id || '').trim()] = true; });
      var missing = Object.keys(expected).filter(function(k){ return !seen[k]; });
      if (missing.length) throw new Error('Shared write could not be verified for ' + missing.length + ' citation(s)');
      setSharedState('shared');
      return cacheShared(server);
    }).catch(function(err){
      setSharedState('offline', err);
      throw err;
    });
  };

  // Destructive shared clear is disabled until the production auth gateway
  // exists. This prevents an unauthenticated /exec caller from wiping DEV.
  window.idbClear = function(){
    return Promise.reject(new Error('Shared clear is disabled in DEV for data protection.'));
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
      '#sharedHazardLine{height:7px;width:100%;border-radius:5px 5px 0 0;background:repeating-linear-gradient(45deg,#f2a900 0 12px,#111 12px 24px);background-size:200% 100%;}' +
      '#sharedRefreshBtn[data-busy="1"]{opacity:.65;cursor:progress;}' +
      '#sharedRefreshStamp{font-size:11px;color:var(--ink-faint);white-space:nowrap;}' +
      '#sharedRefreshStamp[data-source="shared"]{color:var(--green);font-weight:700;}' +
      '#sharedRefreshStamp[data-source="offline"]{color:var(--danger);font-weight:800;}' +
      '@media(max-width:620px){#sharedRefreshStamp{display:none;}}';
    document.head.appendChild(style);
  }

  function installHazardLine(){
    if (document.getElementById('sharedHazardLine')) return;
    var table = document.getElementById('tbl');
    if (!table || !table.parentNode) return;
    var line = document.createElement('div');
    line.id = 'sharedHazardLine';
    line.setAttribute('aria-hidden','true');
    table.parentNode.insertBefore(line, table);
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

  function updateRefreshStamp(){
    var stamp = document.getElementById('sharedRefreshStamp');
    if (!stamp) return;
    var when = sharedState.lastSync ? sharedState.lastSync.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    stamp.dataset.source = sharedState.source;
    if (sharedState.source === 'shared') {
      stamp.textContent = 'Shared · Updated ' + when;
      stamp.title = 'Loaded from the shared Google Sheet';
    } else if (sharedState.source === 'offline') {
      stamp.textContent = 'OFFLINE CACHE · ' + when;
      stamp.title = sharedState.error || 'Shared Sheet unavailable';
    } else {
      stamp.textContent = 'Connecting…';
    }
  }

  function runSharedRefresh(){
    var btn = document.getElementById('sharedRefreshBtn');
    if (btn && btn.dataset.busy === '1') return Promise.resolve();
    if (btn) {
      btn.dataset.busy = '1';
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
    }
    var work = typeof window.refresh === 'function' ? window.refresh() : Promise.resolve();
    return Promise.resolve(work).then(function(){
      applyColumnOrder();
      installHazardLine();
      updateRefreshStamp();
      if (sharedState.source === 'offline' && typeof window.toast === 'function') {
        window.toast('Shared Sheet unavailable — showing offline cache');
      }
    }).finally(function(){
      if (btn) {
        btn.dataset.busy = '0';
        btn.disabled = false;
        btn.textContent = '↻ Refresh';
      }
    });
  }

  function installRefreshButton(){
    if (document.getElementById('sharedRefreshBtn')) return;
    var exportBtn = document.getElementById('exportBtn');
    if (!exportBtn || !exportBtn.parentNode) return;
    var stamp = document.createElement('span');
    stamp.id = 'sharedRefreshStamp';
    stamp.textContent = 'Connecting…';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn sm';
    btn.id = 'sharedRefreshBtn';
    btn.textContent = '↻ Refresh';
    btn.title = 'Reload citations from the shared Google Sheet';
    btn.addEventListener('click', function(){ runSharedRefresh().catch(function(err){
      if (typeof window.toast === 'function') window.toast(String(err && err.message || err));
    }); });
    exportBtn.parentNode.insertBefore(stamp, exportBtn);
    exportBtn.parentNode.insertBefore(btn, exportBtn);
  }

  if (typeof originalRender === 'function') {
    window.render = function(){
      var result = originalRender.apply(this, arguments);
      applyColumnOrder();
      installHazardLine();
      return result;
    };
  }

  function showMode(){
    if (window.I18N && window.I18N.en) {
      window.I18N.en.appSub = 'iParq / The Permit Store · shared across devices';
      window.I18N.en.manageNote = 'Google Sheets is the shared DEV data source. Offline cache is read-only fallback.';
      window.I18N.en.confirmClear = 'Shared clear is disabled in DEV.';
    }
    var sub = document.querySelector('.head-txt p');
    if (sub) sub.textContent = 'iParq / The Permit Store · shared across devices';
  }

  resetViewState();
  installSharedStyles();
  installRefreshButton();
  installHazardLine();
  showMode();
  applyColumnOrder();
  runSharedRefresh().catch(function(err){
    console.error('[Citation Tracker] shared refresh failed', err);
    updateRefreshStamp();
  });
})();
