import { cadenceSummary, nextRangeValue, sameScenario, visibilityProblem } from "./browser-core.js";

const frame = document.getElementById("app"), status = document.getElementById("status"), report = document.getElementById("report");
const control = id => document.getElementById(id);
const target = new URL(new URLSearchParams(location.search).get("app") || "../index.html", location.href);
if (target.origin !== location.origin || target.href === location.href) throw new Error("Choose a different app page on the harness origin.");
const records = { version: 4, createdAt: new Date().toISOString(), app: target.href, loads: [], layout: [], editing: [], recovery: [], interactions: [], cadence: [], events: [], longFrames: [], exports: [], context: [], errors: [], invalidSetups: [], resets: [], dropped: {} };
let context = null, armed = null, pending = null, cadence = null, loadSequence = 0, runSequence = 0;
let autoTimer = null, autoGeneration = 0;
const clean = value => String(value || "").trim().replace(/\s+/g, " ").slice(0, 160);
const label = element => clean(element?.getAttribute?.("aria-label") || element?.textContent || element?.id || element?.tagName);
const copy = value => structuredClone(value);
const append = (name, value) => {
  if (records[name].length < 20000) records[name].push(value);
  else records.dropped[name] = (records.dropped[name] || 0) + 1;
};
function update() { if (!pending && !cadence) report.value = JSON.stringify(records, null, 2); }
function say(text) { status.textContent = text; update(); }
function enabled(ready) {
  for (const id of ["audit", "arm-scenario", "arm-state", "sample", "cancel", "clear", "refresh", "inspect-editing", "map-recovery"]) control(id).disabled = !ready;
  if (ready) control("sample").disabled = !!cadence;
}
function environment(ctx) {
  if (!currentDocument(ctx)) return { loadId: ctx.id, timeOrigin: ctx.timeOrigin, documentReplaced: true };
  return { at: new Date().toISOString(), loadId: ctx.id, href: ctx.win.location.href, width: ctx.win.innerWidth, height: ctx.win.innerHeight, clientWidth: ctx.doc.documentElement.clientWidth, dpr: ctx.win.devicePixelRatio, userAgent: ctx.win.navigator.userAgent, concurrency: ctx.win.navigator.hardwareConcurrency, memory: ctx.win.navigator.deviceMemory, timeOrigin: ctx.win.performance.timeOrigin, observerTypes: ctx.win.PerformanceObserver?.supportedEntryTypes || [], visibility: copy(ctx.visibility), styles: [...ctx.doc.querySelectorAll('link[rel="stylesheet"]')].map(x => x.href), scripts: [...ctx.doc.scripts].map(x => x.src).filter(Boolean) };
}
function currentDocument(ctx) {
  try { return ctx.win.document === ctx.doc && ctx.win.performance.timeOrigin === ctx.timeOrigin; } catch { return false; }
}
function readinessProblem(ctx) {
  if (!ctx || !currentDocument(ctx) || ctx.win.location.href !== target.href) return "Expected app document is not attached";
  if (!ctx.doc.querySelector(".workbench") || !ctx.doc.querySelector(".results-panel")) return "Production app markup is missing (possibly an error document)";
  if (!ctx.doc.querySelector('link[rel="stylesheet"][href]') || ![...ctx.doc.scripts].some(x => x.src)) return "App stylesheet or script assets are missing";
  const draw = [...ctx.doc.querySelectorAll(".draw-actions button")].find(x => clean(x.textContent) === "Draw plot");
  if (!draw || draw.disabled) return "Map drawing controls are not ready";
  if (ctx.doc.querySelector(".results-panel")?.getAttribute("aria-busy") !== "false" || !ctx.doc.querySelector(".concept-card") || ctx.doc.querySelector(".result-notice.error")) return "Settled concept results are not ready";
  return null;
}
function guard(operation, requireVisible = false) {
  const reason = readinessProblem(context) || (requireVisible ? visibilityProblem(context?.visibility) : null);
  if (!reason) return true;
  append("invalidSetups", { operation, reason, loadId: context?.id || null, at: new Date().toISOString() });
  say(`Cannot ${operation}: ${reason}.`); return false;
}
function scenario(ctx) {
  const value = id => ctx.doc.getElementById(id)?.value;
  return { road: value("road"), "road-width": Number(value("road-width")), "storey-height": Number(value("storey-height")), "height-limit": Number(value("height-limit")), "permeable-fraction": Number(value("permeable-fraction")), use: clean(ctx.doc.querySelector('.building-use button[aria-pressed="true"]')?.textContent) };
}
function targetState(element) {
  return { selected: element.getAttribute("aria-selected"), pressed: element.getAttribute("aria-pressed"), checked: element.matches('input[type="checkbox"]') ? element.checked : null };
}
function refreshTargets(ctx) {
  ctx.targets = new Map();
  for (const element of ctx.doc.querySelectorAll("input,select,button")) {
    const rendered = element.matches('input[type="checkbox"]') ? element.closest("label") || element : element;
    const r = rendered.getBoundingClientRect(), s = ctx.win.getComputedStyle(rendered), v = ctx.visibility;
    const visible = s.display !== "none" && s.visibility === "visible" && r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= ctx.doc.documentElement.clientWidth + 1 && r.bottom <= ctx.win.innerHeight + 1 && v.frameRect.left + r.left >= -1 && v.frameRect.top + r.top >= -1 && v.frameRect.left + r.right <= v.outerViewport.width + 1 && v.frameRect.top + r.bottom <= v.outerViewport.height + 1;
    ctx.targets.set(element, { ...targetState(element), visible });
  }
}
function refreshVisibility(reason) {
  const ctx = context;
  if (!ctx) return;
  if (!currentDocument(ctx)) { cancelActive("App document changed during a check"); update(); return; }
  const r = frame.getBoundingClientRect(), s = getComputedStyle(frame);
  const width = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)), height = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  ctx.visibility = { parent: document.visibilityState, child: ctx.doc.visibilityState, display: s.display, cssVisibility: s.visibility, frameIntersection: r.width * r.height > 0 ? width * height / (r.width * r.height) : 0, frameRect: { left: r.left, top: r.top, width: r.width, height: r.height }, outerViewport: { width: innerWidth, height: innerHeight } };
  const change = { loadId: ctx.id, at: ctx.win.performance.now(), reason, visibility: copy(ctx.visibility) };
  append("context", change);
  if (pending) pending.data.visibilityHistory.push(change);
  if (cadence) cadence.data.visibilityHistory.push(change);
  const problem = visibilityProblem(ctx.visibility);
  if (problem && (pending || cadence)) { cancelActive(problem); say(`Check invalid: ${problem}.`); }
  if (!pending && !cadence && armed) { refreshTargets(ctx); armed.targets = ctx.targets; }
}
function cancellationData(active, reason) {
  return { ...active.data, valid: false, reason, end: currentDocument(active.ctx) ? active.ctx.win.performance.now() : null, visibilityEnd: copy(active.ctx.visibility), environmentEnd: environment(active.ctx) };
}
function stopResponse(reason, termination) {
  if (!pending) return;
  const active = pending; pending = null;
  if (termination) active.data.termination = termination;
  clearTimeout(active.timeout);
  clearTimeout(active.observationTimer);
  if (currentDocument(active.ctx)) for (const id of active.rafs) active.ctx.win.cancelAnimationFrame(id);
  append("interactions", cancellationData(active, reason));
}
function stopCadence(reason) {
  if (!cadence) return;
  const active = cadence; cadence = null;
  clearTimeout(active.timeout); if (currentDocument(active.ctx)) active.ctx.win.cancelAnimationFrame(active.raf);
  append("cadence", { ...cancellationData(active, reason), summary: cadenceSummary(active.data.timestamps) });
  control("sample").disabled = !context;
}
function cancelActive(reason, termination) { clearTimeout(autoTimer); autoTimer = null; autoGeneration++; armed = null; stopResponse(reason, termination); stopCadence(reason); }
function setHeight() {
  frame.style.height = control("height").value === "fit" ? Math.max(240, Math.floor(innerHeight - frame.getBoundingClientRect().top - 20)) + "px" : control("height").value + "px";
}
function arm(kind, announce = true) {
  cancelActive("Rearmed before the prior check completed"); refreshVisibility("arm");
  if (!guard("arm response", true)) return;
  refreshTargets(context);
  armed = { kind, phase: control("phase").value, scenario: scenario(context), environment: environment(context), targets: context.targets };
  if (announce) say(`Armed ${armed.phase} ${kind} response. Use a visible changing control in the app frame.`);
}
function rejected(event, element, reason, disposition = "no-op") {
  const selected = armed;
  append("interactions", { id: `${context.id}-response-${++runSequence}`, loadId: context.id, kind: selected.kind, phase: selected.phase, action: label(element), event: event.type, key: event.key, trusted: event.isTrusted, valid: false, disposition, reason, at: context.win.performance.now(), visibilityStart: copy(context.visibility) });
  say(`${disposition}: ${reason}`);
}
function stateExpectation(ctx, element, before) {
  if (element.getAttribute("role") === "tab") return { type: "tab", before: before.selected, expected: "true", panel: element.getAttribute("aria-controls") };
  if (element.matches(".concept-card")) return { type: "concept", before: before.pressed, expected: "true", name: clean(element.querySelector(".concept-name")?.textContent) };
  if (element.closest(".map-view") && element.hasAttribute("aria-pressed")) return { type: "perspective", before: before.pressed, expected: "true" };
  if (element.matches('input[type="checkbox"][aria-label="Study envelope"]')) return { type: "envelope", before: before.checked, expected: !before.checked };
  if (label(element) === "Close sources") return { type: "dialog", before: ctx.doc.querySelector("dialog.sources-dialog")?.open, expected: false };
  if (element.matches(".check-row") || ["Sources", "Review rules & study limitations", "Data & methodology"].includes(label(element))) return { type: "dialog", before: ctx.doc.querySelector("dialog.sources-dialog")?.open, expected: true };
  return null;
}
function stateReady(active) {
  const { element, expected, ctx } = active;
  if (expected.type === "tab") {
    const panel = ctx.doc.getElementById(expected.panel);
    return element.getAttribute("aria-selected") === "true" && panel && !panel.hidden && panel.getAttribute("aria-labelledby") === element.id;
  }
  if (expected.type === "concept") {
    if (element.getAttribute("aria-pressed") !== "true" || !element.classList.contains("selected")) return false;
    const heading = ctx.doc.querySelector('#detail-overview:not([hidden]) .detail-heading h3');
    return !heading || clean(heading.textContent) === expected.name;
  }
  if (expected.type === "perspective") return element.getAttribute("aria-pressed") === "true";
  if (expected.type === "envelope") return element.checked === expected.expected;
  return ctx.doc.querySelector("dialog.sources-dialog")?.open === expected.expected;
}
function complete(observationBoundary = "results DOM mutation observer") {
  const active = pending;
  if (!active || active.finishing || active.ctx !== context) return;
  if (!currentDocument(active.ctx)) { stopResponse("App document changed before completion"); return; }
  if (!active.element.isConnected) { stopResponse("The target was replaced before completion"); return; }
  if (active.data.kind === "scenario") {
    const panel = active.ctx.doc.querySelector(".results-panel"), current = scenario(active.ctx);
    if (panel?.getAttribute("aria-busy") === "true") {
      active.sawBusy = true;
      if (active.roadWidthPending) {
        active.expected["road-width"] = current["road-width"]; active.data.expected = copy(active.expected); active.roadWidthPending = false;
      }
      return;
    }
    if (active.roadWidthPending) return;
    if (!sameScenario(current, active.expected)) { stopResponse("Scenario changed again before completion"); return; }
    if (!active.sawBusy || panel?.getAttribute("aria-busy") !== "false") return;
    if (active.ctx.doc.querySelector(".result-notice.error")) { stopResponse("Calculation error appeared"); return; }
    if (!active.ctx.doc.querySelector(".concept-card")) return;
  } else if (!stateReady(active)) return;
  clearTimeout(active.observationTimer);
  active.finishing = true; active.data.readyAt = active.ctx.win.performance.now();
  active.data.readyObservationBoundary = observationBoundary;
  active.data.inputToReadyMs = active.data.readyAt - active.data.start;
  active.rafs.push(active.ctx.win.requestAnimationFrame(timestamp => {
    if (pending !== active || context !== active.ctx || !currentDocument(active.ctx)) return;
    active.data.frameProgress.push({ phase: "first after readiness", timestamp, at: active.ctx.win.performance.now() });
    active.rafs.push(active.ctx.win.requestAnimationFrame(timestamp => {
      if (pending !== active || context !== active.ctx) return;
      if (!currentDocument(active.ctx)) { stopResponse("App document changed before the frame opportunity"); update(); return; }
      if (active.data.kind === "scenario" && !sameScenario(scenario(active.ctx), active.expected)) { stopResponse("Scenario changed before the frame opportunity"); return; }
      if (active.data.kind === "state" && !stateReady(active)) { stopResponse("Selected state changed before the frame opportunity"); return; }
      const end = active.ctx.win.performance.now(), problem = visibilityProblem(active.ctx.visibility);
      if (problem) { stopResponse(problem); return; }
      active.data.frameProgress.push({ phase: "second after readiness", timestamp, at: end });
      clearTimeout(active.timeout); clearTimeout(active.observationTimer); pending = null;
      const display = active.ctx.doc.querySelector(".result-status>span:last-child");
      append("interactions", { ...active.data, valid: true, end, frameTimestamp: timestamp, inputToReadyMs: active.data.readyAt - active.data.start, inputToFrameOpportunityMs: end - active.data.start, observedScenario: scenario(active.ctx), visibilityEnd: copy(active.ctx.visibility), environmentEnd: environment(active.ctx), workerDisplay: display?.matches(".status-dot") ? null : clean(display?.textContent) });
      const kind = active.data.kind; say(`${active.data.phase} ${kind} response recorded.`);
      if (control("auto").checked) {
        const generation = autoGeneration;
        autoTimer = setTimeout(() => {
          autoTimer = null;
          if (generation === autoGeneration && control("auto").checked && context === active.ctx && currentDocument(active.ctx) && !armed && !pending && !cadence) arm(kind);
        }, 0);
      }
    }));
  }));
}
function handleEvent(event) {
  const ctx = context;
  if (!ctx || !event.isTrusted || !(event.target instanceof ctx.win.Element)) return;
  const capturedAt = ctx.win.performance.now();
  const element = event.target.closest("input,select,button");
  if (!element) return;
  if (pending) {
    const continuation = element === pending.element && ["input", "change"].includes(event.type) && (pending.data.kind === "scenario" && pending.data.event === "keydown" && sameScenario(scenario(ctx), pending.expected) || pending.data.kind === "state" && pending.expected.type === "envelope" && element.checked === pending.expected.expected);
    if (!continuation) {
      const termination = { type: event.type, key: event.key, repeat: event.repeat, trusted: event.isTrusted, eventTimestamp: event.timeStamp, capturedAt, targetId: element.id, targetLabel: label(element), targetValue: element.value, sameTarget: element === pending.element, observedScenario: scenario(ctx), expectedScenario: copy(pending.expected), sawBusy: pending.sawBusy, finishing: pending.finishing, frameProgress: copy(pending.data.frameProgress) };
      cancelActive("Superseded by another native control action", termination); say("Response invalid: another control action arrived.");
    }
    return;
  }
  if (!armed || cadence) return;
  const isRangeKey = event.type === "keydown" && element.matches('input[type="range"]'), isUse = event.type === "click" && element.closest(".building-use"), isRoad = event.type === "change" && element.matches("select#road");
  if (armed.kind === "scenario" && !isRangeKey && !isUse && !isRoad || armed.kind === "state" && event.type !== "click") return;
  const before = armed.targets.get(element);
  if (!before?.visible || visibilityProblem(ctx.visibility)) { rejected(event, element, "Target or frame is not fully visible", "invalid setup"); return; }
  const baseline = armed.scenario;
  let expected;
  if (armed.kind === "scenario") {
    expected = { ...baseline };
    if (isRangeKey) {
      const next = nextRangeValue(element, event.key);
      if (next === null) { rejected(event, element, "Key does not change this range", "ignored key"); return; }
      if (next === Number(element.value)) { rejected(event, element, "Range is already at this limit"); return; }
      if (!sameScenario(scenario(ctx), baseline)) { rejected(event, element, "Scenario differs from the armed baseline; rearm", "invalid setup"); return; }
      expected[element.id] = next;
    } else if (isUse) {
      if (element.getAttribute("aria-pressed") === "true") { rejected(event, element, "Building use is already selected"); return; }
      if (!sameScenario(scenario(ctx), baseline)) { rejected(event, element, "Scenario differs from the armed baseline; rearm", "invalid setup"); return; }
      expected.use = clean(element.textContent);
    } else {
      if (element.value === baseline.road) { rejected(event, element, "Road choice did not change"); return; }
      expected.road = element.value;
      if (!sameScenario(scenario(ctx), expected)) { rejected(event, element, "Another scenario field changed before road selection", "invalid setup"); return; }
    }
  } else {
    expected = stateExpectation(ctx, element, before);
    if (!expected) { rejected(event, element, "This control has no supported timing predicate", "unsupported control"); return; }
    if (expected.before === expected.expected) { rejected(event, element, "This state is already selected"); return; }
  }
  const selected = armed; armed = null;
  const start = capturedAt;
  pending = { ctx, element, expected, roadWidthPending: isRoad, sawBusy: false, finishing: false, rafs: [], data: { id: `${ctx.id}-response-${++runSequence}`, loadId: ctx.id, kind: selected.kind, phase: selected.phase, action: label(element), event: event.type, key: event.key, trusted: true, start, startBoundary: event.type === "change" ? "trusted change capture after selection" : "trusted event capture", environment: selected.environment, visibilityStart: copy(ctx.visibility), visibilityHistory: [], frameProgress: [], expected: copy(expected) } };
  pending.timeout = setTimeout(() => { if (pending?.data.start === start && pending.ctx === ctx) { stopResponse("Expected response did not complete within five seconds"); say("Response timed out."); } }, 5000);
  const active = pending;
  if (selected.kind === "state") active.observationTimer = setTimeout(() => {
    if (pending !== active || context !== ctx || !currentDocument(ctx)) return;
    active.data.postDispatchObservationAt = ctx.win.performance.now();
    complete("post-dispatch zero-delay task");
  }, 0);
  pending.rafs.push(ctx.win.requestAnimationFrame(timestamp => {
    if (pending !== active || context !== ctx || !currentDocument(ctx)) return;
    active.data.frameProgress.push({ phase: "initial response observation", timestamp, at: ctx.win.performance.now() });
    complete("initial animation callback");
  }));
}
function startCadence() {
  cancelActive("A cadence sample replaced the previous check"); refreshVisibility("cadence start");
  if (!guard("sample cadence", true)) return;
  const ctx = context;
  const data = { id: `${ctx.id}-cadence-${++runSequence}`, loadId: ctx.id, phase: control("phase").value, label: control("cadence-label").value, warmupMs: 2000, requestedMeasurementMs: 10000, environment: environment(ctx), visibilityStart: copy(ctx.visibility), visibilityHistory: [], timestamps: [] };
  say(`Collecting ${data.phase} ${data.label} cadence: two seconds warmup, then ten seconds. Keep the entire frame visible.`);
  const active = { ctx, data, raf: null, start: ctx.win.performance.now() }; data.start = active.start; cadence = active; control("sample").disabled = true;
  active.timeout = setTimeout(() => { if (cadence === active) { stopCadence("Cadence watchdog expired before animation callbacks completed"); say("Cadence timed out and was recorded invalid."); } }, 15000);
  function tick(timestamp) {
    if (cadence !== active || context !== ctx) return;
    if (!currentDocument(ctx)) { stopCadence("App document changed during cadence"); update(); return; }
    const elapsed = ctx.win.performance.now() - active.start;
    if (elapsed >= data.warmupMs) data.timestamps.push(timestamp);
    if (elapsed < data.warmupMs + data.requestedMeasurementMs) { active.raf = ctx.win.requestAnimationFrame(tick); return; }
    clearTimeout(active.timeout); cadence = null; control("sample").disabled = false;
    const summary = cadenceSummary(data.timestamps), problem = visibilityProblem(ctx.visibility);
    const sameViewport = data.environment.width === ctx.win.innerWidth && data.environment.height === ctx.win.innerHeight;
    const valid = !problem && sameViewport && summary.monotonic && summary.intervals > 0 && summary.elapsedMs >= 9800 && elapsed <= 14000;
    append("cadence", { ...data, end: ctx.win.performance.now(), valid, reason: valid ? null : problem || "Viewport or observation interval changed", visibilityEnd: copy(ctx.visibility), environmentEnd: environment(ctx), summary });
    say(`Cadence recorded: ${summary.intervals} intervals; valid=${valid}.`);
  }
  active.raf = ctx.win.requestAnimationFrame(tick);
}
function audit() {
  cancelActive("Layout audit replaced an active check"); refreshVisibility("layout audit");
  if (!guard("audit layout")) { append("layout", { valid: false, reason: readinessProblem(context), loadId: context?.id }); update(); return; }
  const { win, doc } = context, width = doc.documentElement.clientWidth;
  const visible = element => { const s = win.getComputedStyle(element); return s.display !== "none" && s.visibility !== "hidden" && element.getClientRects().length; };
  const outside = [...doc.querySelectorAll("body *")].filter(visible).filter(element => {
    if (element.closest(".maplibregl-canvas-container,.maplibregl-marker,.floor-table-wrap")) return false;
    for (let p = element.parentElement; p && p !== doc.body; p = p.parentElement) if (["auto", "scroll", "hidden", "clip"].includes(win.getComputedStyle(p).overflowX)) return false;
    const r = element.getBoundingClientRect(); return r.left < -1 || r.right > width + 1;
  }).slice(0, 30).map(element => { const r = element.getBoundingClientRect(); return { element: label(element), className: typeof element.className === "string" ? element.className : "", left: r.left, right: r.right }; });
  const overlaps = [[".envelope-toggle", ".map-fit"], [".brand", ".header-context"], [".header-context", ".header-actions"]].flatMap(([a, b]) => {
    const x = doc.querySelector(a), y = doc.querySelector(b);
    if (!x || !y || !visible(x) || !visible(y)) return [];
    const r = x.getBoundingClientRect(), s = y.getBoundingClientRect();
    return Math.min(r.right, s.right) > Math.max(r.left, s.left) + 1 && Math.min(r.bottom, s.bottom) > Math.max(r.top, s.top) + 1 ? [{ a, b }] : [];
  });
  const rectangles = [".app-header", ".brand", ".brand-symbol", ".header-context", ".header-actions", ".header-actions button", ".envelope-toggle", ".map-fit"].flatMap(selector => [...doc.querySelectorAll(selector)].map(element => {
    const r = element.getBoundingClientRect(), s = win.getComputedStyle(element);
    return { selector, element: label(element), x: r.x, y: r.y, width: r.width, height: r.height, display: s.display, visibility: s.visibility, overflowX: s.overflowX, overflowY: s.overflowY, clip: s.clip, clipPath: s.clipPath, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, flexShrink: s.flexShrink };
  }));
  const value = { valid: true, environment: environment(context), pageScrollWidth: doc.documentElement.scrollWidth, bodyScrollWidth: doc.body.scrollWidth, horizontalOverflow: doc.documentElement.scrollWidth > width + 1, outside, overlaps, rectangles, limits: "Diagnostics skip intentional clipped/scrolling descendants; native workflows and screenshots remain required." };
  append("layout", value); say(`Layout audit: ${value.horizontalOverflow || outside.length || overlaps.length ? "review findings" : "no detected overflow or overlap"} at ${width} client px.`);
}
function editingSnapshot(ctx) {
  const rect = selector => {
    const r = ctx.doc.querySelector(selector)?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom } : null;
  };
  return { loadId: ctx.id, at: new Date().toISOString(), viewport: { width: ctx.win.innerWidth, height: ctx.win.innerHeight }, scrollY: ctx.win.scrollY, focusedElement: label(ctx.doc.activeElement), focusedClass: ctx.doc.activeElement?.className, canvas: rect(".maplibregl-canvas"), cancel: rect(".map-draw-cancel"), drawing: !!ctx.doc.querySelector(".drawing-hint"), plot: clean(ctx.doc.querySelector(".plot-area")?.textContent), sliders: [...ctx.doc.querySelectorAll('input[type="range"]')].map(input => ({ id: input.id, height: input.getBoundingClientRect().height })) };
}
function inspectEditing() {
  if (!context || !currentDocument(context)) { say("The app document is unavailable."); return; }
  append("editing", editingSnapshot(context)); say("Editing position and focus recorded. This does not complete a pointer drawing test.");
}
async function testGraphicsRecovery() {
  cancelActive("Graphics recovery replaced an active timing check");
  if (!guard("test graphics recovery")) return;
  const ctx = context, canvas = ctx.doc.querySelector(".maplibregl-canvas");
  const data = { loadId: ctx.id, start: new Date().toISOString(), valid: false, lostEvent: false, restoredEvent: false, suspendedControls: false, errorsBefore: records.errors.length };
  const lost = () => { data.lostEvent = true; };
  const restored = () => { data.restoredEvent = true; };
  let extension;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const drawingReady = () => [...ctx.doc.querySelectorAll(".draw-actions button")].some(button => clean(button.textContent) === "Draw plot" && !button.disabled);
  control("map-recovery").disabled = true;
  try {
    const gl = canvas?.getContext("webgl2");
    extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("The current renderer does not expose WEBGL_lose_context.");
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    say("Testing real graphics context loss, then restoration. Timing samples are cancelled.");
    extension.loseContext();
    await delay(1000);
    if (!currentDocument(ctx)) throw new Error("The app document changed during context loss.");
    data.suspendedControls = !drawingReady();
    extension.restoreContext();
    const deadline = performance.now() + 20000;
    while (currentDocument(ctx) && performance.now() < deadline && (!data.restoredEvent || !drawingReady())) await delay(200);
    if (!currentDocument(ctx)) throw new Error("The app document changed during recovery.");
    data.after = editingSnapshot(ctx);
    data.ready = drawingReady();
    data.newErrors = records.errors.slice(data.errorsBefore);
    data.valid = data.lostEvent && data.restoredEvent && data.suspendedControls && data.ready && data.newErrors.length === 0;
    if (!data.valid) data.reason = "Loss, control suspension, recovery, or error-free restoration was not observed.";
  } catch (error) { data.reason = error.message; }
  finally {
    if (extension && !data.restoredEvent) extension.restoreContext();
    canvas?.removeEventListener("webglcontextlost", lost);
    canvas?.removeEventListener("webglcontextrestored", restored);
    data.end = new Date().toISOString(); append("recovery", data);
    control("map-recovery").disabled = false;
    say(`Graphics recovery recorded: valid=${data.valid}${data.reason ? `; ${data.reason}` : ""}.`);
  }
}
function observeExports(ctx, listen) {
  const urls = new Map(), { win, doc } = ctx;
  let exportSequence = 0, lastActivation = null;
  const activation = () => ({ isActive: win.navigator.userActivation?.isActive ?? null, hasBeenActive: win.navigator.userActivation?.hasBeenActive ?? null });
  listen(doc, "click", event => {
    const button = event.target instanceof win.Element ? event.target.closest("button") : null;
    if (!button || clean(button.textContent) !== "Export study") return;
    lastActivation = { id: `${ctx.id}-export-${++exportSequence}`, loadId: ctx.id, phase: "native button activation", trusted: event.isTrusted, at: win.performance.now(), timeOrigin: ctx.timeOrigin, userActivation: activation(), disabled: button.disabled, evidence: "Observed button event; file delivery is unverified." };
    append("exports", lastActivation);
  }, true);
  const urlDescriptor = Object.getOwnPropertyDescriptor(win.URL, "createObjectURL"), originalURL = win.URL.createObjectURL;
  function observedURL(...args) {
    const url = Reflect.apply(originalURL, this, args);
    const blob = args[0];
    if (blob instanceof win.Blob && blob.type.split(";")[0].trim() === "application/json") {
      const record = { id: lastActivation?.id || `${ctx.id}-export-${++exportSequence}`, loadId: ctx.id, phase: "JSON Blob URL created", at: win.performance.now(), timeOrigin: ctx.timeOrigin, url, size: blob.size, mime: blob.type, userActivation: activation(), textStatus: "pending", evidence: "Actual application Blob retained for inspection; file delivery is unverified." };
      urls.set(url, record); append("exports", record);
      blob.text().then(text => { record.text = text; record.textStatus = "read"; update(); }, error => { record.textStatus = "failed"; record.textError = String(error); update(); });
    }
    return url;
  }
  const proto = win.HTMLAnchorElement.prototype, clickDescriptor = Object.getOwnPropertyDescriptor(proto, "click"), originalClick = proto.click;
  function observedClick(...args) {
    const created = urls.get(this.href);
    if (created) append("exports", { id: created.id, loadId: ctx.id, phase: "application anchor.click invoked", at: win.performance.now(), timeOrigin: ctx.timeOrigin, href: this.href, download: this.download, connected: this.isConnected, userActivation: activation(), evidence: "Original click delegated unchanged; actual local download is unverified." });
    return Reflect.apply(originalClick, this, args);
  }
  Object.defineProperty(win.URL, "createObjectURL", { ...urlDescriptor, value: observedURL });
  Object.defineProperty(proto, "click", { ...(clickDescriptor || { configurable: true, enumerable: false, writable: true }), value: observedClick });
  return () => {
    if (win.URL.createObjectURL === observedURL) Object.defineProperty(win.URL, "createObjectURL", urlDescriptor);
    if (proto.click === observedClick) { if (clickDescriptor) Object.defineProperty(proto, "click", clickDescriptor); else delete proto.click; }
  };
}
function attach() {
  cancelActive("App document loaded or navigated"); context?.cleanup(); context = null; enabled(false);
  try {
    const win = frame.contentWindow, doc = win.document;
    if (win.location.href !== target.href) throw new Error("The frame navigated away from the expected production app.");
    const ctx = { id: `load-${++loadSequence}`, timeOrigin: win.performance.timeOrigin, win, doc, targets: new Map(), visibility: null, cleanup: () => {} }; context = ctx; refreshVisibility("load");
    const removers = [], observers = [];
    const listen = (source, type, fn, options) => { source.addEventListener(type, fn, options); removers.push(() => source.removeEventListener(type, fn, options)); };
    removers.push(observeExports(ctx, listen));
    const mutation = new win.MutationObserver(() => complete("results DOM mutation observer"));
    mutation.observe(doc.querySelector(".results-panel") || doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy", "aria-selected", "aria-pressed", "hidden"] }); observers.push(mutation);
    for (const type of ["click", "keydown", "input", "change"]) listen(doc, type, handleEvent, true);
    listen(doc, "visibilitychange", () => refreshVisibility("child visibility"));
    listen(doc, "scroll", () => { if (pending) { cancelActive("App scrolled during a response sample"); say("Response invalid: the app scrolled."); } if (armed) { refreshTargets(ctx); armed.targets = ctx.targets; } }, true);
    listen(win, "resize", () => { cancelActive("App viewport changed during a check"); refreshVisibility("child resize"); say("App viewport changed. Rearm after layout settles."); });
    listen(win, "pagehide", () => { cancelActive("App document left during a check"); armed = null; enabled(false); update(); });
    listen(win, "error", event => { append("errors", { loadId: ctx.id, message: event.message, at: win.performance.now() }); update(); });
    const types = win.PerformanceObserver?.supportedEntryTypes || [];
    if (types.includes("event")) {
      const obs = new win.PerformanceObserver(list => { for (const e of list.getEntries()) append("events", { loadId: ctx.id, timeOrigin: win.performance.timeOrigin, type: "event", thresholdMs: 16, name: e.name, start: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd, interactionId: e.interactionId, target: label(e.target) }); });
      obs.observe({ type: "event", durationThreshold: 16 }); observers.push(obs);
    }
    if (types.includes("long-animation-frame")) {
      const obs = new win.PerformanceObserver(list => { for (const e of list.getEntries()) append("longFrames", { loadId: ctx.id, timeOrigin: win.performance.timeOrigin, start: e.startTime, duration: e.duration, blockingDuration: e.blockingDuration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, presentationTime: e.presentationTime, paintTime: e.paintTime }); });
      obs.observe({ type: "long-animation-frame" }); observers.push(obs);
    }
    ctx.cleanup = () => { for (const remove of removers) { try { remove(); } catch (error) { append("errors", { loadId: ctx.id, message: `Listener cleanup: ${error.message}` }); } } for (const obs of observers) obs.disconnect(); };
    append("loads", environment(ctx)); enabled(true); say(readinessProblem(ctx) ? "Production document loaded. Map and concepts must settle before checks are accepted." : "Production app ready for warmup checks.");
  } catch (error) { append("errors", { message: error.message, at: new Date().toISOString() }); say(`App cannot be checked: ${error.message}`); }
}
frame.addEventListener("load", attach);
for (const id of ["width", "height"]) control(id).addEventListener("change", () => {
  cancelActive("Viewport configuration changed during a check"); frame.style.width = control("width").value + "px"; setHeight(); refreshVisibility("viewport control"); say("Viewport changed. Wait for map resize and warm up before rearming.");
});
for (const id of ["phase", "cadence-label"]) control(id).addEventListener("change", () => { cancelActive("Measurement phase or label changed during a check"); say("Phase or label changed. Rearm the next check."); });
document.addEventListener("visibilitychange", () => { refreshVisibility("parent visibility"); update(); });
window.addEventListener("scroll", () => { refreshVisibility("parent scroll"); update(); }, true);
window.addEventListener("resize", () => { cancelActive("Host viewport changed during a check"); setHeight(); refreshVisibility("host resize"); say("Host viewport changed. Rearm after it settles."); });
const intersection = new IntersectionObserver(() => refreshVisibility("frame intersection"), { threshold: [0, 0.98, 1] }); intersection.observe(frame);
control("audit").onclick = audit;
control("inspect-editing").onclick = inspectEditing;
control("map-recovery").onclick = testGraphicsRecovery;
control("arm-scenario").onclick = () => arm("scenario"); control("arm-state").onclick = () => arm("state"); control("sample").onclick = startCadence;
control("cancel").onclick = () => { cancelActive("Cancelled by the checking utility"); say("Active checks cancelled; their records remain available."); };
control("refresh").onclick = () => { if (pending || cadence) return; update(); };
control("clear").onclick = () => {
  if (pending || cadence || armed) { cancelActive("Cancelled before clearing records"); say("Active checks cancelled and preserved. Click Clear again to remove timing records."); return; }
  records.resets.push({ at: new Date().toISOString(), interactions: records.interactions.length, cadence: records.cadence.length, events: records.events.length, longFrames: records.longFrames.length });
  for (const key of ["interactions", "cadence", "events", "longFrames"]) records[key] = [];
  say("Timing records cleared. Load, layout and reset metadata remain.");
};
setHeight(); frame.src = target.href; update();
