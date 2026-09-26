# PCI Citation Tracker — ACTPROD

Citation Tracker is a PCI Web App for importing **iParq / The Permit Store** citation exports and reviewing shared citation activity.

## Architecture (ACTPROD)

`Supervisor launcher (session) → Citation Tracker → Apps Script Web App → Google Sheet`

- **Authoritative datastore:** `ACTPROD - PCI CITATION TRACKER - DATA` (`1OQRGM9m74vRZaSoJf-Q-0ZbhTV18-6HvE0LvfuYCnLw`)
- **Apps Script:** project `1fA2uDKLDG3oOroMd3JkwjCi4MaEwzGuNtz-0uMW8k0ZuW6GwWQn5V45P`, deployment `AKfycbzWtAKS…` (owner `pcireportsstadium@gmail.com`)
- **Access:** every read and import needs the Supervisor Auth session. The Pci-Supervisor and Management launchers open this site with `?token=`; the page keeps it for the tab (sessionStorage) and removes it from the address bar. Without a valid session the page shows no data and clears its offline copy.
- **Publishing:** only this folder is connected to GitHub. The `Citation-Tracker` DEV copy has no remote on purpose.
- **Unique key:** Citation Number
- **Offline behavior:** IndexedDB is a read-only fallback cache when the shared API cannot be reached.
- **Management and Supervisor:** both launch the same GitHub Pages Citation Tracker and therefore must read the same shared dataset.
- **Live site:** GitHub Pages from this repository's `main` branch. This is ACTPROD, not the future PCI Reports PROD.

## Dashboard record order

The user-facing citation table is intentionally limited to:

1. Violation Type
2. Officer Name
3. Citation Number
4. Location
5. License Plate
6. Issued Date

A hazard stripe marks the shared records table. The **Refresh** button explicitly reports either a successful shared-Sheet read or an **OFFLINE CACHE** fallback.

## Import behavior

The source CSV includes a combined `Issue Date & Time` field. DEV reuses that source for both canonical fields and normalizes it into:

- `issueDate` → `YYYY-MM-DD`
- `issueTime` → `HH:mm:ss`

Imports are upserted by **Citation Number**. Only the columns present in the CSV are written, so a partial CSV never blanks existing values. Text that starts with `=`, `+`, `-` or `@` is stored as text (never as a formula), both in the Sheet and in CSV exports. After a POST, the frontend performs a readable list request and verifies that the imported citation numbers exist before reporting the import as saved.

## Shared Google Sheet

The primary tab preserves the source report structure used by Apps Script. A second tab, **Citations by Date**, is an automatic view ordered by date and time. It uses actual Sheet date/time values instead of fixed string positions, so morning times such as `07:46:50` remain valid.

## Safety

- Whole-sheet `clear` is disabled.
- One-time migration: `mergeMissingFromDevSheet()` (run from the Apps Script editor) copies citations that exist only in the old DEV sheet; it never overwrites.
- The Apps Script deployment must be redeployed after `apps-script/Code.gs` changes before those backend changes become live.
- Do not use a query-string or browser-saved alternate API endpoint. There is one authoritative Apps Script URL.

## Files

```text
index.html            Existing dashboard UI and CSV parser
shared-sync.js        Shared Sheet transport, deterministic view state, refresh status, six-column presentation
apps-script/Code.gs   ACTPROD Apps Script backend
sw.js                 PWA cache and authoritative shared boot path
manifest.json         PWA metadata
```

## Development rule

Citation Tracker is being developed as one PCI Web App at a time. Keep DEV and future PROD resources separate. Do not infer that a Git branch named `main` is the broader PCI production environment.
