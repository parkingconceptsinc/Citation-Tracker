# PCI Citation Tracker

A **100% client-side** PWA that turns a citation export from **iParq / The Permit
Store** (`admin.thepermitstore.com`) into a dashboard: totals, collected vs
outstanding, by lot, by officer, by status, a 30-day trend and a searchable
table. It also re-exports the current view as CSV.

**Nothing leaves the browser.** Imported citations are stored in **IndexedDB**
on the device; the column mapping and preferences are in `localStorage`. There is
no backend, no Google Sheet, no account.

---

## Using it

1. In **The Permit Store admin**, run your citations report and **export as CSV**
   (Excel/XLSX: use *Save As → CSV* first).
2. Open the app, **drop the CSV** on the box (or tap to choose).
3. **First import only** — the column mapper opens. Match each field to a column
   from your file. Only **Citation #** and **Issue date** are required. It tries
   to auto-match by header name; fix anything it got wrong and press **Import**.
   The mapping is saved and re-used automatically on the next import (as long as
   the same headers are present — otherwise the mapper reopens).
4. Re-import whenever you have a fresh export. Rows are merged (upserted) by
   **Citation #**, so paid/appealed status updates in place and nothing
   duplicates.

**Data menu** (gear icon): import, re-map columns, export **all** data as CSV,
or clear everything (irreversible — export first).

### Canonical fields

`citationNo`* · `issueDate`* · `issueTime` · `lot` · `officer` · `plate` ·
`state` · `make` · `violation` · `amountDue` · `amountPaid` · `balance` ·
`status` · `paidDate` · `appealStatus` · `notes`   *(\* required)*

- **Money** columns tolerate `$`, `,`, spaces and `(...)` for negatives.
- **Dates** accept `YYYY-MM-DD`, US `M/D/YYYY`, `M/D/YY`, `7-Mar-2024`,
  `Mar 7, 2024`. Unparseable dates are kept but excluded from date ranges
  (shown as "Undated").
- **Status** is normalised to `paid` / `pending` / `appealed` / `void` by
  keyword; the original text is shown on the pill and kept in `statusRaw`.
  If there's no status column, `balance` (or `amountDue − amountPaid`) decides
  paid vs pending.

---

## Files

```
index.html      whole app (inline CSS + JS, no dependencies)
manifest.json   PWA manifest
sw.js           service worker (offline shell; bump CACHE_NAME to ship an update)
assets/logo.png
icons/          192 / 512, plain + maskable
```

CSV parsing, the dashboard, IndexedDB access and a minimal chart are all inline
in `index.html` — no libraries. i18n: EN / ES / AR / AR-EG. Dark mode toggle is
persisted. Respects `prefers-reduced-motion`.

## Deploy

Static host (GitHub Pages like the other PCI apps). Push to a repo, enable
Pages on the default branch, done — it works offline after first load.

To add it to the launchers (Pci-Employee / Pci-Supervisor / Management app),
add a tool entry pointing at the Pages URL. The launchers' CSP already allows
`https://parkingconceptsinc.github.io` as a frame source, and the app opens in
their in-page iframe with no cross-origin calls.

## Not in scope

- No writing back to iParq (no public API wired up).
- No `.xlsx` parsing — export CSV from The Permit Store or Excel.
- Data is per-device. For a shared history, each supervisor imports their own
  export, or switch to an Apps Script + Sheet backend later.
