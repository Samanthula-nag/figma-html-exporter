# Figma HTML Exporter

A TypeScript Figma development plugin that exports independent HTML, external CSS, optional vanilla JavaScript, assets, and a ZIP archive. No framework or Figma runtime is included in the website.

## Run

1. Install Node.js 20 or later and run `npm ci`.
2. Run `npm run check` to type-check, test, and build.
3. In Figma Design, choose **Plugins → Development → Import plugin from manifest** and select this repository's `manifest.json`.
4. Select one or more website root frames and run **Figma HTML Exporter**. Each selected root becomes a page. **Analyze Page** uses visible top-level layers of the current Figma page.
5. Review the preview and diagnostics. Export ZIP is enabled only when validation passes. Extract the ZIP and open `website/index.html`.

The checked build is in `dist/`. The manifest uses a local development identifier; replace it with your Figma-assigned plugin ID before publication. The plugin reads designs; it does not mutate the canvas. No network permission is requested. The preview is sandboxed. Prototype mode tests existing internal page links and Back actions; verify external links and full website behavior in the extracted ZIP.

## Correcting the generated layout

After analysis, enable **Edit generated layout**. Click a website layer or select it from the layer list. Drag to move it; drag the blue corner handle to resize it. Use **Select parent** to adjust a whole group. Arrow keys move the selected element by 1px (Shift: 10px). The inspector offers X/Y offsets, width, height, font size, gap, container row/column direction, text wrapping and text content. Inspector changes save automatically after a short typing pause. Shift-click adds/removes canvas layers; the layer list also supports multiple selection. Ctrl-drag draws a box that selects fully enclosed layers. Drag any selected layer to move the selection together. Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes from the canvas or inspector.

For stacked navigation, select its container and choose **Horizontal row**, or select a single text layer and choose **Single line**. A row/column change releases direct children from absolute positioning. Moves preserve the original layout and transform using CSS `translate`; siblings do not automatically rearrange around a moved element. Resizing rotated or strongly constrained layers can need numeric adjustment.

Undo/Redo keeps up to 50 edit snapshots. **Reset layer** restores that layer's original properties while keeping separate child edits. Edits are kept across preview page switches and regenerated into the ZIP's normal HTML/CSS. Website validation runs after every edit and blocks download if errors remain. Editing code and selection outlines are never exported.

These corrections change the generated website, not the source Figma file. They remain in memory until the plugin closes or a new analysis starts, so export your corrected ZIP before re-analyzing. The preview's editor runs in an opaque-origin sandbox; source website scripts remain disabled.

## Prototype and window controls

Enable **Prototype** to test existing internal page navigation without moving layers. **Back** returns to the previous preview page. This does not create new prototype links or simulate Figma animations. The unused source-image section has been removed and analysis no longer captures that image.

Drag the blue bottom-right window handle and release to apply the new dimensions once. The window stays still during the gesture, avoiding repeated host repositioning. Keyboard arrow resizing remains available on the focused handle.

## Hierarchy-square setup

For your 1920px designs, place one rectangle named **hierarchy square** at the design's top-left corner, sized **15 × 15px**, with the layer's **opacity set to 0%**. It can be inside Header or another nested frame, as long as its canvas position matches the entire design's top-left corner. Keep it out of Auto Layout flow (use absolute positioning there) so the marker does not create an extra gap in Figma.

Select either the design frame or the square and click Analyze Selection. Selecting the square resolves to its outermost enclosing design frame. The plugin checks its position using absolute transforms, analyzes the full frame, and excludes the square from generated HTML, asset-only group conversion, and progress counts. The UI shows whether the reference was verified. Desktop preview offers 1920px; actual source dimensions remain authoritative.

Exports with a verified square include `design-map.json`, containing every exported IR layer's origin relative to the square and its source dimensions. CSS keeps nested parent-local positions and Auto Layout behavior; the reference does not flatten or shift the hierarchy. Missing, duplicated, rotated, scaled, or misplaced markers produce diagnostics and fall back to the design-frame origin. A marker establishes a coordinate origin, not a guarantee of pixel-perfect rendering or a fix for plugin communication problems.

## Architecture

`plugin/main` coordinates messages and progress. `analyzer` converts real Plugin API nodes to a serializable, Figma-independent `ir/types` model. HTML, CSS and JavaScript generators consume that model. The asset manager exports SVG and rendered PNG bytes and deduplicates identical outputs. Responsive rules derive from Auto Layout measurements. Validators check generated HTML/CSS syntax, class collisions, IDs and references. The UI embeds a preview and builds the downloadable ZIP using fflate.

CSS declarations with identical sets share grouped selectors. Repeated colors, gaps and radii become shared CSS variables. Class names and paths are deterministic and collision-safe. Unsupported nodes are isolated so their errors do not discard other pages.

## Supported behavior

- Current-page and selection analysis; selected descendants are excluded when their ancestor is also selected.
- Auto Layout flex direction, gap, padding, alignment, wrapping, fill/hug sizing; native Grid track sizes and gaps.
- Freeform child positioning, horizontal stretch constraints, rotation, clipping, opacity, solid and linear-gradient fills, uniform borders/radius, shadows.
- Text content and typography; name-based semantic tags; safe HTML escaping.
- Vectors and vector-only groups as external SVG; image-bearing leaf layers as rendered PNG, preserving their composited crop.
- Static components/instances/variants, shared style declarations.
- Click URL and exported-root navigation; history-back JavaScript when required.
- Multiple website pages, relative asset references, diagnostics, sandboxed preview, ZIP export.

## Explicit limitations

This is a tested core implementation, not a claim of universal design conversion or production readiness for every input.

- Figma image content is an IMAGE paint, not an IMAGE node. PNG is used rather than claiming unsupported WebP export.
- Font binaries are not exposed by the Plugin API. Font families are retained with sans-serif fallback; obtain licensed web fonts separately.
- Mixed text styling currently uses the first segment and emits a warning. Text hyperlinks and rich inline formatting need further work.
- Container image fills, pattern/radial/angular/diamond fills, masks, blur, blend modes and advanced stroke geometry are not fully reproduced. Diagnostics identify known unsupported features; visual review remains necessary.
- Only horizontal stretch constraints currently affect freeform CSS. Freeform designs preserve coordinates and are not automatically rebuilt as responsive flow.
- Responsive wrapping is inferred from measured row children, not user-authored mobile designs. Grid placements and spans are mapped; breakpoint-frame matching is not yet implemented.
- Components export static DOM. Variant switching, overlays, tabs, accordions, carousels, menus, form submission, smart animations, and application state are not inferred or fabricated.
- Prototype navigation targets must be exported roots. The current page is analyzed; the plugin does not automatically traverse every Figma document page.
- Semantics and image alternative text are heuristics based on layer names. Review before publishing. Form-shaped artwork stays static.
- SVG is external; inline SVG mode and automatic font packaging are not implemented.
- Large exports are processed sequentially and retained in memory. Progress is reported by node count; cancellation and worker-based ZIP compression are future improvements.

## Verification

`npm test` covers naming, escaping, node analysis, layout, CSS and HTML generation, asset mapping, responsive rules, links, validation, and ZIP round trips. It writes a synthetic multi-section, two-page fixture to `test-output/website`.

`node scripts/browser-test.mjs` uses installed Microsoft Edge through Playwright to check 375/768/1440px viewport overflow, loaded images, links, history behavior and browser exceptions, and saves screenshots. This is separate from the build because Edge availability varies by machine.

`npm run test:browser` runs those website checks plus the built UI tests: sandboxed preview, binary images, page switching, a real ZIP download, and validation error blocking. UI messages are simulated in that browser test; an in-Figma manifest import remains a separate acceptance check.

See [manual test matrix](docs/manual-tests.md) and [API capabilities](docs/api-capabilities.md). Live file observations and remaining acceptance gaps are recorded in [test report](docs/test-report.md).

## Visual comparison workflow

Keep the source Figma frame ID, original dimensions, exported IR and generated site together. Export a reference PNG from Figma, render the website at the exact source width, and compare section geometry, typography and asset bounds. Save browser screenshots at additional widths to detect overflow. Improve a conversion rule and rerun the same fixture; do not hard-code a specific client's design into the generator.

### Canvas editing (build 2026-09-25-canvas-7)
Choose Expand canvas for a full-window editor with a side inspector. Select a layer from the list and drag its content directly; selected groups move together. Alt-click drills into a child. Use the corner handle to resize, Zoom to work at 25–200% or Fit, and Space-drag or middle-drag to pan. Desktop width remains 1920 design pixels at every zoom. Drag edits apply immediately and are included in the ZIP. Reopen the development plugin to load the rebuilt files.


## Editor controls (build responsive-code-11)

Hold Ctrl and scroll over the canvas to zoom in/out (25–200%). Search layers by name above the layer list. Font family, weight, italic/normal, and decoration controls save automatically. Font families must be available on the viewing computer; the plugin does not bundle licensed font files.

**Auto responsive · all pages** adds smaller-screen reflow, wrapping, flexible images and fluid large type to every exported page, with one-step Undo. For 1920px source frames, reflow applies below the source width. Review complex freeform or overlapping artwork at each target size; automatic rules are a starting point, not a pixel-perfect guarantee.

**Edit HTML / CSS / JS** opens the generated files. Changes save after a typing pause, update the HTML/CSS preview, and are included in the ZIP. Manual file overrides survive subsequent visual edits; use **Reset file** to return that file to the current generated output. HTML/CSS errors block export. JavaScript is editable and exported but is not executed or syntax-validated in the plugin preview. **Add JavaScript** creates or opens the script file and links it from all pages. New analysis clears manual overrides, as it clears visual edits.

## Delete, import and quick colour (build import-delete-12)

Use **Delete selected**, Delete, or Backspace on the viewport to remove selected generated layers. Typing in inspector fields does not delete layers. Ctrl+Z restores a deletion, including children. The exported page container is kept; delete its children instead. Source Figma nodes are never deleted.

Double-click text in the generated viewport to open its colour popup. Pick a colour and choose Done; the preview and ZIP update.

To import, select layers in Figma, then drag the **Figma selection** card inside the plugin onto the generated viewport, or click **Import selection**. This is a staged selection workflow; direct dragging from the native Figma canvas into the plugin is not implemented. Imports keep relative positions and assets, receive unique IDs/classes/asset paths, and can be undone as one action. Analyze a frame/container first. Manual code overrides still take precedence over regenerated files.

### Prepare original Figma layout

Build `2026-09-25-prepare-13` adds **Prepare Figma layout** with selection or entire-page scope. It modifies supported original auto-layout frames into fixed geometry before importing. Review the source in Figma, then use Analyze Selection/Page or Import selection separately. Repeat preparation after source edits. This is manual preparation, not live synchronization or a guarantee of identical browser rendering. Components, instances, locked subtrees and selections controlled by an unselected auto-layout parent are skipped. Figma Undo restores the conversion; plugin viewport Undo is separate. Fonts are checked before mutation, and a failed conversion invokes Figma Undo. Existing free-positioned frames need no conversion; font, mask and effect export limitations still apply.

### Canvas controls — build 2026-09-28-canvas-14

Select a layer in Edit mode. Drag the circular handle above it to rotate; hold Shift to snap to 15 degrees. Shift-drag the resize handle preserves proportions, and Shift-drag the layer constrains movement to one axis. Ctrl/Cmd+D duplicates selected layers (a selected parent includes its children once). Bring to front / Send to back change stacking within each parent without rearranging flex/grid flow; Ctrl/Cmd+Shift+] or [ also works while the canvas has focus. These edits support Undo/Redo and generated HTML/CSS/ZIP. They edit the plugin copy, not the original Figma document. Full Figma parity (vector path editing, components/variants, constraint solving) is not implemented. Run npm run test:canvas for the focused browser interactions.

### Warning details and supported fixes — build 2026-09-28-warnings-15

Click the Warnings count to open every warning with an explanation and, when available, Show layer in Figma. Auto-fix adds a missing invisible hierarchy square to eligible source frames. Opting into rendered images also marks eligible unrotated gradient rectangles/ellipses without strokes or effects for Figma PNG export. This writes plugin metadata on the original node, preserving its editable source; exported paint becomes an image. The plugin checks source changes and export availability first, skips protected/component-owned layers, and supports Figma Undo. Re-select the original frames and analyze again to verify the remaining warnings; this replaces plugin-side edits. Fonts, masks, mixed text styles, effects and responsive reflow need manual review. Zero warnings does not certify a perfect export.

### Preserve Figma positions — build 2026-09-28-geometry-16

Analysis and import now default to preserving measured Figma sizes and relative transforms for editable layers, including resolved Auto Layout children. The browser does not recompute their layout through flex/grid or stretch widths. Fit zoom scales the native source-width preview rather than shrinking the document and wrapping its layers. Disable Preserve Figma positions before analysis to use the previous flow-based exporter. Fixed desktop geometry is not automatic mobile reflow; Auto responsive remains an explicit separate operation. Fonts, unsupported image-filled containers, masks and other paint limitations remain reported; this mode does not guarantee identical rendering. Re-analyze to replace the previously generated document (plugin edits are cleared). No original Figma changes are required for this import mode.

### Hero warning fixes — build 2026-09-28-diagnostics-17

Reference lookup now prefers a valid marker directly inside the selected root and ignores nested section markers with different origins. Equivalent markers are accepted; 15×15, zero-opacity named group/frame markers are recognized too. Paint warnings about CSS approximation are removed only after successful SVG/PNG export, because CSS paint is not used for that asset; the rendered asset is recorded under Export notes. Freeform layout is an informational note when Preserve Figma positions is enabled. Fonts remain actionable until matching web fonts are supplied. The warning dialog accepts licensed WOFF2/WOFF/TTF files by font family, weight and style, validates them in the browser, and embeds them in preview/export CSS. All required variants must be supplied before a family warning clears. Fonts persist through re-analysis during the current plugin session; reopening requires supplying them again. Original Figma layers are not changed by these diagnostics fixes.

### One-click supported repair and re-import — build 2026-09-28-repair-18

Warnings → Repair and re-import from Figma applies eligible source fixes, then automatically rebuilds the frames from the last analysis with Preserve Figma positions enabled. Changing selection to inspect a warning does not change the repair scope. The source page and all original roots are checked before any source repair. Artwork is not flattened or reorganized; image fallback remains opt-in. The refreshed preview replaces plugin edits, imported additions and manual code overrides. Fonts supplied in this session are reapplied. The result reports repaired layers and remaining warnings; unsupported effects and missing fonts are not claimed to be solved. Figma Undo reverses source repairs; this action does not promise pixel-identical editable output for unsupported features.

### Live sync — build 2026-10-07-live-sync-19

Live sync from Figma is enabled by default after analysis while the plugin is open. Page node changes and style changes trigger a debounced refresh (650 ms after changes settle, plus analysis time). Selection changes do not switch the analyzed frames. Page analysis follows current top-level content; selection analysis follows original root IDs. Switching pages suspends refresh until you return. Hidden/deleted source roots clear the preview instead of leaving stale export content. Plugin-side canvas, inspector, import and code edits automatically pause sync to protect them. Enable the checkbox again to replace those edits with the latest Figma state; supplied font files are retained for the session. This is one-way Figma-to-preview synchronization, not write-back from preview edits. Existing rendering limitations still apply.
