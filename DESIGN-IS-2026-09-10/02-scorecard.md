# Scorecard

1. **Good design is innovative — Score: 2/3**
   Evidence: browser-local CSV/TSV import, IndexedDB fallback, and shared-sheet verification create a coherent operational workflow (`README.md`; `shared-sync.js:92-136`).
   Justification: it improves a familiar spreadsheet dashboard workflow, but the interaction pattern remains conventional.

2. **Good design makes a product useful — Score: 3/3**
   Evidence: empty state directly offers file selection/drop, then filters, review, and export are present in the same surface (`index.html:285-327`, `:356-378`).
   Justification: the primary task is supported end-to-end without decoy actions or an unnecessary route change.

3. **Good design is aesthetic — Score: 1/3**
   Evidence: 41 hex tokens (`index.html:26-42`) plus the amber/black injected hazard line (`shared-sync.js:187-188`) create a visible system split; spacing/type scales also contain many one-off values (`index.html:49-50`, `:79-86`, `:115-225`).
   Justification: there are more than five inconsistencies or orphaned visual decisions, including the line that conflicts with the rest of the PCI blue language.

4. **Good design makes a product understandable — Score: 2/3**
   Evidence: empty/import, filters, KPIs, table, and management flows are explicitly structured (`index.html:285-427`), but “Data” and the second “Import” are ambiguous (`:277`, `:397`, `:412`).
   Justification: most controls are understandable, but two labels need contextual interpretation.

5. **Good design is unobtrusive — Score: 2/3**
   Evidence: the empty state centers one primary import action (`index.html:121-132`), while five KPI cards and multiple gradients add secondary visual weight (`:147-159`).
   Justification: chrome is generally quiet, but KPI decoration and multiple accent colors compete slightly with the citation-review task.

6. **Good design is honest — Score: 3/3**
   Evidence: the UI names the source, local/offline behavior, and DEV restrictions accurately (`index.html:261-262`, `:289`; `shared-sync.js:92-103`, `:136`).
   Justification: labels and status messages map to actual behavior and no deceptive pattern was found.

7. **Good design is long-lasting — Score: 2/3**
   Evidence: restrained typography and functional color naming are durable (`index.html:26-35`, `:79-80`), but radial/linear gradients and hazard striping are trend- or brand-phase-specific (`:52-56`, `:141-142`; `shared-sync.js:188`).
   Justification: the core language should age well, but the decorative treatment has one dated visual marker.

8. **Good design is thorough down to the last detail — Score: 1/3**
   Evidence: empty/error/success/offline states exist (`index.html:285-294`, `:780-796`, `:905-906`; `shared-sync.js:246-268`), but visible focus styling is absent and loading has no dedicated progress/skeleton state (`index.html:239-244`; `shared-sync.js:187-204`).
   Justification: two important states are missing or rough: keyboard focus and a clear loading treatment.

9. **Good design is environmentally friendly — Score: 2/3**
   Evidence: source payload is approximately 88.8KB and no autoplay media exists; reduced motion is respected (`index.html:239-244`), but font/network dependencies and startup shared refresh add transfer/attention cost (`index.html:16-20`; `shared-sync.js:321-325`).
   Justification: resource use is moderate and motion is gated, but the startup path is not minimal.

10. **Good design is as little design as possible — Score: 2/3**
    Evidence: the main flow is concentrated in one dashboard (`index.html:285-378`), while duplicated/injected styles and a hidden multilingual menu remain (`index.html:265-274`; `shared-sync.js:187-204`).
    Justification: the task surface is focused, but at least three secondary patterns can be removed or consolidated without harming the primary workflow.

**Total: 20/30**

