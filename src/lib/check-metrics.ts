import type { RuleCheck } from "./domain";

export interface CheckMetrics {
  measurement: string | null;
  requirement: string | null;
  margin: string | null;
}

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function magnitude(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.01) return value < 0 ? ">-0.01" : "<0.01";
  return number.format(value);
}

export function formatCheckMetrics(check: RuleCheck): CheckMetrics {
  if (!finite(check.value)) return { measurement: null, requirement: null, margin: null };
  const units = check.display === "ratio" ? "ratio" : check.unit;
  const value = (amount: number) => check.display === "percent" ? `${magnitude(amount * 100)}%` : `${magnitude(amount)}${units ? ` ${units}` : ""}`;
  const marginValue = (amount: number) => check.display === "percent" ? `${magnitude(amount * 100)} percentage points` : value(amount);
  const requirement = finite(check.limit) ? `${check.bound === "max" ? "Maximum" : check.bound === "min" ? "Minimum" : "Reference"} ${value(check.limit)}` : null;
  let margin: string | null = null;
  if (finite(check.margin)) {
    if (!check.bound) margin = `${marginValue(check.margin)} (signed margin)`;
    else {
      const bound = check.bound === "max" ? "maximum" : "minimum";
      if (check.margin === 0) margin = `${marginValue(0)} (at ${bound})`;
      else {
        const position = check.bound === "max" ? check.margin > 0 ? "below" : "above" : check.margin > 0 ? "above" : "below";
        margin = `${marginValue(Math.abs(check.margin))} ${position} ${bound}`;
      }
    }
  }
  return { measurement: value(check.value), requirement, margin };
}
