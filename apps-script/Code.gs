// PCI Citation Tracker — Shared Google Sheets backend (DEV)
// Deploy as a Google Apps Script Web App: Execute as Me, access allowed for the intended PCI users.

const SPREADSHEET_ID = '1R3VkJ0G40KXsW2IXPMMp-2PV0uR4d--qZs2B6LmUyAw';
const SHEET_NAME = 'PCI Citation Tracker - Shared Citations DEV';
const KEY_HEADER = 'Citation Number';

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'list').toLowerCase();
    let payload;
    if (action === 'health') {
      payload = { ok: true, service: 'PCI Citation Tracker', env: 'DEV', timestamp: new Date().toISOString() };
    } else {
      payload = { ok: true, records: listCitations_(), timestamp: new Date().toISOString() };
    }
    return output_(payload, e);
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message || err) }, e);
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || 'upsert').toLowerCase();
    if (action === 'upsert') {
      const result = upsertCitations_(Array.isArray(body.records) ? body.records : []);
      return output_({ ok: true, added: result.added, updated: result.updated });
    }
    if (action === 'clear') {
      clearCitations_();
      return output_({ ok: true, cleared: true });
    }
    return output_({ ok: false, error: 'Unsupported action' });
  } catch (err) {
    return output_({ ok: false, error: String(err && err.message || err) });
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

function issueParts_(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (m) return { date: m[1], time: m[2] || '' };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  return {
    date: Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Los_Angeles', 'yyyy-MM-dd'),
    time: Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Los_Angeles', 'HH:mm:ss')
  };
}

function money_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  const n = Number(s.replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
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
  const sh = sheet_();
  const headers = headers_(sh);
  if (!headers.length || sh.getLastRow() < 2) return [];
  const idx = index_(headers);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getDisplayValues();
  return values.map(row => {
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
  }).filter(Boolean);
}

function upsertCitations_(records) {
  if (!records.length) return { added: 0, updated: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = sheet_();
    const headers = headers_(sh);
    const idx = index_(headers);
    if (idx[KEY_HEADER] == null) throw new Error('Missing required header: ' + KEY_HEADER);

    const existing = {};
    if (sh.getLastRow() >= 2) {
      const keys = sh.getRange(2, idx[KEY_HEADER] + 1, sh.getLastRow() - 1, 1).getDisplayValues();
      keys.forEach((r, i) => { const k = String(r[0] || '').trim(); if (k) existing[k] = i + 2; });
    }

    let added = 0, updated = 0;
    records.forEach(rec => {
      const key = String(rec.citationNo || rec.id || '').trim();
      if (!key) return;
      const rowNumber = existing[key] || (sh.getLastRow() + 1);
      const row = rowNumber <= sh.getLastRow()
        ? sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0]
        : new Array(headers.length).fill('');

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

      sh.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
      if (existing[key]) updated++; else { added++; existing[key] = rowNumber; }
    });
    return { added, updated };
  } finally {
    lock.releaseLock();
  }
}

function clearCitations_() {
  const sh = sheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
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
  const d = String(date || '').trim();
  const t = String(time || '').trim();
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
