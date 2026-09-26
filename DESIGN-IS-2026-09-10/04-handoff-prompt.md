# Handoff

```text
/make-plan Refine Citation Tracker based on a Dieter Rams audit (total 20/30).

Verdict paragraph:
> Citation Tracker has a strong end-to-end operational flow and honest data messaging, but needs a focused visual/accessibility pass to unify the injected table line, reduce palette drift, clarify two labels, and restore visible keyboard focus.

Keep (already strong, do NOT touch in this pass):
- Principle #2 (useful) scored 3 — Evidence: the same surface supports import/drop, filtering, review, and export at index.html:285-327 and :356-378. Regression check: import a CSV, apply a filter, and export the filtered view.
- Principle #6 (honest) scored 3 — Evidence: source, offline fallback, and DEV restrictions are described at index.html:261-262, :289 and shared-sync.js:92-103, :136. Regression check: force offline mode and confirm the UI says OFFLINE CACHE; confirm clear remains visibly disabled in DEV.

Fix in priority order:
1. Principle #8 — thorough: add a shared visible :focus-visible treatment for every button, input, select, and modal control, plus a skip-link/main landmark. Evidence: no focus selector found; controls are defined at Citation-Tracker/index.html:135-145, :163-168, :221-225.
2. Principle #3 — aesthetic: replace the injected amber/black hazard stripe with the PCI white/blue glow line and give it one canonical token definition. Evidence: shared-sync.js:187-204 currently injects repeating-linear-gradient(45deg,#f2a900...#111...).
3. Principle #3/#10 — aesthetic/as little design: consolidate the 41-color palette into a documented role-based set and remove redundant gradients/one-off colors where they do not encode status. Evidence: index.html:26-42, :52-56, :141-142, :179-182.
4. Principle #4 — understandable: rename “Data” to “Manage data” and the mapping modal’s “Import” to “Apply mapping”; place the DEV disabled-clear explanation beside the action. Evidence: index.html:277, :397, :412-417; shared-ui.js:13-21.
5. Principle #8/#9 — thorough/environmentally friendly: add a compact loading/sync indicator and avoid redundant startup refresh/DOM patch work when the shared service worker already owns the boot path. Evidence: shared-sync.js:321-325; no dedicated loading markup in index.html:285-378.

Out of scope for this refine pass: backend/API schema, Google Sheet structure, citation parsing rules, authentication, destructive data behavior, and a full dashboard information-architecture redesign.

Deliverables for the plan:
- Exact target files and small patches for focus/landmark, shared line, palette roles, labels, and sync loading state.
- One canonical CSS token table with contrast checks for light/dark modes.
- Browser verification at keyboard-only, mobile/desktop, light/dark, and offline states.
- Regression checklist preserving import/filter/export and honest offline/DEV messaging.

Anti-patterns to guard against:
- Restyling the useful import/filter/export flow.
- Keeping the amber/black line in one runtime path while changing another.
- Removing status colors that communicate paid/pending/attention semantics.
- Claiming keyboard accessibility without testing visible focus and modal focus order.
```
