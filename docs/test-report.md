# Test report

## Automated

Correction-editor update (`2026-09-25-editor-6`): 26 unit/integration tests pass. Browser checks exercise selecting and dragging a real rendered element, corner resizing, numeric/text edits, undo/redo, page switching, and downloading the edited ZIP. Assertions inspect the ZIP for corrected text, width and translation and ensure editor scripts are absent. UI startup initially failed because bundled HTML strings triggered the HTML parser's double-escaped script state; escaping opening script tokens as well as closing ones fixed it, and the rebuilt UI tests pass. This build has not been verified in the user's running Figma session.

Visual-first update (`2026-09-25-visual-5`): 22 unit/integration tests pass. New checks verify that Figma PNG capture and source delivery precede layer-analysis progress, tall-frame captures preserve dimensions with bounded image resolution, and failed capture stops generation with an error. The built-plugin bridge/browser test verifies source-image decoding and original-size display in the UI. These source images use a mocked PNG fixture; the user's live Figma session has not been verified.

Hierarchy-square update (`2026-09-25-reference-4`): 19 tests pass, including selecting a nested marker, full-frame promotion, duplicate-selection removal, marker exclusion, invalid-marker fallback, parent-versus-design coordinates, and placement-map export. Type-check/build and the browser/bridge/UI suites also pass. The new behavior has not been exercised in the user's running Figma desktop session.

- TypeScript compilation against official Figma typings: passed.
- Thirteen unit/integration tests: passed.
- Synthetic two-page site in headless Edge: passed at 375, 768 and 1440 pixels; images loaded, internal navigation and history-back worked, no browser exceptions.
- ZIP round trip: generated file contents and binary asset bytes matched.
- One malformed-CSS test initially failed. Added declaration grammar validation and reran successfully.
- Built UI browser tests: preview, embedded binary assets, page switching, actual ZIP download and validation blocking passed. These use simulated plugin messages, not a running Figma desktop plugin.
- The preview test exposed blocked blob images in opaque-origin frames. Embedded data URLs fixed the issue; browser verification then passed.
- Visual inspection of the synthetic mobile page and built UI confirmed stacked cards, readable text, loaded images and usable controls. This is not a source-Figma pixel comparison.

## Supplied Figma design

Source: `qpqj7MjNHpWVlRRmzHPuLR`, frame `1:4`, “Nate Amendola Defense_v3”, 1920 × 12621.

Read-only execution of the compiled production analyzer through the Figma connector succeeded. Source inventory: 857 nodes, including 56 frames, 365 vectors, 127 text nodes, 166 groups, 49 rectangles, 72 polygons, 16 lines and 6 ellipses. Only two containers use Auto Layout. There are no component or instance nodes, so this source does not cover the requested component/variant matrix.

The analyzer produced 442 IR nodes, 197 asset mappings and 213 diagnostics. Vector-only groups were consolidated into SVG assets. Warnings include freeform responsiveness, mixed text styling, stroke alignment and unsupported paint types.

The live IR also passed HTML and CSS generation/validation: 49,093 characters of HTML, 113,190 characters of CSS, and 240 characters of responsive CSS. The small responsive output reflects the lack of Auto Layout rather than fabricated breakpoints.

Figma's Starter-plan MCP call limit blocked complete asset retrieval for local inspection. The live reader's `exportAsync` calls succeeded, but a complete local export/ZIP and source-versus-browser visual comparison were not completed. The temporary snapshot and its one-off audit script were removed during project cleanup. This historical result is not a current end-to-end export verification.

Subsequent regression improvements strip already-baked paint/effects from exported-asset CSS, preserve asset layout sizing, support Grid placement/spans, and avoid zero-height image attributes. These passed local tests; a further live reader rerun was blocked by the connector quota.

## Acceptance gaps

Running the reader through the connector verifies real Plugin API access and asset export, but does not prove that the installed development plugin UI loads inside the Figma desktop client. The manifest import, in-client preview and user-triggered ZIP download still require that manual smoke test. Component/variant live testing and full matrix coverage remain outstanding.

No pixel-accuracy percentage is claimed. This supplied freeform design cannot demonstrate responsive Auto Layout behavior; synthetic browser tests cover that separately.

## Recommended next work

### Communication regression (2026-09-25)

The user reported that the in-Figma UI remained at 0% and then showed the startup timeout. This confirms no accepted acknowledgement reached that UI; the exact failure in the user's host is not yet verified. Build `2026-09-25-bridge-3` removes sender-window identity assumptions, supplies the manifest plugin ID in outgoing messages, and gates Analyze on a version-checked ping/pong handshake. A visible connection/build indicator distinguishes a failed connection from analysis progress and mismatched builds. The full compiled UI → host iframe → compiled plugin → UI test passes with mocked Figma document data. This is stronger bridge coverage, but is not an in-Figma confirmation. Existing generation and UI checks pass as well.

1. Import the built manifest in Figma and export the supplied frame directly, completing full asset and visual inspection without consuming connector quota.
2. Test a real nested Auto Layout design with components, variants and native Grid.
3. Preserve mixed text runs and improve container-image fills, masks and gradient geometry.
4. Add breakpoint-frame matching and explicitly supported component-state interactions.
