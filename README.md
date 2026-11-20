# Plotline

A browser-based Bangkok site feasibility study for residential zone ย.3-29. Draw a plot, choose a mapped fronting road and compare broad and slender building concepts against the modeled controls.

## Run locally

Requires Node.js 22 or later and npm. No required environment variables, account or API key is needed.

```sh
npm ci
npm run dev
```

Open the localhost address printed by Next.js. The development server binds to 127.0.0.1.

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

The build produces a static site in `out/`. Serve that directory with a static HTTP server. The app has no backend or database. Remote basemap tiles require internet access; bundled site context remains available when the remote style cannot load. Production uses Webpack and the TypeScript compiler API to support restricted local build environments; type checking stays enabled.

For a domain root, leave `NEXT_PUBLIC_BASE_PATH` unset. For hosting below a path, set this optional variable when building, then mount the contents of `out/` at that same path:

```sh
env NEXT_PUBLIC_BASE_PATH=/plotline npm run build
```

For example, this build expects `/plotline/index.html`, `/plotline/data/` and `/plotline/_next/` on the same host. Use a path starting with `/`, without a domain, query or traversal segments. A trailing slash is normalized. The prefix is compiled into the page, geographic asset requests and worker URLs. Rebuild when changing it; setting it only on the static host does not change an existing export.

## Use the study

1. Start with the hypothetical study plot, or select Draw plot. Click corners and click the first corner or press Enter to finish. Cancel or Escape restores the previous plot.
2. Select Edit to move vertices, insert midpoint vertices or move the outline. Handles remain selected after a move, so you can make repeated edits without selecting the boundary again. Reset restores the study boundary.
3. Choose condominium or office use, a fronting road, an assumed legal road width, floor height and study ceiling. The map and analysis update together.
4. Select a concept and inspect its checks and floor ledger. Numeric checks show the calculated value, maximum or minimum, and signed margin. OSR uses percentages and percentage-point margins. Assumed planting remains unverified even when its reservation exceeds the minimum. Rule effects shows the original plot, boundary inset, road offset and exact section at the selected height ceiling. Selecting a stage switches the map to Plan mode. Changing an input clears the old inspection while recalculating.
5. Each concept has separate FAR, use-area and open-space budgets. Sources and envelope assumptions explain the scope. Export study downloads the actual scenario, unrounded results, geometry and source references as JSON.

If calculation fails, Retry calculation restarts the calculation for the current unchanged scenario. It remains available when the map is unavailable.

A calculation that does not reply within 30 seconds is stopped and exposes the same retry action. Rapid input changes keep only the newest pending scenario and cannot extend an active calculation's deadline. Starting a new boundary retires any calculation for the previous plot.

Draw and Edit bring the map into view and focus its keyboard surface. Cancel is also available directly above the map while drawing, and phone sliders have 44 px input targets. Export shows a dismissible download-request message or a start error. The message confirms activation only; check the browser's downloads for the saved file.

If the graphics context is lost, drawing and map updates pause. The app keeps the scenario plot, waits for the rebuilt style, restores the editor and uploads the latest geometry. Normal pan and rotation settings survive a loss during dragging. Perspective and envelope visibility changes do not re-upload unchanged geometry.

## Structure

- `src/lib/engine/index.ts`: deterministic projected geometry, rule budgets, height sections and concept search.
- `src/workers/analysis.worker.ts`: calculation transport, separate from the rendering worker.
- `src/lib/use-analysis.ts` and `src/lib/analysis-client.ts`: revision protection, worker recovery and coalescing of rapid input changes.
- `src/components/site-map.tsx`: persistent MapLibre map and Terra Draw editing.
- `src/lib/site.ts` and `public/data/`: validated local geographic snapshot.
- `src/lib/rules.ts`: source documents and clauses used by the study.

Geometry is projected into UTM zone 47N before measuring metres and square metres. JSTS operations preserve the actual polygon, including concavities, holes and disconnected inset sections. The study envelope uses fixed 0.5 m bands independently of the proposed floor height. Every band uses its top section, including a final partial band ending at the exact study ceiling. Its strict vertical sampling underfill is less than 0.5 m relative to the modeled volume; horizontal differences depend on the active restrictions. Separate conservative setbacks still apply. The control shows the step and bound. Band `height` is thickness above `base`, so the rendered top is `base + height`.

FAR and open-space limits are aggregate budgets. The geometric envelope alone does not grant the full volume as floor area. Each concept uses connected, uniform floor plates, and its gross floor area is the sum of counted floor areas. Displayed ledger rows round to 0.01 m² and their footer sums those rounded rows. Calculations and exported JSON retain full precision.

## Geographic data

Bundled geographic files use `.json` names with unchanged GeoJSON content, so hosts that compress JSON can compress them. The four geographic assets total 173,741 bytes before compression and 21,235 bytes with gzip level 6. Actual response compression depends on the host and must be verified after a deployment. Fixed filenames retain conditional revalidation rather than long immutable caching.

The official zone polygon comes from the [Bangkok planning map service](https://cpudgiapp.bangkok.go.th/arcgis/rest/services/GI_Platform/BMAGI_Planing/MapServer/1). Its attributes identify ย.3-29, FAR 2.5 and OSR 12.5%. Zero-valued height and setback attributes are not interpreted as unrestricted permission.

The local OpenStreetMap snapshot contains 157 building footprints and 216 road features, retrieved on 19 November 2026 at 03:28:07 IST. It covers 100.708 to 100.718 longitude and 13.826 to 13.836 latitude. The three road choices are actual mapped roads. The default study fronts Soi Hathai Rat 29/1, with 34 mapped building area-centroids within 100 m of the study centroid. Legal road widths and public access are scenario assumptions.

All local building heights are illustrative 9 m values, because this snapshot contains no usable height or storey tags. Footprints and centerlines are real mapped features. The 1,619.31 m² default plot is a hypothetical redevelopment boundary, not a surveyed cadastral parcel. Absence of a mapped building does not establish vacant land or ownership.

OpenStreetMap data is attributed to its contributors under [ODbL 1.0](https://www.openstreetmap.org/copyright). OpenFreeMap and OpenMapTiles attribution remains visible. BMA source attribution is preserved; redistribution licensing remains unverified and requires review before public release. Publication does not resolve source licensing or site-specific applicability.

## Rules and limits

Sources include the [corrected 2013 Bangkok plan](https://webportal.bangkok.go.th/public/user_files_editor/354/aboutcpud/2556/4law.pdf), [Ministerial Regulation 55](https://webportal.bangkok.go.th/public/user_files_editor/95/ITA2566/O4/CI/ci-11.pdf) and [Bangkok building control regulation](https://webportal.bangkok.go.th/public/user_files_editor/76/law/tk24.pdf). The app links each check to its relevant source and explains its interpretation.

This is a conditional concept study, not permit approval. In particular:

- Only the supported ย.3 residential zone is evaluated. The entire plot must lie inside the supplied official zone boundary.
- A conservative 3 m boundary offset is a scenario design constraint, not a claim that every boundary legally requires exactly that distance.
- The fronting road uses a local straight segment and a centered right of way. Actual road boundaries, curved frontage, public access and legal width require verification.
- Condominium and office area thresholds use the selected road-width branch. Rail-station exceptions and office uses beyond the supported area branch are excluded.
- The study ceiling remains below 23 m. It is a product scope limit, not a universal zoning height limit.
- The selected permeable share is a reservation for tree planting on permeable ground. The plan requires at least half of open space for this purpose. Layout and qualification remain unverified.
- BMA ordinance clause 52 uses site area for its residential 30% and nonresidential 10% open-space minima. This differs from the national largest-floor-area rule in MR55 clause 33. OSR also imposes an independent floor-area budget.
- Parking, fire access, legal frontage qualification, large-building classification, aviation and other special overlays remain unresolved. Parcel history and existing FAR allocation are unknown. Floor-to-floor height does not establish interior clear height, roof allowances or the legal height datum. Unknown controls remain visible even when modeled checks pass.
- The concept search considers connected polygonal plates of at least 9 m² derived from the actual buildable section, including road-aligned and cross-road cuts. The pair is ordered so Broad has at least as much footprint area and no more levels than Slender, with a distinct area or level count. Descriptions explain equal-area or equal-level pairs. If the bounded search finds no ordered pair, only one concept is shown with an explicit limitation. A search miss has a distinct explanation and preserves valid rule geometry for inspection. It does not prove that every possible design is infeasible. Zone and road scope exclusions have separate explanations.
- Stepped or cantilevered schemes and detailed circulation, structure and servicing are outside this first study.

The corrected 2013 plan is a conditional baseline. The official fourth-revision portal still describes a draft, and the 2019 Town Planning Act contains transitional continuity provisions. Current consolidation of all amendments and site-specific enactments has not been exhaustively established.

## Local browser checks

The static export includes a separate checking utility at `/checks/browser.html`. Open it on the same HTTP origin as the production export. With a configured base path, put that path before `/checks/browser.html`. The utility embeds the actual exported app at `../index.html`; it does not replace the map or calculation engine.

Choose a width and height, wait for drawing controls and concepts, and audit the layout. For timing, keep the entire frame visible. Record changing native actions separately as warmups and measured samples. Already-selected controls, hidden or clipped frames, navigation, superseding actions and timeouts are rejected. Cadence records two seconds of warmup and ten seconds of animation-callback timestamps. The raw report includes environments, asset URLs, validity, Event Timing and long-frame entries when supported. These are semantic-readiness and frame-opportunity measurements, not GPU completion, displayed map frame counts or field interaction scores.

Inspect editing surface records canvas position, keyboard focus, nearby Cancel and slider target heights. Test graphics recovery deliberately loses and restores the actual WebGL context using the browser extension, recording the loss/restoration events, suspended controls, recovered readiness and new page errors. An unavailable extension or an incomplete recovery is recorded as a failed check. These diagnostics do not substitute for completing a plot and repeated vertex edits with native pointer input.

On 19 November 2026, the production app passed overflow and overlap diagnostics at 360 x 844, 390 x 844 and 1280 px widths. Phone client widths were 345 and 375 px because this desktop browser reserved a scrollbar. Native Sources, Close, Checks and Floors controls and the floor ledger were inspected. Header actions fit, Sources has an accessible name, and the dialog body scrolls while its heading and 44 px Close control remain visible. These are narrow-layout checks on this host, not physical-phone hardware or touch tests.

On 20 November, the rebuilt local export passed the 390 x 844 and 360 x 844 layout audits without horizontal overflow or detected overlaps. All four slider input targets measured 44 px high. Draw focused the canvas and, after smooth scrolling settled, put its top at 0 px with Cancel at 18 to 62 px. Cancel restored the 1,619 m² study plot. Edit also focused the canvas. Native canvas clicks with keyboard map panning completed a fresh 1,103 m² triangle; a native vertex drag changed it to 1,105 m², with selection handles visible afterward. A subsequent repeated-drag command timed out in the desktop browser runtime. The runtime later resumed, but a second geometry change was not established, so repeated live editing is not claimed. Installed-library regression tests cover repeated edits and restored selection separately.

The real WebGL context-loss probe passed: loss and restoration events were observed, drawing controls disabled during the loss, controls became ready again, and no new page error was captured. The recovered map was visually inspected. This confirms observed graphics/control recovery; exact plot restoration and repeated recovery are additionally covered by the adapter tests.

Current normal-laptop rendering performance remains unverified. Earlier probes on 19 November produced no callbacks and were rejected. A 20 November public-build cadence probe observed ten adjacent intervals over 10,008.2 ms, with median 1,000.8 ms and p95 1,000.9 ms in a fully visible embedded frame. This establishes that probe's slow callback cadence, without establishing whether the host or the application caused it. It does not pass a 30 FPS target. A fresh 360 x 844 probe of the rebuilt local export reached the watchdog and was recorded invalid. The host is a Ryzen 5 5600X with 12 logical CPUs, Linux x86_64, Chrome 152 / Electron 44.7, DPR 1 and Node.js 22.22.0.

Export uses a connected anchor and keeps its Blob URL alive for sixty seconds after activation, with immediate cleanup if activation throws. Four focused tests cover serialization, activation order, delayed cleanup, repeated exports and activation failure. Browser observations confirmed trusted Export activation, actual JSON Blob creation and the application's connected download-link invocation at narrow and desktop widths. The actual generated condominium and office payloads (115,196 and 115,233 bytes) each passed 3,449 schema, finite-coordinate, closed-ring, revision, source-reference and floor/band arithmetic assertions; six deliberate corruptions were rejected for each. These bytes were retained separately for inspection. No resulting downloaded file was found in the session filesystem or download registry, and no native save window was available. Actual file delivery remains unverified. To finish that check, activate Export study in the ordinary app, locate the resulting `plotline-study-YYYY-MM-DD.json` file and validate that file's scenario, result, geometry, sources and floor totals. Captured Blob text is not a downloaded-file substitute.

The 20 November local export also showed the new download-request message after trusted activation. It created a 102,750-byte JSON Blob for the edited phone plot and activated its connected download link. Independent UTM projection reproduced the reported 1,105.4227437293491 m² plot area. Both concepts' counted floor sums reconcile with gross floor area, all 46 envelope bands fit the study ceiling, and nine deliberate data corruptions were rejected. No saved file was found in the scoped Downloads, session-data and temporary-file search, so actual file delivery remains unverified.

The current automated suite contains 120 passing tests across twelve files, including worker execution deadlines, graphics lifecycle recovery, source-update identity checks, JSON data loading, phone map focus and download cleanup. Type checking, lint and production builds are checked separately. The earlier host calculation figures (2.77 ms median for the supplied plot and 149.85 ms for an 80-vertex stress parcel) predate finer envelope sampling and are not current rendering measurements.

The analysis runs locally. No candidate details, personal document links, account credentials or application submission functions are included.
