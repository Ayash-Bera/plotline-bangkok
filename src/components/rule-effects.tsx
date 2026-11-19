import type { BudgetLimit, GeometryStage } from "@/lib/domain";
import { RULE_SOURCES } from "@/lib/rules";
import { Icon } from "./icon";

const number = (value: number, digits = 2) => value.toLocaleString("en-US", { maximumFractionDigits: digits });

function SourceButton({ id, onSource }: { id: string; onSource: (id: string) => void }) {
  const source = RULE_SOURCES.find(item => item.id === id);
  return <button className="effect-source" onClick={() => onSource(id)}><Icon name="book" size={13}/><span>{source ? `${source.title}: ${source.clause}` : "Study source and assumptions"}</span><Icon name="chevron" size={12}/></button>;
}

export function RuleEffects({ canInspect, stages, budgets, selectedStage, onInspect, onExit, onSource }: { canInspect: boolean; stages: GeometryStage[]; budgets: BudgetLimit[]; selectedStage: GeometryStage | null; onInspect: (stage: GeometryStage) => void; onExit: () => void; onSource: (id: string) => void }) {
  const minimumBudget = budgets.length ? Math.min(...budgets.map(budget => budget.limit)) : null;
  return <div className="rule-effects">
    <p className="detail-intro">Follow the measured geometry in sequence. Select a stage to inspect its exact shape in Plan view.</p>
    {!canInspect && <p className="effect-caution inspection-unavailable" id="stage-map-unavailable" role="status">Map inspection is unavailable while the map is not ready. Measured areas and source actions remain available.</p>}
    {selectedStage && <button className="button button-outline inspection-exit" onClick={onExit}><Icon name="close" size={14}/>Return to concept comparison</button>}
    <section aria-labelledby="geometry-effects-heading"><h3 id="geometry-effects-heading" className="effects-heading">Geometry by rule</h3>
      {!stages.length && <p className="effect-empty">No geometry trace is available for this result.</p>}
      <ol className="geometry-stages">{stages.map((stage, index) => {
        const previous = stages[index - 1];
        const reduction = previous ? Math.max(0, previous.area - stage.area) : 0;
        const section = stage.id === "height";
        const empty = !stage.geometry || stage.area <= 0;
        return <li className={`geometry-stage ${selectedStage?.id === stage.id ? "selected" : ""}`} key={stage.id}>
          <button className="stage-select" disabled={!canInspect} aria-describedby={!canInspect ? "stage-map-unavailable" : undefined} onClick={() => onInspect(stage)} aria-pressed={selectedStage?.id === stage.id} aria-label={`Inspect ${stage.label}${section ? `, horizontal section at ${number(stage.elevation)} metres` : ""}${empty ? ", empty shape" : ""} in Plan view`}>
            <span className="stage-number">{index + 1}</span><span className="stage-copy"><strong>{stage.label}</strong><span>{section ? `Horizontal section at ${number(stage.elevation)} m` : `Ground geometry at ${number(stage.elevation)} m`}</span><b>{number(stage.area)} <small>m²</small></b><span>{previous ? `${number(reduction)} m² removed${previous.area > 0 ? ` (${number(reduction / previous.area * 100, 1)}%)` : ""} from previous stage` : "Original plot area"}</span></span><Icon name="target" size={15}/>
          </button>
          {empty && <p className="effect-empty">No remaining shape at this stage. When inspected, the map shows the original plot without a stage shape.</p>}
          <p className="effect-details">{stage.details}</p>
          {section && <p className="effect-caution">This is one horizontal section, not the full legal volume. Lower levels may have a different footprint.</p>}
          <SourceButton id={stage.sourceId} onSource={onSource}/>
        </li>;
      })}</ol>
    </section>
    <section aria-labelledby="floor-budget-heading" className="floor-budgets"><h3 id="floor-budget-heading" className="effects-heading">Counted floor area budgets</h3><p className="detail-intro">These are aggregate budgets across all floors, not physical volumes or footprint boundaries. Used area is the selected concept&apos;s unrounded counted GFA.</p>
      {!budgets.length && <p className="effect-empty">No concept floor area budget is available for this result.</p>}
      {budgets.map(budget => {
        const binding = minimumBudget !== null && Math.abs(budget.limit - minimumBudget) < 0.01;
        const over = budget.used - budget.limit > Math.max(1e-6, budget.limit * 1e-9);
        return <article className="budget-limit" key={budget.id}><div className="budget-title"><h4>{budget.label}</h4>{binding && <span>Lowest cap</span>}</div><p className="budget-values"><strong>{number(budget.used)} m²</strong><span> used / {number(budget.limit)} m² cap</span></p><meter min={0} max={Math.max(budget.limit, budget.used, 1)} value={Math.max(0, budget.used)} aria-label={`${budget.label}: ${number(budget.used)} square metres used of ${number(budget.limit)} square metres allowed`}/><p className={`effect-details ${over ? "budget-over" : ""}`}>{over ? "Unrounded counted area exceeds this cap." : `${number(Math.max(0, budget.limit - budget.used))} m² available under this cap.`} {binding ? "This is the tightest aggregate floor area cap; geometry or whole floors may limit the concept earlier." : "Another aggregate cap is tighter; geometry and whole floors also apply."}</p><p className="effect-details">{budget.details}</p><SourceButton id={budget.sourceId} onSource={onSource}/></article>;
      })}
    </section>
  </div>;
}
