# Scope — Citation Tracker design audit (2026-09-10)

## Surface

- `Z:/PCI APPs/apps/Citation-Tracker/index.html` — primary PWA dashboard, empty/import state, dashboard, filters, table, modals, and toast.
- `Z:/PCI APPs/apps/Citation-Tracker/shared-sync.js` — shared-data refresh, offline status, injected refresh control, and injected table line.
- `Z:/PCI APPs/apps/Citation-Tracker/shared-ui.js` — DEV data-management guard.
- `Z:/PCI APPs/apps/Citation-Tracker/sw.js` — service-worker cache/update behavior.

## Primary user and task

PCI operations staff import an iParq / The Permit Store CSV or TSV, map columns when needed, review citation totals and records, filter the data, and export a view. The data is shared through the DEV Apps Script API with IndexedDB as a visible offline fallback.

## Constraints and references

- Existing PCI system: `Fraunces` for headings, `Inter` for UI, navy/blue/violet/green/cyan/amber/red functional signals, responsive PWA, English/Spanish/Arabic copy, and light/dark theme.
- This is a source audit. Exact browser computed styles, runtime network timings, and accessibility-tree details were not captured; those findings are marked inferred.
- No files were modified by this audit.

