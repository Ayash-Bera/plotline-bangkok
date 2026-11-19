"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadSite } from "@/lib/site";
import { RULE_SOURCES } from "@/lib/rules";
import { formatCheckMetrics } from "@/lib/check-metrics";
import { useAnalysis } from "@/lib/use-analysis";
import type { AnalysisRequest, BuildingType, CheckStatus, GeometryStage, PlotFeature, RuleCheck, SiteData } from "@/lib/domain";
import { SiteMap, type SiteMapHandle } from "@/components/site-map";
import { downloadJson } from "@/lib/download-json";
import { SourcesDialog } from "@/components/sources-dialog";
import { RuleEffects } from "@/components/rule-effects";
import { Icon } from "@/components/icon";

const number = (value: number, digits = 0) => value.toLocaleString("en-US", { maximumFractionDigits: digits });
const displayHundredths = (value: number) => (value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type DetailTab = "overview" | "effects" | "checks" | "floors";
const labels: Record<CheckStatus, string> = { pass: "Pass", fail: "Does not pass", unknown: "Unverified", unsupported: "Outside scope" };

function RangeField({ id, label, value, min, max, step, unit, onChange, note }: { id: string; label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void; note?: string }) {
  return <div className="range-field"><div className="field-heading"><label htmlFor={id}>{label}</label><output htmlFor={id}>{number(value, 2)} <span>{unit}</span></output></div><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} style={{ "--range-fill": `${(value - min) / (max - min) * 100}%` } as React.CSSProperties}/><div className="range-limits"><span>{min} {unit}</span><span>{max} {unit}</span></div>{note && <p className="field-note">{note}</p>}</div>;
}

function CheckRow({ check, onSource }: { check: RuleCheck; onSource: (id: string) => void }) {
  const metrics = formatCheckMetrics(check);
  return <button className="check-row" onClick={() => onSource(check.sourceId)}><span className={`check-icon ${check.status}`}><Icon name={check.status === "pass" ? "check" : "info"} size={13}/></span><span className="check-copy"><strong>{check.label}</strong><span className="check-measurements">{metrics.measurement !== null ? <><span><b>Measured</b> {metrics.measurement}</span>{metrics.requirement !== null && <span>{metrics.requirement}</span>}{metrics.margin !== null && <span><b>Margin</b> {metrics.margin}</span>}</> : <span>No numerical measurement supplied.</span>}</span><span>{check.details}</span><em className={`check-status ${check.status}`}>{labels[check.status]}</em></span><Icon name="chevron" size={14}/></button>;
}

export default function Home() {
  const [site, setSite] = useState<SiteData | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [plot, setPlot] = useState<PlotFeature | null>(null);
  const [roadId, setRoadId] = useState("");
  const [roadWidth, setRoadWidth] = useState(12);
  const [buildingType, setBuildingType] = useState<BuildingType>("condo");
  const [storeyHeight, setStoreyHeight] = useState(3.2);
  const [heightLimit, setHeightLimit] = useState(22.7);
  const [permeableFraction, setPermeableFraction] = useState(0.6);
  const [selectedId, setSelectedId] = useState<"broad" | "slender">("broad");
  const [tab, setTab] = useState<DetailTab>("overview");
  const [inspection, setInspection] = useState<{ revision: number; id: GeometryStage["id"] } | null>(null);
  const [plan, setPlan] = useState(false);
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceFocus, setSourceFocus] = useState<string | undefined>();
  const map = useRef<SiteMapHandle>(null);
  const previousPlot = useRef<PlotFeature | null>(null);

  useEffect(() => {
    let active = true;
    loadSite().then(data => { if (!active) return; setSite(data); setPlot(data.defaultPlot); setRoadId(data.roadsCatalog[0]?.id || ""); setRoadWidth(data.roadsCatalog[0]?.width || 12); setSiteError(null); }).catch(error => { if (active) setSiteError(error instanceof Error ? error.message : "Site data could not be loaded."); });
    return () => { active = false; };
  }, [retry]);

  const catalogRoad = site?.roadsCatalog.find(road => road.id === roadId);
  const request = useMemo<Omit<AnalysisRequest, "revision"> | null>(() => site && plot && catalogRoad ? { plot, road: { ...catalogRoad, width: roadWidth, widthEvidence: roadWidth === catalogRoad.width ? catalogRoad.widthEvidence : "scenario" }, buildingType, storeyHeight, heightLimit, permeableFraction, zone: site.zone } : null, [site, plot, catalogRoad, roadWidth, buildingType, storeyHeight, heightLimit, permeableFraction]);
  const { result: latestResult, busy, error, retry: retryCalculation } = useAnalysis(request);
  const result = request && !busy && !error ? latestResult : null;
  const unsupportedLabel = result?.unsupportedCause === "search" ? "Bounded search found no concept" : result?.unsupportedCause === "road" ? "Road scenario is outside study scope" : "Outside the supported study area";
  const selectedConcept = result?.concepts.find(concept => concept.id === selectedId) || result?.concepts[0] || null;
  const geometryStages = result && result.status !== "invalid" && (result.status !== "unsupported" || result.unsupportedCause === "search") ? result.geometryStages || [] : [];
  const inspectedStage = mapReady && !drawing && plan && result && inspection?.revision === result.revision ? geometryStages.find(stage => stage.id === inspection.id) || null : null;
  const tabs: DetailTab[] = selectedConcept ? ["overview", "effects", "checks", "floors"] : geometryStages.length ? ["effects", "checks"] : ["checks"];
  const visibleTab = tabs.includes(tab) ? tab : tabs[0];
  const selectTab = (value: DetailTab) => { setTab(value); if (value !== "effects") setInspection(null); };
  const navigateTabs = (event: React.KeyboardEvent<HTMLButtonElement>, value: DetailTab) => {
    const index = tabs.indexOf(value);
    const target = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    selectTab(tabs[target]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  };
  const inspectStage = (stage: GeometryStage) => { if (!result || !mapReady) return; setInspection({ revision: result.revision, id: stage.id }); setPlan(true); };
  const checks = Array.from(new Map([...(result?.checks || []), ...(selectedConcept?.checks || [])].map(check => [check.id, check])).values());
  const ledger = (selectedConcept?.floors || []).map(floor => ({ ...floor, areaHundredths: Math.round(floor.area * 100), countedHundredths: Math.round(floor.countedArea * 100) }));
  const ledgerArea = ledger.reduce((sum, floor) => sum + floor.areaHundredths, 0);
  const ledgerCounted = ledger.reduce((sum, floor) => sum + floor.countedHundredths, 0);
  const selectRoad = (id: string) => { const road = site?.roadsCatalog.find(item => item.id === id); if (road) { setRoadId(id); setRoadWidth(road.width); } };
  const source = (id?: string) => { setSourceFocus(id); setSourceOpen(true); };
  const drawPlot = () => { if (!mapReady) return; setInspection(null); previousPlot.current = plot; setDrawing(true); setPlan(true); setPlot(null); map.current?.command("draw"); };
  const cancelDraw = () => { setDrawing(false); setPlot(previousPlot.current); setTimeout(() => map.current?.command("cancel"), 0); };
  const resetPlot = () => { if (!site || !mapReady) return; setInspection(null); setDrawing(false); setPlot(site.defaultPlot); map.current?.command("reset"); };
  const onMapReadyChange = useCallback((ready: boolean) => {
    setMapReady(ready);
    if (!ready) {
      setInspection(null);
      if (drawing) setPlot(previousPlot.current);
      setDrawing(false);
    }
  }, [drawing]);
  const exportStudy = () => {
    if (!request || !result) return;
    const study = { title: "Plotline Bangkok concept study", exportedAt: new Date().toISOString(), legalStatus: "Concept study, not permit approval", scenario: request, result, sources: RULE_SOURCES, context: site?.metadata };
    downloadJson(study, `plotline-study-${new Date().toISOString().slice(0, 10)}.json`);
  };

  useEffect(() => {
    if (!drawing || sourceOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawing(false);
      setPlot(previousPlot.current);
      setTimeout(() => map.current?.command("cancel"), 0);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [drawing, sourceOpen]);

  return <main className="workbench">
    <header className="app-header"><Link href="/" className="brand" aria-label="Plotline home"><span className="brand-symbol"><Icon name="layers" size={23}/></span><span>plotline<span className="brand-period">.</span></span></Link><div className="header-divider"/><span className="product-label">Feasibility workspace</span><div className="header-context"><span className="tiny-dot"/>Bangkok<span className="context-divider">/</span><strong>ย.3-29</strong><span className="zone-pill">Residential</span></div><div className="header-actions"><button className="button button-quiet" aria-label="Sources" onClick={() => source()}><Icon name="book" size={16}/><span>Sources</span></button><button className="button button-primary" onClick={exportStudy} disabled={!result}><Icon name="download" size={16}/><span>Export study</span></button></div></header>
    <div className="workspace-body">
      <aside className="input-panel" aria-label="Scenario inputs">
        <div className="panel-title"><div><span className="eyebrow">01 / DEFINE</span><h1>Your site, explored.</h1></div><span className="small-square"><Icon name="draw" size={19}/></span></div>
        <section className="input-section"><div className="section-heading"><h2>Plot boundary</h2><button className="text-button" onClick={resetPlot} disabled={!site || !mapReady} aria-label="Reset plot boundary"><Icon name="reset" size={13}/>Reset</button></div><div className="plot-area"><span>{result ? number(result.plotArea) : busy ? "Calculating" : plot ? "Plot selected" : "No boundary"}</span>{result && <small>m² site area</small>}</div><p className="field-note">Start with the study plot or draw your own boundary on the map.</p><div className="draw-actions"><button className={`button ${drawing ? "button-primary" : "button-outline"}`} onClick={drawing ? cancelDraw : drawPlot} disabled={!drawing && (!site || !mapReady)}><Icon name={drawing ? "close" : "draw"} size={16}/>{drawing ? "Cancel drawing" : "Draw plot"}</button><button className="button button-outline" onClick={() => { setInspection(null); setPlan(true); map.current?.command("edit"); }} disabled={!plot || drawing || !mapReady}><Icon name="edit" size={15}/>Edit</button></div></section>
        <section className="input-section"><h2>Development scenario</h2><label className="field-label" id="building-type-label">Building use</label><div className="segmented building-use" role="group" aria-labelledby="building-type-label"><button className={buildingType === "condo" ? "active" : ""} onClick={() => setBuildingType("condo")} aria-pressed={buildingType === "condo"}>Condominium</button><button className={buildingType === "office" ? "active" : ""} onClick={() => setBuildingType("office")} aria-pressed={buildingType === "office"}>Office</button></div><label className="field-label" htmlFor="road">Fronting road</label><select id="road" value={roadId} onChange={event => selectRoad(event.target.value)} disabled={!site}>{!site && <option>Loading roads...</option>}{site?.roadsCatalog.map(road => <option value={road.id} key={road.id}>{road.name}</option>)}</select><div className="road-evidence"><span className={`evidence-dot ${request?.road.widthEvidence === "verified" ? "verified" : ""}`}/>{request?.road.widthEvidence === "verified" ? "Width supported by evidence" : "Legal width is a scenario assumption"}</div><RangeField id="road-width" label="Assumed legal road width" value={roadWidth} min={6} max={40} step={0.5} unit="m" onChange={setRoadWidth} note="Legal right of way, not the visible carriageway."/></section>
        <section className="input-section dimensional-section"><RangeField id="storey-height" label="Floor-to-floor height" value={storeyHeight} min={2.8} max={4} step={0.1} unit="m" onChange={setStoreyHeight}/><RangeField id="height-limit" label="Study height ceiling" value={heightLimit} min={12} max={22.7} step={0.1} unit="m" onChange={setHeightLimit}/><RangeField id="permeable-fraction" label="Permeable planted share of open space" value={permeableFraction * 100} min={50} max={100} step={5} unit="%" onChange={value => setPermeableFraction(value / 100)} note="Scenario area reserved for tree planting on permeable ground. Planting layout and qualification are unverified."/></section>
        <div className="scope-note"><Icon name="info" size={16}/><p>Early decisions, with a clear basis.<br/><button onClick={() => source()}>Review rules & study limitations</button></p></div>
      </aside>
      <section className="map-panel" aria-label="Site exploration">
        <div className="map-toolbar"><div><span className="eyebrow">BANGKOK STUDY AREA</span><h2>ย.3-29 <span>/ Site exploration</span></h2></div><div className="segmented map-view" role="group" aria-label="Map perspective"><button className={!plan ? "active" : ""} aria-pressed={!plan} onClick={() => { setInspection(null); setPlan(false); }}>3D</button><button className={plan ? "active" : ""} aria-pressed={plan} onClick={() => setPlan(true)}>Plan</button></div></div>
        <div className="map-container">{site && request?.road || site && catalogRoad ? <SiteMap ref={map} site={site!} plot={plot} road={request?.road || catalogRoad!} result={result} concept={selectedConcept} showEnvelope={showEnvelope} inspectedStage={inspectedStage} plan={plan} drawing={drawing} busy={busy} onPlotChange={setPlot} onRoadChange={selectRoad} onDrawingComplete={() => setDrawing(false)} onReadyChange={onMapReadyChange}/> : <div className="site-loading">{siteError ? <><Icon name="info" size={26}/><h3>Site data could not load</h3><p>{siteError}</p><button className="button button-primary" onClick={() => { setSiteError(null); setRetry(value => value + 1); }}>Retry site loading</button></> : <><span className="spinner"/><p>Opening the Bangkok study area</p></>}</div>}
          <div className="map-floating-controls">{inspectedStage ? <button className="button button-outline inspection-map-exit" onClick={() => setInspection(null)}><Icon name="close" size={14}/>Exit rule inspection</button> : <label className="envelope-toggle"><input type="checkbox" aria-label="Study envelope" aria-describedby={result?.envelopeSampling ? "envelope-approximation" : undefined} checked={showEnvelope} onChange={event => setShowEnvelope(event.target.checked)}/><span className="toggle-track"/><Icon name="layers" size={16}/><span className="envelope-toggle-copy">Study envelope{result?.envelopeSampling && <small className="envelope-approximation" id="envelope-approximation">{number(result.envelopeSampling.step, 2)} m steps; vertical sampling underfill &lt; {number(result.envelopeSampling.maxVerticalUnderfill, 2)} m</small>}</span></label>}<button className="icon-button map-fit" aria-label="Fit map to plot" disabled={!mapReady} onClick={() => map.current?.command("fit")}><Icon name="target" size={18}/></button></div>
          {inspectedStage ? <div className="concept-map-label inspection-map-label"><span className="tiny-dot"/>{inspectedStage.label}<span>{inspectedStage.id === "height" ? `Section at ${number(inspectedStage.elevation, 2)} m` : `${number(inspectedStage.area, 2)} m²`}</span></div> : selectedConcept && <div className="concept-map-label"><span className="tiny-dot"/>{selectedConcept.name}<span>{number(selectedConcept.height, 1)} m</span></div>}
        </div>
        <div className="map-footer"><span><Icon name="info" size={13}/>Concept study. Not permit approval.</span><button className="text-button" onClick={() => source()}>Data & methodology<Icon name="arrow" size={13}/></button></div>
      </section>
      <aside className="results-panel" aria-label="Feasibility results" aria-busy={busy}>
        <div className="results-heading"><span className="eyebrow">02 / COMPARE</span><h2>Room to build.</h2><p>Two ways to explore your site.</p></div>
        <div className="result-status" role="status" aria-live="polite"><span className={`status-dot ${busy || error || !result || result.status !== "ready" ? "pending" : ""}`}/>{drawing ? "Draw a complete boundary" : error ? "Calculation interrupted" : busy ? "Recalculating your scenario" : !result ? "Waiting for a complete scenario" : result.status === "ready" ? "Concepts calculated" : result.status === "unsupported" ? unsupportedLabel : result.status === "invalid" ? "Boundary needs attention" : "No feasible concept"}{result && <span>{number(result.calculationMs)} ms</span>}</div>
        {error && <div className="result-notice error"><strong>Calculation unavailable</strong><p>{error}</p><p>Retry the current scenario without changing the plot or inputs.</p><button className="button button-outline" onClick={retryCalculation} disabled={!request || busy}>Retry calculation</button></div>}
        {!error && result?.message && <div className="result-notice"><strong>{result.status === "ready" ? "Concept availability" : result.status === "invalid" ? "Review the boundary" : result.status === "unsupported" ? unsupportedLabel : "A constraint limits this plot"}</strong><p>{result.message}</p>{result.status !== "ready" && <button className="text-button" onClick={resetPlot} disabled={!mapReady}>Restore the study plot<Icon name="reset" size={13}/></button>}</div>}
        <div className="concept-list">{result?.concepts.map((concept, index) => <button key={concept.id} className={`concept-card ${selectedConcept?.id === concept.id ? "selected" : ""}`} onClick={() => { setInspection(null); setSelectedId(concept.id); }} aria-pressed={selectedConcept?.id === concept.id}><div className="concept-card-top"><span className="concept-index">0{index + 1}</span><span className="concept-name">{concept.name}</span><span className={`radio-dot ${selectedConcept?.id === concept.id ? "checked" : ""}`}/></div><div className="concept-main"><strong>{number(concept.gfa)}</strong><span>m² gross floor area</span><div className={`building-glyph ${concept.id}`} aria-hidden="true">{concept.floors.map(floor => <i key={floor.level}/>)}</div></div><div className="concept-mini-stats"><span><strong>{concept.floors.length}</strong> {concept.floors.length === 1 ? "floor" : "floors"}</span><span><strong>{number(concept.height, 1)}</strong> m high</span><span><strong>{result.plotArea > 0 ? number(concept.footprintArea / result.plotArea * 100) : 0}%</strong> cover</span></div><div className="concept-card-bottom"><span>{number(concept.openArea)} m² open space</span><span className={concept.feasible ? "feasible-label" : "constrained-label"}>{concept.feasible ? "Modelled checks pass" : "Review constraints"}</span></div></button>)}</div>
        {!result && !error && <div className="results-empty"><Icon name={busy ? "layers" : "building"} size={31}/><h3>{busy ? "Finding the buildable envelope" : drawing ? "A new plot, a fresh study" : "Your concepts appear here"}</h3><p>{busy ? "Geometry and rule checks are updating together." : drawing ? "Close your polygon on the map to calculate both concepts." : "Choose a road and complete a valid plot to explore its capacity."}</p></div>}
        {result && result.assumptions.length > 0 && <section className="study-assumptions" aria-label="Envelope assumptions"><span className="eyebrow">ENVELOPE ASSUMPTIONS</span>{result.assumptions.slice(0, 2).map(assumption => <p key={assumption}>{assumption}</p>)}{result.assumptions.length > 2 && <details><summary>All study assumptions ({result.assumptions.length})</summary><ul>{result.assumptions.slice(2).map(assumption => <li key={assumption}>{assumption}</li>)}</ul></details>}</section>}
        {result && <><div className="result-tabs" role="tablist" aria-label="Concept detail" aria-orientation="horizontal">{tabs.map(value => <button key={value} role="tab" id={`tab-${value}`} aria-selected={visibleTab === value} tabIndex={visibleTab === value ? 0 : -1} aria-controls={`detail-${value}`} className={visibleTab === value ? "active" : ""} onClick={() => selectTab(value)} onKeyDown={event => navigateTabs(event, value)}>{value === "effects" ? "Rule effects" : value[0].toUpperCase() + value.slice(1)}{value === "checks" && <span>{checks.length}</span>}</button>)}</div>{tabs.map(panel => <div key={panel} className="detail-content" role="tabpanel" tabIndex={0} hidden={visibleTab !== panel} id={`detail-${panel}`} aria-labelledby={`tab-${panel}`}>
          {panel === "overview" && selectedConcept && <><div className="detail-heading"><span className="eyebrow">SELECTED CONCEPT</span><h3>{selectedConcept.name}</h3><p>{selectedConcept.description}</p></div><dl className="metrics-list"><div><dt>Site area</dt><dd>{number(result.plotArea)} <span>m²</span></dd></div><div><dt>Buildable ground area</dt><dd>{number(result.buildableArea)} <span>m²</span></dd></div><div><dt>Floor area ratio</dt><dd>{number(selectedConcept.far, 2)} <span>/ {number(result.legalFar, 2)}</span></dd></div><div><dt>Open space ratio</dt><dd>{number(selectedConcept.osr * 100, 1)} <span>%</span></dd></div><div><dt>Assumed permeable planted area</dt><dd>{number(selectedConcept.permeableArea)} <span>m²</span></dd></div></dl><div className="constraint-box"><span className="eyebrow">WHAT SHAPES THIS CONCEPT</span>{selectedConcept.bindingConstraints.length ? selectedConcept.bindingConstraints.map(text => <p key={text}><span className="tiny-dot"/>{text}</p>) : <p>Review the individual rule checks for this scenario.</p>}</div><button className="detail-source-button" onClick={() => { setTab("checks"); }}><Icon name="book" size={16}/>Inspect the calculation basis<Icon name="arrow" size={15}/></button></>}
          {panel === "checks" && <div className="checks-content"><p className="detail-intro">Each status covers its named test only. Open a check for its source and limitations.</p>{checks.map(check => <CheckRow key={check.id} check={check} onSource={source}/>)}</div>}
          {panel === "effects" && <RuleEffects canInspect={mapReady} stages={geometryStages} budgets={selectedConcept?.budgetLimits || []} selectedStage={inspectedStage} onInspect={inspectStage} onExit={() => setInspection(null)} onSource={source}/>}
          {panel === "floors" && selectedConcept && <><p className="detail-intro">Floor area and counted gross floor area by level. Base and top are metres above the plot datum.</p><div className="floor-table-wrap"><table className="floor-table"><thead><tr><th>Level</th><th>Base m</th><th>Top m</th><th>Area m²</th><th>Counted m²</th></tr></thead><tbody>{ledger.map(floor => <tr key={floor.level}><td>{String(floor.level).padStart(2, "0")}</td><td>{number(floor.base, 1)}</td><td>{number(floor.base + floor.height, 1)}</td><td>{displayHundredths(floor.areaHundredths)}</td><td>{displayHundredths(floor.countedHundredths)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Display total</th><td>{displayHundredths(ledgerArea)}</td><td>{displayHundredths(ledgerCounted)}</td></tr></tfoot></table></div><p className="ledger-actual">Actual counted GFA: <strong>{number(selectedConcept.gfa, 6)} m²</strong></p><p className="field-note ledger-rounding">Areas display to 2 decimal places. Display totals sum those rounded rows. Rounding may make this display total slightly larger than the actual counted GFA. Cap checks and JSON export use unrounded values.</p><p className="field-note">Floor plates are a planning study. Detailed circulation and servicing are unresolved.</p></>}
        </div>)}</>}
        <div className="results-footnote"><Icon name="info" size={13}/>Road width and permeable planting are explicit assumptions.</div>
      </aside>
    </div>
    <SourcesDialog open={sourceOpen} onClose={() => setSourceOpen(false)} sources={RULE_SOURCES} site={site} focusId={sourceFocus}/>
  </main>;
}
