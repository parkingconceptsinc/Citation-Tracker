// PCI Citation Tracker — Shared Google Sheets backend (DEV)
// Shared Sheet is authoritative. Deploy this file as the DEV Apps Script Web App.

const SPREADSHEET_ID = '1R3VkJ0G40KXsW2IXPMMp-2PV0uR4d--qZs2B6LmUyAw';
const SHEET_NAME = 'PCI Citation Tracker - Shared Citations DEV';
const KEY_HEADER = 'Citation Number';
const ENV = 'DEV';

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'list').toLowerCase();
    if (action === 'health') {
      const ready = readiness_();
      return output_({
        ok: true,
        service: 'PCI Citation Tracker',
        env: ENV,
        sheet: ready.sheet,
        rows: ready.rows,
        timestamp: new Date().toISOString()
      }, e);
    }
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
    const action = String(body.action || 'upsert').toLowerCase();
    if (action === 'upsert') {
      const result = upsertCitations_(Array.isArray(body.records) ? body.records : []);
      return output_({ ok: true, added: result.added, updated: result.updated, total: result.total, env: ENV, timestamp: new Date().toISOString() });
    }
    if (action === 'clear') {
      // Whole-sheet deletion is intentionally disabled while this DEV Web App
      // is reachable without an authenticated gateway.
      return output_({ ok: false, error: 'Shared clear is disabled in DEV for data protection.', env: ENV });
    }
    return output_({ ok: false, error: 'Unsupported POST action: ' + action, env: ENV });
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message || err), env: ENV });
  }
}

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

function readiness_() {
  return withLock_(function(){
    const sh = sheet_();
    const headers = headers_(sh);
    const idx = index_(headers);
    if (!headers.length) throw new Error('Sheet has no headers');
    if (idx[KEY_HEADER] == null) throw new Error('Missing required header: ' + KEY_HEADER);
    return { sheet: sh.getName(), rows: Math.max(0, sh.getLastRow() - 1) };
  });
}

function index_(headers) {
  const out = {};
  headers.forEach((h, i) => { out[String(h).trim()] = i; });
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
  return withLock_(function(){
    const sh = sheet_();
    const headers = headers_(sh);
    if (!headers.length || sh.getLastRow() < 2) return [];
    const idx = index_(headers);
    if (idx[KEY_HEADER] == null) throw new Error('Missing required header: ' + KEY_HEADER);
    const values = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getDisplayValues();
    return values.map(row => normalizeRow_(row, idx)).filter(Boolean);
  });
}

function normalizeRow_(row, idx) {
  const citationNo = cell_(row, idx, 'Citation Number');
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

function upsertCitations_(records) {
  if (!records.length) return { added: 0, updated: 0, total: readiness_().rows };
  return withLock_(function(){
    const sh = sheet_();
    const headers = headers_(sh);
    const idx = index_(headers);
    if (idx[KEY_HEADER] == null) throw new Error('Missing required header: ' + KEY_HEADER);

    const rowCount = Math.max(0, sh.getLastRow() - 1);
    const rows = rowCount ? sh.getRange(2, 1, rowCount, headers.length).getValues() : [];
    const existing = {};
    rows.forEach((row, i) => {
      const key = String(row[idx[KEY_HEADER]] == null ? '' : row[idx[KEY_HEADER]]).trim();
      if (key && existing[key] == null) existing[key] = i;
    });

    let added = 0;
    let updated = 0;
    records.forEach(rec => {
      const key = String(rec.citationNo || rec.id || '').trim();
      if (!key) return;
      let pos = existing[key];
      if (pos == null) {
        pos = rows.length;
        existing[key] = pos;
        rows.push(new Array(headers.length).fill(''));
        added++;
      } else {
        updated++;
      }
      const row = rows[pos];
      set_(row, idx, 'Violation Type', rec.violation || '');
      set_(row, idx, 'Officer Name', rec.officer || '');
      set_(row, idx, 'Location', rec.lot || '');
      set_(row, idx, 'Citation Number', key);
      set_(row, idx, 'License Plate', joinPlate_(rec.plate, rec.state));
      set_(row, idx, 'Issue Date & Time', joinIssued_(rec.issueDate, rec.issueTime));
      set_(row, idx, 'Status', rec.statusRaw || rec.status || '');
      if (rec.amountDue != null) set_(row, idx, 'Original Amount Due', rec.amountDue);
      if (rec.amountPaid != null) set_(row, idx, 'Amount Paid', rec.amountPaid);
      if (rec.balance != null) set_(row, idx, 'Current Amount Due', rec.balance);
    });

    if (rows.length) {
      sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
      SpreadsheetApp.flush();
    }
    return { added: added, updated: updated, total: rows.length };
  });
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
  raw.split('&').forEach(pair => {
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
