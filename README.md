# PCI Citation Tracker — DEV

Citation Tracker is a PCI Web App for importing **iParq / The Permit Store** citation exports and reviewing shared citation activity.

## Current DEV architecture

`CSV import / Citation Tracker → Apps Script Web App → Google Sheet`

- **Authoritative datastore:** `PCI Citation Tracker - Shared Citations DEV`
- **Apps Script environment:** DEV
- **Unique key:** Citation Number
- **Offline behavior:** IndexedDB is a read-only fallback cache when the shared API cannot be reached.
- **Management and Supervisor:** both launch the same GitHub Pages Citation Tracker and therefore must read the same shared dataset.
- **DEV active deployment:** GitHub Pages from this repository's `main` branch. This does **not** mean PCI Reports PROD; PROD remains a separate construction path in the broader PCI Apps workflow.

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

Imports are upserted by **Citation Number**. After a POST, the frontend performs a readable list request and verifies that the imported citation numbers exist before reporting the import as saved.

## Shared Google Sheet

The primary tab preserves the source report structure used by Apps Script. A second tab, **Citations by Date**, is an automatic view ordered by date and time. It uses actual Sheet date/time values instead of fixed string positions, so morning times such as `07:46:50` remain valid.

## Safety / DEV limitations

- Whole-sheet `clear` is disabled in DEV until an authenticated backend gateway exists.
- The Apps Script deployment must be redeployed after `apps-script/Code.gs` changes before those backend changes become live.
- Do not use a query-string or browser-saved alternate API endpoint. DEV has one authoritative Apps Script URL.

## Files

```text
index.html            Existing dashboard UI and CSV parser
shared-sync.js        Shared Sheet transport, deterministic view state, refresh status, six-column presentation
apps-script/Code.gs   DEV Apps Script backend
sw.js                 PWA cache and authoritative shared boot path
manifest.json         PWA metadata
```

## Development rule

Citation Tracker is being developed as one PCI Web App at a time. Keep DEV and future PROD resources separate. Do not infer that a Git branch named `main` is the broader PCI production environment.
