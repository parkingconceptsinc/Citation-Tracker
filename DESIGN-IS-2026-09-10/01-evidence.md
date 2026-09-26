# Evidence

## Structural evidence

- Static interactive-element count: **32** in `index.html` (`button`, `input`, and `select` tags; hidden language controls included, dynamically generated markup excluded). Primary controls are at `index.html:266-277`, filters at `:310-327`, export/pagination at `:356-378`, and modal controls at `:389-422`.
- Primary component nesting is moderate: shell → header/sections → cards → controls; deepest visible form control path is approximately 6 levels, inferred from `index.html:257-427`.
- Repeated affordances: 4 range buttons (`index.html:309-314`), 3 data-management modal actions (`:412-417`), 2 modal close actions (`:389`, `:407`), 2 pagination controls (`:376-378`), 5 KPI cards (`:299-305`), and repeated filter controls (`:315-327`).
- No imported modules are present in `index.html`; external behavior is in `shared-sync.js` and `shared-ui.js`. No dead imports were found.
- The same visual concern is implemented twice: the table line is styled/injected in `shared-sync.js:187-204`, while the base page owns the table/card system in `index.html:115-199`. This creates a cross-file drift point.

## Visual evidence (static-source inference)

- Spacing values observed: 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 44, 46px. Evidence: `index.html:49-50`, `:115-145`, `:148-175`, `:207-225`.
- Type values observed: 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 15, 17, 19, 20, 22px. Evidence: `index.html:79-86`, `:118-128`, `:135-145`, `:151-168`, `:193-225`.
- Distinct semantic color custom-properties: **17**; distinct literal CSS color tokens including hex/rgb/rgba: **64** across `index.html`. The principal palette is defined at `index.html:26-35` and dark mode at `:36-42`.
- Inferred contrast: `--ink:#0E163B` on `--surface:#FFFFFF` is strong; `--ink-soft:#5B6478` is likely AA-safe for normal text; `--ink-faint:#98A2B8` is likely below AA for small text. Dark-mode `--ink-faint:#6B7488` is also borderline for small text. Exact rendered ratios require browser measurement.
- The base UI uses a calm blue/violet/green/cyan/amber status system (`index.html:20-24`, `:147-159`, `:178-182`), but the shared table line injects amber/black hazard striping at `shared-sync.js:188`. This is a direct visual inconsistency with the PCI blue-line convention used elsewhere.
- The page includes large decorative radial gradients in light mode at `index.html:52-56`, plus gradient primary buttons at `:141-142` and gradient data bars at `:179-182`. These are intentional but increase visual vocabulary.

## State checklist

- Empty: **present** — import/drop zone at `index.html:285-294`.
- Loading: **partial** — import toast and shared refresh status at `index.html:780`, `shared-sync.js:240-268`; no dedicated skeleton/progress state.
- Error: **present** — invalid CSV/no rows toasts at `index.html:785-796`, shared API error/fallback at `shared-sync.js:92-103`.
- Success: **present** — import/export toasts at `index.html:905-906`, `:1110-1113`; shared status at `shared-sync.js:242-248`.
- Focus: **missing in CSS** — no `:focus` or `:focus-visible` selector was found in `index.html`; controls are defined at `index.html:135-145`, `:163-168`, `:221-225`.
- Disabled: **partial** — pagination gets disabled at `index.html:1048-1049`; shared refresh and clear actions are disabled in `shared-sync.js:256-260`, `:14-21` of `shared-ui.js`.
- Reduced motion: **present** at `index.html:239-244`, but the initial shell animation and status pulse are not visibly paired with a documented motion contract.

## Copy and honesty evidence

- Primary copy accurately names the source and behavior: “iParq / The Permit Store exports · on this device” at `index.html:261-262`, and “Everything stays in this browser” at `:289`.
- Shared-data copy is honest about DEV and offline fallback: `shared-sync.js:311-312` and `:246-248`.
- No marketing inflation, fake scarcity, forced continuity, or confirmshaming was found.
- “Data” is ambiguous for the gear action at `index.html:277`; a clearer label would be “Manage data” or “Data settings”.
- “Clear all data” at `index.html:417` is behaviorally guarded/disabled in DEV by `shared-ui.js:13-21`, which is honest but needs a visible explanation close to the disabled action.
- “Import” appears both as CSV import and as the map-apply action (`index.html:397`, `:412`); the behaviors differ, so “Apply mapping” would be clearer for the mapper.

## Weight and friction evidence

- Local source sizes: `index.html` 69,792 bytes; `shared-sync.js` 13,829 bytes; `shared-ui.js` 1,108 bytes; `sw.js` 4,083 bytes. Initial source payload is approximately **88,812 bytes** before font/image transfer.
- External resource references: Google Fonts and preconnects are declared at `index.html:16-20`; application JS is inline plus `shared-sync.js` and `shared-ui.js` loaded by the service-worker injection path at `sw.js:25-43`. Exact request count depends on controlled/uncontrolled service-worker state.
- Time-to-interactive was not measured in a browser. The design performs IndexedDB setup, shared refresh, DOM patching, column reordering, and status installation during startup (`shared-sync.js:321-325`); this is an estimated friction point, not a measured latency.
- Animation/keyframe declarations: shell entrance, status pulse, button/modal/toast transitions; keyframes at `index.html:60`, `:102`, and transition/animation rules around `:138-142`, `:228-244`. Shell entrance runs on initial load; pulse is attached to the online dot at `:98-102`.
- Initial notification/modal count: 0 open modals and 0 visible toasts in the static markup; one hidden empty state is the intended initial surface (`index.html:285-294`).

## Accessibility evidence

- Semantic button/input/select elements are used for primary actions (`index.html:266-277`, `:310-327`, `:356-378`). The toast has `role="status" aria-live="polite"` at `index.html:427`.
- Date fields have explicit accessible labels/titles at `index.html:315-316`; icon buttons have labels for theme/data/close actions at `:276-277`, `:389`, `:407`.
- Keyboard reachability is structurally likely for native controls, but **visible focus styling is missing** because no focus selector appears in the stylesheet. This is a critical keyboard usability gap; evidence at `index.html:135-145`, `:163-168`, `:221-225`.
- No skip-link was found. Explicit landmarks are limited; sections/header exist, but no `main` landmark was found in the inspected markup. Exact accessibility-tree count was not measured.
- `sharedHazardLine` is `aria-hidden="true"` at `shared-sync.js:202-204`, which is correct for decorative motion/color.

## Known gaps

- No live screenshot or browser computed-style capture was available, so contrast ratios, actual focus order, runtime request count, and time-to-interactive remain inferred.
- Static source cannot prove whether the injected shared runtime is served from cache or network on a particular user session.
