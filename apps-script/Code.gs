// PCI Citation Tracker — Shared Google Sheets backend (ACTPROD)
// Shared Sheet is authoritative. Deployed as a Web App: execute as the owner,
// access "Anyone" — every data action below still requires a valid
// supervisor session from PCI Supervisor Auth.

const SPREADSHEET_ID = '1OQRGM9m74vRZaSoJf-Q-0ZbhTV18-6HvE0LvfuYCnLw';
const SHEET_NAME = 'ACTPROD - PCI CITATION TRACKER - DATA';
const KEY_HEADER = 'Citation Number';
const ENV = 'ACTPROD';

// Same Supervisor Auth deployment the launchers log in against.
const SUPERVISOR_AUTH_URL = 'https://script.google.com/macros/s/AKfycbxCdFcQGvTDMI34rrJu8HJXr3heRP_CGOr4nTGPePBEIm76_tOavEZaQkFr_z0poxk55Q/exec';
const SESSION_CACHE_SECONDS = 60;
const MAX_RECORDS_PER_IMPORT = 5000;

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || 'list').toLowerCase();
    if (action === 'health') {
      // Public liveness only: no sheet name, no row count.
      return output_({ ok: true, service: 'PCI Citation Tracker', env: ENV, timestamp: new Date().toISOString() }, e);
    }
    const auth = sessionCheck_(params.token);
    if (!auth.ok) return output_({ ok: false, error: 'unauthorized', code: auth.code, env: ENV }, e);
    if (action === 'list') {
      return output_({ ok: true, records: listCitations_(), env: ENV, timestamp: new Date().toISOString() }, e);
    }
    return output_({ ok: false, error: 'Unsupported GET action: ' + action }, e);
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message || err), env: ENV }, e);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const auth = sessionCheck_(body.token);
    if (!auth.ok) return output_({ ok: false, error: 'unauthorized', code: auth.code, env: ENV });
    const action = String(body.action || 'upsert').toLowerCase();
    if (action === 'upsert') {
      const records = Array.isArray(body.records) ? body.records : [];
      if (records.length > MAX_RECORDS_PER_IMPORT) {
        return output_({ ok: false, error: 'Too many records in one import (max ' + MAX_RECORDS_PER_IMPORT + ').', env: ENV });
      }
      const result = upsertCitations_(records);
      return output_({ ok: true, added: result.added, updated: result.updated, total: result.total, env: ENV, timestamp: new Date().toISOString() });
    }
    if (action === 'clear') {
      return output_({ ok: false, error: 'Shared clear is disabled for data protection.', env: ENV });
    }
    return output_({ ok: false, error: 'Unsupported POST action: ' + action, env: ENV });
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message || err), env: ENV });
  }
}

/* ---------------- Supervisor session ----------------
   The launcher passes its Supervisor Auth session token. It is checked with
   Supervisor Auth's own "verify" action and the positive answer is cached
   for a minute (keyed by a hash, never by the token itself).
   Returns {ok, code}; the code is a safe diagnostic (never the token). */
function sessionCheck_(token) {
  const value = String(token || '');
  if (!value) return { ok: false, code: 'TOKEN_MISSING' };
  if (value.length > 2048) return { ok: false, code: 'TOKEN_TOO_LONG' };
  let cache, key;
  try {
    cache = CacheService.getScriptCache();
    key = 'sup-session:' + sha256Hex_(value);
    if (cache.get(key) === 'ok') return { ok: true, code: 'CACHED' };
  } catch (err) {
    Logger.log('Session cache unavailable: ' + (err && err.message || err));
    return { ok: false, code: 'CACHE_ERROR' };
  }
  try {
    const first = UrlFetchApp.fetch(SUPERVISOR_AUTH_URL, {
      method: 'post',
      payload: { action: 'verify', token: value },
      // Apps Script answers POST with a redirect to a GET-only URL.
      followRedirects: false,
      muteHttpExceptions: true
    });
    const headers = first.getHeaders();
    const location = headers.Location || headers.location;
    const res = location ? UrlFetchApp.fetch(location, { method: 'get', muteHttpExceptions: true }) : first;
    if (res.getResponseCode() !== 200) return { ok: false, code: 'AUTH_HTTP_' + res.getResponseCode() };
    let body;
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (_) { return { ok: false, code: 'AUTH_NOT_JSON' }; }
    if (!body || body.ok !== true || !body.username) {
      return { ok: false, code: 'AUTH_' + String(body && body.error || 'INVALID').toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 30) };
    }
    cache.put(key, 'ok', SESSION_CACHE_SECONDS);
    return { ok: true, code: 'VERIFIED' };
  } catch (err) {
    Logger.log('Supervisor session check failed: ' + (err && err.message || err));
    return { ok: false, code: 'AUTH_FETCH_ERROR' };
  }
}

/** Run once from the editor after deploying: it makes the same outbound call
 *  as the session check, so Google asks the owner for the "connect to an
 *  external service" permission the web app needs. Logs the outcome. */
function authorizeSupervisorAuthCheck() {
  const res = UrlFetchApp.fetch(SUPERVISOR_AUTH_URL, { method: 'get', muteHttpExceptions: true });
  Logger.log('Supervisor Auth reachable: HTTP ' + res.getResponseCode());
  return res.getResponseCode();
}

function sha256Hex_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(function (b) { return (b + 256).toString(16).slice(-2); })
    .join('');
}

/* ---------------- Sheet access ---------------- */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Sheet not found: ' + SHEET_NAME);
  return sh;
}

function headers_(sh) {
  const lastCol = sh.getLastColumn();
  if (!lastCol) return [];
  return sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(String);
}

function index_(headers) {
  const out = {};
  headers.forEach(function (h, i) { out[String(h).trim()] = i; });
  return out;
}

function cell_(row, idx, name) {
  const i = idx[name];
  return i == null ? '' : String(row[i] == null ? '' : row[i]).trim();
}

function splitPlate_(value) {
  const s = String(value || '').trim().toUpperCase();
  const m = s.match(/^(.*?)(?:\s+([A-Z]{2}))$/);
  return m ? { plate: m[1].trim(), state: m[2] } : { plate: s, state: '' };
}

function normalizeClock_(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return '';
  return String(m[1]).padStart(2, '0') + ':' + m[2] + ':' + (m[3] || '00');
}

function issueParts_(value) {
  const s = String(value || '').trim();
  // Google Sheets can display 07:46:50 as 7:46:50. Accept one- or two-digit
  // hours and normalize back to HH:mm:ss.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (m) return { date: m[1], time: normalizeClock_(m[2] || '') };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const tz = Session.getScriptTimeZone() || 'America/Los_Angeles';
  return {
    date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    time: Utilities.formatDate(d, tz, 'HH:mm:ss')
  };
}

function money_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()$,\s]/g, ''));
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

function status_(raw, balance) {
  const s = String(raw || '').toLowerCase();
  if (/void|dismiss|cancel|waiv|delete|warn/.test(s)) return 'void';
  if (/appeal|contest|disput|hearing|review/.test(s)) return 'appealed';
  if (/paid|closed|collect|settled|complete/.test(s) && !/unpaid|not paid|partial/.test(s)) return 'paid';
  if (/unpaid|open|outstand|pending|due|owe|balance|new|active/.test(s)) return 'pending';
  return balance != null && balance <= 0.005 ? 'paid' : 'pending';
}

function listCitations_() {
  // Read-only: no lock needed. A read during an import simply sees the sheet
  // before or after that import's single batch of writes.
  const sh = sheet_();
  const headers = headers_(sh);
  if (!headers.length || sh.getLastRow() < 2) return [];
  const idx = index_(headers);
  if (idx[KEY_HEADER] == null) throw new Error('Missing required header: ' + KEY_HEADER);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getDisplayValues();
  return values.map(function (row) { return normalizeRow_(row, idx); }).filter(Boolean);
}

function normalizeRow_(row, idx) {
  const citationNo = unescapeText_(cell_(row, idx, 'Citation Number'));
  if (!citationNo) return null;
  const issued = issueParts_(cell_(row, idx, 'Issue Date & Time'));
  const plateParts = splitPlate_(cell_(row, idx, 'License Plate'));
  const due = money_(cell_(row, idx, 'Original Amount Due'));
  const paid = money_(cell_(row, idx, 'Amount Paid'));
  const balance = money_(cell_(row, idx, 'Current Amount Due'));
  const statusRaw = cell_(row, idx, 'Status');
  return {
    id: citationNo,
    citationNo: citationNo,
    violation: htmlDecode_(cell_(row, idx, 'Violation Type')).replace(/^\s*-\s*/, '').trim(),
    officer: cell_(row, idx, 'Officer Name'),
    lot: cell_(row, idx, 'Location'),
    plate: plateParts.plate,
    state: plateParts.state,
    issueDate: issued.date,
    issueTime: issued.time,
    amountDue: due,
    amountPaid: paid,
    balance: balance,
    statusRaw: statusRaw,
    status: status_(statusRaw, balance),
    make: '', paidDate: '', appealStatus: '', notes: '',
    _shared: true
  };
}

/* A value starting with = + - @ (or a tab/CR) would become a formula in the
   Sheet. Prefixing an apostrophe stores it as plain text; Sheets hides the
   apostrophe in the displayed value. */
function sheetText_(value) {
  const text = value == null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function unescapeText_(value) {
  return String(value || '').replace(/^'/, '');
}

/* Upsert by Citation Number.
   - Only the fields present in the record are written, so importing a CSV
     that lacks a column (e.g. Status) never blanks existing values.
   - Only changed or new rows are written: updated rows in contiguous runs,
     new rows appended in one block. The rest of the sheet is untouched.
   - Every row that repeats the same Citation Number is updated. */
function upsertCitations_(records) {
  return withLock_(function () {
    const sh = sheet_();
    const headers = headers_(sh);
    const idx = index_(headers);
    if (idx[KEY_HEADER] == null) throw new Error('Missing required header: ' + KEY_HEADER);

    const rowCount = Math.max(0, sh.getLastRow() - 1);
    const rows = rowCount ? sh.getRange(2, 1, rowCount, headers.length).getValues() : [];
    const positions = {};
    rows.forEach(function (row, i) {
      const key = unescapeText_(String(row[idx[KEY_HEADER]] == null ? '' : row[idx[KEY_HEADER]]).trim());
      if (!key) return;
      (positions[key] = positions[key] || []).push(i);
    });

    const touched = {};
    const appended = [];
    let added = 0;
    let updated = 0;
    records.forEach(function (rec) {
      if (!rec || typeof rec !== 'object') return;
      const key = String(rec.citationNo || rec.id || '').trim();
      if (!key || key.length > 100) return;
      let targets = positions[key];
      if (!targets) {
        const row = new Array(headers.length).fill('');
        appended.push(row);
        targets = positions[key] = [rows.length + appended.length - 1];
        added++;
      } else {
        updated++;
      }
      targets.forEach(function (pos) {
        const row = pos < rows.length ? rows[pos] : appended[pos - rows.length];
        applyRecord_(row, idx, key, rec);
        if (pos < rows.length) touched[pos] = true;
      });
    });

    // Updated rows: one write per contiguous run. getValues() returns text
    // like '=… without its protecting apostrophe, so every text cell of a
    // rewritten row is protected again before it goes back to the Sheet.
    const protectRow = function (row) {
      return row.map(function (v) { return typeof v === 'string' ? sheetText_(v) : v; });
    };
    const changed = Object.keys(touched).map(Number).sort(function (a, b) { return a - b; });
    for (let i = 0; i < changed.length;) {
      let j = i;
      while (j + 1 < changed.length && changed[j + 1] === changed[j] + 1) j++;
      sh.getRange(changed[i] + 2, 1, j - i + 1, headers.length).setValues(rows.slice(changed[i], changed[j] + 1).map(protectRow));
      i = j + 1;
    }
    if (appended.length) sh.getRange(rows.length + 2, 1, appended.length, headers.length).setValues(appended);
    if (changed.length || appended.length) SpreadsheetApp.flush();
    return { added: added, updated: updated, total: rows.length + appended.length };
  });
}

function has_(rec, field) {
  return Object.prototype.hasOwnProperty.call(rec, field);
}

function applyRecord_(row, idx, key, rec) {
  set_(row, idx, 'Citation Number', sheetText_(key));
  if (has_(rec, 'violation')) set_(row, idx, 'Violation Type', sheetText_(rec.violation));
  if (has_(rec, 'officer')) set_(row, idx, 'Officer Name', sheetText_(rec.officer));
  if (has_(rec, 'lot')) set_(row, idx, 'Location', sheetText_(rec.lot));
  if (has_(rec, 'plate') || has_(rec, 'state')) set_(row, idx, 'License Plate', sheetText_(joinPlate_(rec.plate, rec.state)));
  if (has_(rec, 'issueDate') || has_(rec, 'issueTime')) set_(row, idx, 'Issue Date & Time', sheetText_(joinIssued_(rec.issueDate, rec.issueTime)));
  if (has_(rec, 'statusRaw') || has_(rec, 'status')) set_(row, idx, 'Status', sheetText_(rec.statusRaw || rec.status || ''));
  if (numberOrNull_(rec.amountDue) != null) set_(row, idx, 'Original Amount Due', numberOrNull_(rec.amountDue));
  if (numberOrNull_(rec.amountPaid) != null) set_(row, idx, 'Amount Paid', numberOrNull_(rec.amountPaid));
  if (numberOrNull_(rec.balance) != null) set_(row, idx, 'Current Amount Due', numberOrNull_(rec.balance));
}

function numberOrNull_(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function set_(row, idx, header, value) {
  if (idx[header] != null) row[idx[header]] = value == null ? '' : value;
}

function joinPlate_(plate, state) {
  const p = String(plate || '').trim().toUpperCase();
  const s = String(state || '').trim().toUpperCase();
  return [p, s].filter(Boolean).join(' ');
}

function joinIssued_(date, time) {
  const rawDate = String(date || '').trim();
  const d = (rawDate.match(/\d{4}-\d{2}-\d{2}/) || [rawDate])[0];
  let t = normalizeClock_(time);
  if (!t) {
    const m = rawDate.match(/[ T](\d{1,2}:\d{2}(?::\d{2})?)/);
    if (m) t = normalizeClock_(m[1]);
  }
  return [d, t].filter(Boolean).join(' ');
}

function htmlDecode_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) {}
  const out = {};
  raw.split('&').forEach(function (pair) {
    const p = pair.split('=');
    out[decodeURIComponent(p[0] || '')] = decodeURIComponent((p.slice(1).join('=') || '').replace(/\+/g, ' '));
  });
  if (out.payload) {
    try { return JSON.parse(out.payload); } catch (_) {}
  }
  return out;
}

function output_(obj, e) {
  const json = JSON.stringify(obj);
  const callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- One-time migration (run from the editor) ----------------
   Copies citations that exist in the old DEV sheet but not in ACTPROD.
   Never overwrites a row that ACTPROD already has. Logs how many it added. */
function mergeMissingFromDevSheet() {
  const SOURCE_ID = '1R3VkJ0G40KXsW2IXPMMp-2PV0uR4d--qZs2B6LmUyAw';
  const SOURCE_TAB = 'PCI Citation Tracker - Shared Citations DEV';
  return withLock_(function () {
    const src = SpreadsheetApp.openById(SOURCE_ID).getSheetByName(SOURCE_TAB);
    if (!src) throw new Error('Source tab not found: ' + SOURCE_TAB);
    const dst = sheet_();
    const srcHeaders = headers_(src);
    const dstHeaders = headers_(dst);
    const srcIdx = index_(srcHeaders);
    const dstIdx = index_(dstHeaders);
    if (srcIdx[KEY_HEADER] == null || dstIdx[KEY_HEADER] == null) throw new Error('Missing ' + KEY_HEADER + ' header');

    const have = {};
    if (dst.getLastRow() > 1) {
      dst.getRange(2, dstIdx[KEY_HEADER] + 1, dst.getLastRow() - 1, 1).getValues()
        .forEach(function (r) { const k = unescapeText_(String(r[0] || '').trim()); if (k) have[k] = true; });
    }
    const srcRows = src.getLastRow() > 1 ? src.getRange(2, 1, src.getLastRow() - 1, srcHeaders.length).getValues() : [];
    const out = [];
    srcRows.forEach(function (r) {
      const k = unescapeText_(String(r[srcIdx[KEY_HEADER]] || '').trim());
      if (!k || have[k]) return;
      have[k] = true;
      out.push(dstHeaders.map(function (h) {
        const i = srcIdx[String(h).trim()];
        const v = i == null ? '' : r[i];
        return typeof v === 'string' ? sheetText_(v) : v;
      }));
    });
    if (out.length) dst.getRange(dst.getLastRow() + 1, 1, out.length, dstHeaders.length).setValues(out);
    Logger.log('mergeMissingFromDevSheet: ' + out.length + ' citation(s) copied from DEV; ' + srcRows.length + ' checked.');
    return out.length;
  });
}
