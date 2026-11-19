import { readFileSync } from "node:fs";
import postcss, { type Root, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

type Color = [number, number, number, number];
interface Element {
  tag: string;
  classes: string[];
  parent?: Element;
  last?: boolean;
  disabled?: boolean;
}
interface TextCase { selector: string; element: Element; mapOverlay?: boolean }
const element = (tag: string, classes: string, parent?: Element, last = false): Element => ({ tag, classes: classes.split(" ").filter(Boolean), parent, last });
const sheet = postcss.parse(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"));

function compoundMatches(selector: string, node: Element): boolean {
  if (selector.includes("::") || selector.includes(":has(") || /[+~]/.test(selector)) return false;
  let matched = true;
  selector = selector.replace(/:not\(([^)]+)\)/g, (_, inner) => { if (compoundMatches(inner, node)) matched = false; return ""; });
  selector = selector.replace(/:([\w-]+)/g, (_, pseudo) => {
    if (pseudo === "root") matched &&= !node.parent;
    else if (pseudo === "last-child") matched &&= !!node.last;
    else if (pseudo === "disabled") matched &&= !!node.disabled;
    else matched = false;
    return "";
  });
  const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
  if (tag && tag !== node.tag) return false;
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  return matched && classes.every(name => node.classes.includes(name)) && !selector.includes("[");
}

function matches(selector: string, node: Element): boolean {
  const tokens = selector.replace(/>/g, " > ").trim().split(/\s+/);
  const matchAt = (index: number, target?: Element): boolean => {
    if (!target || !compoundMatches(tokens[index], target)) return false;
    if (index === 0) return true;
    if (tokens[index - 1] === ">") return matchAt(index - 2, target.parent);
    for (let ancestor = target.parent; ancestor; ancestor = ancestor.parent) if (matchAt(index - 1, ancestor)) return true;
    return false;
  };
  return matchAt(tokens.length - 1, node);
}

function specificity(selector: string): number {
  const expanded = selector.replace(/:not\(([^)]+)\)/g, "$1");
  const classes = [...expanded.matchAll(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)].length;
  const tags = expanded.replace(/\.[\w-]+|\[[^\]]+\]|:[\w-]+|\*/g, "").split(/[\s>+~]+/).filter(Boolean).length;
  return classes * 100 + tags;
}

function applies(rule: Rule, width: number): boolean {
  for (let parent: Rule["parent"] | Root["parent"] = rule.parent; parent; parent = parent.parent) {
    if (parent.type !== "atrule") continue;
    if (parent.name === "keyframes") return false;
    if (parent.name !== "media") continue;
    if (parent.params.includes("prefers-reduced-motion")) return false;
    for (const condition of parent.params.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)) {
      if (condition[1] === "min" && width < Number(condition[2])) return false;
      if (condition[1] === "max" && width > Number(condition[2])) return false;
    }
  }
  return true;
}

function declaration(root: Root, node: Element, property: string, width: number): string | undefined {
  let winner: { value: string; rank: number; order: number } | undefined;
  let order = 0;
  root.walkRules(rule => {
    if (!applies(rule, width)) return;
    for (const selector of rule.selectors) {
      if (!matches(selector, node)) continue;
      rule.walkDecls(decl => {
        order++;
        const background = property === "background-color" && decl.prop === "background";
        if (decl.prop !== property && !background) return;
        const rank = specificity(selector) + (decl.important ? 1_000_000 : 0);
        if (!winner || rank > winner.rank || rank === winner.rank && order > winner.order) winner = { value: decl.value, rank, order };
      });
    }
  });
  return winner?.value;
}

function value(root: Root, node: Element, property: string, width: number): string {
  let resolved = declaration(root, node, property, width);
  if (!resolved || resolved === "inherit") {
    if ((property === "color" || property === "font-size" || property === "line-height") && node.parent) return value(root, node.parent, property, width);
    return property === "background-color" ? "transparent" : property === "color" ? "black" : property === "font-size" ? "16px" : "normal";
  }
  let documentRoot = node;
  while (documentRoot.parent) documentRoot = documentRoot.parent;
  resolved = resolved.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    const variable = declaration(root, documentRoot, name, width);
    if (!variable) throw new Error(`Missing stylesheet variable ${name}`);
    return variable;
  });
  return resolved;
}

function color(input: string): Color {
  if (input === "none" || input === "transparent") return [0, 0, 0, 0];
  if (input === "black") return [0, 0, 0, 1];
  if (input === "white") return [255, 255, 255, 1];
  const hex = input.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (!hex) throw new Error(`Unsupported stylesheet color: ${input}`);
  const expanded = hex.length <= 4 ? [...hex].map(part => part + part).join("") : hex;
  return [parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16), expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1];
}

function composite(front: Color, back: Color): Color {
  const alpha = front[3] + back[3] * (1 - front[3]);
  return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha) as Color;
}

function background(root: Root, node: Element, width: number, mapBase?: Color): Color {
  const behind = node.classes.includes("map-container") && mapBase ? mapBase : node.parent ? background(root, node.parent, width, mapBase) : color("white");
  return composite(color(value(root, node, "background-color", width)), behind);
}

function luminance(rgb: Color): number {
  const channels = rgb.slice(0, 3).map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function ratio(root: Root, target: TextCase, width: number, mapBase?: Color): number {
  for (let node: Element | undefined = target.element; node; node = node.parent) {
    const opacity = declaration(root, node, "opacity", width);
    if (opacity !== undefined && Number(opacity) !== 1) throw new Error(`Unmodeled content opacity at ${target.selector}: ${opacity}`);
  }
  const surface = background(root, target.element, width, mapBase);
  const text = composite(color(value(root, target.element, "color", width)), surface);
  const levels = [luminance(text), luminance(surface)].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

const html = element("html", "");
const body = element("body", "", html);
const input = element("aside", "input-panel", body);
const results = element("aside", "results-panel", body);
const selectedCard = element("button", "concept-card selected", results);
const card = element("button", "concept-card", results);
const map = element("section", "map-panel", body);
const canvas = element("div", "map-container", map);
const mapCard = element("div", "map-bottom-card", canvas);
const dialog = element("dialog", "sources-dialog", body);
const source = element("article", "source-item", dialog);
const details = element("div", "detail-content", results);
const constraint = element("div", "constraint-box", details);
const checks = element("span", "check-copy", element("button", "check-row", details));
const assumptions = element("section", "study-assumptions", results);
const notice = element("div", "result-notice", results);
const errorNotice = element("div", "result-notice error", results);
const stage = element("li", "geometry-stage", details);
const selectedStage = element("li", "geometry-stage selected", details);
const budget = element("article", "budget-limit", details);
const cases: TextCase[] = [];
function text(selector: string, tag: string, classes: string, parent: Element, mapOverlay = false, last = false): Element {
  const node = element(tag, classes, parent, last);
  cases.push({ selector, element: node, mapOverlay });
  return node;
}

const header = element("header", "app-header", body);
text(".product-label", "span", "product-label", header);
text(".zone-pill", "span", "zone-pill", header);
text(".button-quiet", "button", "button button-quiet", header);
text(".button-primary", "button", "button button-primary", header);
text(".input-panel .eyebrow", "span", "eyebrow", input);
text(".plot-area small", "small", "", element("div", "plot-area", input));
text(".field-note", "p", "field-note", input);
text(".range-field > .field-note", "p", "field-note", element("div", "range-field", input));
text(".field-label", "label", "field-label", input);
text(".text-button", "button", "text-button", input);
const segmented = element("div", "segmented", input);
text(".segmented button", "button", "", segmented);
text(".segmented button.active", "button", "active", segmented);
text(".road-evidence", "div", "road-evidence", input);
const fieldHeading = element("div", "field-heading", input);
text(".field-heading label", "label", "", fieldHeading);
text(".field-heading output span", "span", "", element("output", "", fieldHeading));
text(".range-limits", "span", "", element("div", "range-limits", input));
const scope = element("div", "scope-note", input);
text(".scope-note p", "p", "", scope);
text(".scope-note button", "button", "", scope);
const toolbar = element("div", "map-toolbar", map);
text(".map-toolbar .eyebrow", "span", "eyebrow", toolbar);
text(".map-toolbar h2 span", "span", "", element("h2", "", toolbar));
const toggle = text(".envelope-toggle", "label", "envelope-toggle", canvas, true);
const toggleCopy = text(".envelope-toggle-copy", "span", "envelope-toggle-copy", toggle, true);
text(".envelope-approximation", "small", "envelope-approximation", toggleCopy, true);
text(".concept-map-label > span:last-child", "span", "", element("div", "concept-map-label", canvas), true, true);
text(".inspection-map-label > span:last-child", "span", "", element("div", "concept-map-label inspection-map-label", canvas), true, true);
text(".map-status", "div", "map-status", mapCard, true);
text(".map-legend", "span", "", element("div", "map-legend", mapCard), true);
text(".map-bottom-card > small", "small", "", mapCard, true);
text(".map-footer > span", "span", "", element("div", "map-footer", map));
text(".map-loading", "div", "map-loading", canvas, true);
text(".site-loading", "div", "site-loading", canvas, true);
text(".map-failure p", "p", "", element("div", "map-failure", canvas), true);
text(".map-network-note", "div", "map-network-note", canvas, true);
text(".drawing-hint", "div", "drawing-hint", canvas, true);
text(".results-heading > p", "p", "", element("div", "results-heading", results));
const status = text(".result-status", "div", "result-status", results);
text(".result-status timing", "span", "", status, false, true);
for (const surface of [card, selectedCard]) {
  const suffix = surface === card ? "" : " selected";
  text(`.concept-index${suffix}`, "span", "concept-index", surface);
  text(`.concept-main > span${suffix}`, "span", "", element("div", "concept-main", surface));
  const mini = text(`.concept-mini-stats${suffix}`, "div", "concept-mini-stats", surface);
  text(`.concept-mini-stats strong${suffix}`, "strong", "", mini);
  const bottom = text(`.concept-card-bottom${suffix}`, "div", "concept-card-bottom", surface);
  text(`.feasible-label${suffix}`, "span", "feasible-label", bottom);
  text(`.constrained-label${suffix}`, "span", "constrained-label", bottom);
}
const tabs = element("div", "result-tabs", results);
const inactiveTab = text(".result-tabs > button", "button", "", tabs);
text(".result-tabs > button.active", "button", "active", tabs);
text(".result-tabs badge", "span", "", inactiveTab);
text(".detail-heading > p", "p", "", element("div", "detail-heading", details));
const metrics = element("dl", "metrics-list", details);
text(".metrics-list dt", "dt", "", metrics);
const dd = text(".metrics-list dd", "dd", "", metrics);
text(".metrics-list dd > span", "span", "", dd);
text(".constraint-box > .eyebrow", "span", "eyebrow", constraint);
text(".constraint-box p", "p", "", constraint);
text(".detail-source-button", "button", "detail-source-button", details);
text(".results-footnote", "div", "results-footnote", results);
text(".detail-intro", "p", "detail-intro", details);
text(".check-copy > span", "span", "", checks);
text(".check-measurements", "span", "check-measurements", checks);
for (const state of ["pass", "fail", "unknown", "unsupported"]) text(`.check-copy em.${state}`, "em", state, checks);
const table = element("table", "floor-table", details);
text(".floor-table th", "th", "", table);
text(".floor-table td", "td", "", table);
text(".floor-table tfoot td", "td", "", element("tfoot", "", table));
for (const surface of [notice, errorNotice]) {
  text(`.${surface.classes.join(".")} strong`, "strong", "", surface);
  text(`.${surface.classes.join(".")} p`, "p", "", surface);
}
text(".results-empty p", "p", "", element("div", "results-empty", results));
text(".results-empty h3", "h3", "", element("div", "results-empty", results));
text(".notice", "p", "", element("div", "notice", dialog));
text(".source-item .eyebrow", "span", "eyebrow", source);
for (const tag of ["p", "li", "a"]) text(`.source-item ${tag}`, tag, "", source);
for (const tag of ["p", "li", "summary"]) text(`.study-assumptions ${tag}`, tag, "", assumptions);
for (const surface of [stage, selectedStage]) {
  const suffix = surface === stage ? "" : " selected";
  const copy = element("span", "stage-copy", element("button", "stage-select", surface));
  text(`.stage-number${suffix}`, "span", "stage-number", surface);
  text(`.stage-copy > span${suffix}`, "span", "", copy);
  text(`.stage-copy small${suffix}`, "small", "", element("b", "", copy));
  for (const cls of ["effect-details", "effect-caution", "effect-empty"]) text(`.${cls}${suffix}`, "p", cls, surface);
  text(`.effect-source${suffix}`, "button", "effect-source", surface);
}
const unavailableStage = element("button", "stage-select", stage);
unavailableStage.disabled = true;
text(".stage-select:disabled .stage-copy > span", "span", "", element("span", "stage-copy", unavailableStage));
text(".budget-title > span", "span", "", element("div", "budget-title", budget));
text(".budget-values", "span", "", element("p", "budget-values", budget));
text(".budget-over", "p", "effect-details budget-over", budget);
text(".ledger-actual", "p", "ledger-actual", details);

describe("normal text contrast from the authored stylesheet", () => {
  for (const width of [1366, 1024, 768, 390]) {
    it(`keeps ${cases.length} core text surfaces at 4.5:1 at ${width}px`, () => {
      const failures: string[] = [];
      for (const target of cases) {
        const ratios = target.mapOverlay ? [ratio(sheet, target, width), ratio(sheet, target, width, color("black")), ratio(sheet, target, width, color("white"))] : [ratio(sheet, target, width)];
        const minimum = Math.min(...ratios);
        if (minimum < 4.5) failures.push(`${target.selector}: ${minimum.toFixed(2)}:1, ${value(sheet, target.element, "font-size", width)}`);
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }

  it("detects a low-contrast mutation using the actual input-panel surface", () => {
    const mutated = sheet.clone();
    const surface = value(sheet, input, "background-color", 1366);
    mutated.append(postcss.rule({ selector: ".field-note" }).append(postcss.decl({ prop: "color", value: surface, important: true })));
    expect(ratio(mutated, cases.find(target => target.selector === ".field-note")!, 1366)).toBeLessThan(4.5);
  });

  it("keeps the envelope explanation in a compact readable column", () => {
    for (const width of [1366, 390]) {
      expect(value(sheet, toggleCopy, "display", width)).toBe("flex");
      expect(value(sheet, toggleCopy, "flex-direction", width)).toBe("column");
      const note = cases.find(target => target.selector === ".envelope-approximation")!.element;
      expect(parseFloat(value(sheet, note, "font-size", width))).toBeGreaterThanOrEqual(10);
      expect(parseFloat(value(sheet, note, "font-size", width))).toBeLessThanOrEqual(11);
      expect(value(sheet, note, "line-height", width)).toBe("1.4");
    }
  });
});
