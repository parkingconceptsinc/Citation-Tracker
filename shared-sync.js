/* PCI Citation Tracker — shared-sheet sync layer (DEV)
 * Loaded by the DEV service worker. The existing dashboard remains intact;
 * only persistence and the citation table presentation are overridden.
 */
(function(){
  'use strict';

  var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxYPk_6fS7mM_jIHQEtTJjWUEhQF4ZZ4XwHMtLfjv7mLuFyrYGan_RSveLFDnymAVY/exec';
  var API_URL = DEFAULT_API_URL;

  // Optional one-time bootstrap: open the app with ?citationApi=<encoded /exec URL>.
  // The URL is saved locally so DEV can be tested without another code commit.
  try {
    var p = new URLSearchParams(location.search);
    var supplied = p.get('citationApi');
    if (supplied && /^https:\/\/script\.google\.com\/macros\/s\//i.test(supplied)) {
      localStorage.setItem('pci-citation-api-url', supplied);
      API_URL = supplied;
    } else {
      API_URL = localStorage.getItem('pci-citation-api-url') || DEFAULT_API_URL;
    }
  } catch (_) {}

  var localAll = window.idbAll;
  var localPut = window.idbBulkPut;
  var localClear = window.idbClear;
  var originalRender = window.render;

  function configured(){ return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?|$)/i.test(API_URL); }

  function jsonp(params){
    return new Promise(function(resolve, reject){
      if (!configured()) return reject(new Error('Shared Citation API is not configured'));
      var cb = '__pciCitationCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      var s = document.createElement('script');
      var timer;
      function cleanup(){
        clearTimeout(timer);
        try { delete window[cb]; } catch (_) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function(data){ cleanup(); data && data.ok === false ? reject(new Error(data.error || 'Citation API error')) : resolve(data || {}); };
      params = params || {};
      params.callback = cb;
      params._ = Date.now();
      var q = Object.keys(params).map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
      s.src = API_URL + (API_URL.indexOf('?') >= 0 ? '&' : '?') + q;
      s.onerror = function(){ cleanup(); reject(new Error('Could not reach shared Citation API')); };
      timer = setTimeout(function(){ cleanup(); reject(new Error('Shared Citation API timed out')); }, 15000);
      document.head.appendChild(s);
    });
  }

  function post(payload){
    if (!configured()) return Promise.reject(new Error('Shared Citation API is not configured'));
    // text/plain is a CORS-simple request. Apps Script receives it in e.postData.contents.
    return fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload)
    });
  }

  function cacheShared(records){
    if (!localClear || !localPut) return Promise.resolve();
    return localClear().then(function(){ return records.length ? localPut(records) : undefined; }).catch(function(){});
  }

  // Shared Sheet is authoritative. IndexedDB becomes offline cache only.
  window.idbAll = function(){
    if (!configured()) return localAll();
    return jsonp({ action:'list' }).then(function(data){
      var records = Array.isArray(data.records) ? data.records : [];
      cacheShared(records);
      return records;
    }).catch(function(err){
      console.warn('[Citation Tracker] shared read failed; using offline cache', err);
      return localAll();
    });
  };

  window.idbBulkPut = function(records){
    records = Array.isArray(records) ? records : [];
    if (!configured()) return localPut(records);
    return post({ action:'upsert', records:records }).then(function(){
      return localPut(records).catch(function(){});
    });
  };

  window.idbClear = function(){
    if (!configured()) return localClear();
    return post({ action:'clear' }).then(function(){ return localClear(); });
  };

  // Requested dashboard display order — this is the only citation row layout
  // that should be visible to users in DEV.
  // Original indexes: 0 Citation, 1 Date, 2 Lot, 3 Officer, 4 Plate,
  // 5 Violation, 6 Due, 7 Paid, 8 Status.
  var COLUMN_ORDER = [5, 3, 0, 2, 4, 1];
  var LABELS = ['Violation Type','Officer Name','Citation Number','Location','License Plate','Issued Date'];

  function installSharedStyles(){
    if (document.getElementById('pci-shared-dashboard-style')) return;
    var style = document.createElement('style');
    style.id = 'pci-shared-dashboard-style';
    style.textContent =
      '#tbl thead th{position:sticky;top:0;z-index:2;background:var(--surface);border-top:3px solid var(--navy);border-bottom:2px solid var(--line);}' +
      '#tbl thead th:first-child{border-top-left-radius:6px;}' +
      '#tbl thead th:last-child{border-top-right-radius:6px;}' +
      '#sharedRefreshBtn[data-busy="1"]{opacity:.65;cursor:progress;}' +
      '#sharedRefreshStamp{font-size:11px;color:var(--ink-faint);white-space:nowrap;}' +
      '@media(max-width:620px){#sharedRefreshStamp{display:none;}}';
    document.head.appendChild(style);
  }

  function applyColumnOrder(){
    var table = document.getElementById('tbl');
    if (!table) return;

    var headRow = table.querySelector('thead tr');
    if (headRow) {
      var heads = Array.prototype.slice.call(headRow.children);

      // First pass starts with the original 9-column dashboard. Move the six
      // requested headers into their exact order, then remove the rest while
      // preserving the original click/sort listeners attached by index.html.
      if (heads.length === 9) {
        COLUMN_ORDER.forEach(function(i, n){
          if (!heads[i]) return;
          heads[i].textContent = LABELS[n];
          heads[i].removeAttribute('data-i18n');
          headRow.appendChild(heads[i]);
        });
        heads.forEach(function(th, i){
          if (COLUMN_ORDER.indexOf(i) < 0) th.remove();
        });
      } else if (heads.length === 6) {
        heads.forEach(function(th, n){
          th.textContent = LABELS[n];
          th.removeAttribute('data-i18n');
        });
      }
      headRow.dataset.sharedOrder = '1';
    }

    var rows = table.querySelectorAll('tbody tr');
    Array.prototype.forEach.call(rows, function(tr){
      // Normal rendered record row from index.html.
      if (tr.children.length === 9) {
        var cells = Array.prototype.slice.call(tr.children);
        COLUMN_ORDER.forEach(function(i){ if (cells[i]) tr.appendChild(cells[i]); });
        cells.forEach(function(td, i){ if (COLUMN_ORDER.indexOf(i) < 0) td.remove(); });
      }

      // Original empty-state row spans nine columns; dashboard now has six.
      if (tr.children.length === 1 && tr.children[0].hasAttribute('colspan')) {
        tr.children[0].setAttribute('colspan', '6');
      }
    });
  }

  function updateRefreshStamp(){
    var stamp = document.getElementById('sharedRefreshStamp');
    if (stamp) stamp.textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
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
      updateRefreshStamp();
    }).catch(function(err){
      console.error('[Citation Tracker] refresh failed', err);
      if (typeof window.toast === 'function') window.toast('Refresh failed');
      throw err;
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
    stamp.textContent = 'Shared data';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn sm';
    btn.id = 'sharedRefreshBtn';
    btn.textContent = '↻ Refresh';
    btn.title = 'Reload citations from the shared Google Sheet';
    btn.addEventListener('click', function(){ runSharedRefresh().catch(function(){}); });

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
    if (window.I18N && I18N.en) {
      I18N.en.appSub = configured()
        ? 'iParq / The Permit Store · shared across devices'
        : 'DEV · shared Google Sheet connection pending';
      I18N.en.manageNote = configured()
        ? 'Shared data is stored in Google Sheets and is visible on every connected device.'
        : 'DEV is ready for shared storage; deploy the Apps Script backend and configure its /exec URL.';
      I18N.en.confirmClear = 'Delete ALL shared citations for EVERY connected device?';
    }
    var sub = document.querySelector('.head-txt p');
    if (sub) sub.textContent = configured() ? 'iParq / The Permit Store · shared across devices' : 'DEV · shared Google Sheet connection pending';
  }

  installSharedStyles();
  installRefreshButton();
  showMode();
  applyColumnOrder();

  // The original boot already performed one local refresh before this file loaded.
  // Run it again now through the shared backend, or through the offline cache if not configured.
  runSharedRefresh().catch(function(err){ console.error(err); });
})();
