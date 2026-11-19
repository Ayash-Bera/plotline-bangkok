import assert from "node:assert/strict";
import { test } from "vitest";
import { visibilityProblem, nextRangeValue, sameScenario, cadenceSummary } from "../../public/checks/browser-core.js";
const visible={parent:"visible",child:"visible",display:"block",cssVisibility:"visible",frameIntersection:1,frameRect:{width:390,height:480}};
test("visibility rejects hidden, clipped and zero-area frames",()=>{
 assert.equal(visibilityProblem(visible),null);
 for(const changed of [{parent:"hidden"},{child:"hidden"},{display:"none"},{cssVisibility:"hidden"},{frameIntersection:.97},{frameIntersection:NaN},{frameRect:{width:0,height:480}}]) assert.notEqual(visibilityProblem({...visible,...changed}),null);
});
test("range boundaries and unrelated keys cannot create changed samples",()=>{
 const input={value:"3.2",min:"2.8",max:"4",step:"0.1"};
 assert.equal(nextRangeValue(input,"ArrowRight"),3.3);
 assert.equal(nextRangeValue(input,"ArrowLeft"),3.1);
 assert.equal(nextRangeValue(input,"Home"),2.8);
 assert.equal(nextRangeValue(input,"End"),4);
 assert.equal(nextRangeValue(input,"Tab"),null);
 assert.equal(nextRangeValue({...input,value:"4"},"ArrowRight"),4);
});
test("scenario matching rejects a second changed field and handles range rounding",()=>{
 assert.equal(sameScenario({road:"one",width:3.3},{road:"one",width:3.3000000001}),true);
 assert.equal(sameScenario({road:"one",width:3.3},{road:"two",width:3.3}),false);
 assert.equal(sameScenario({road:"one",width:3.3},{road:"one",width:NaN}),false);
});
test("cadence denominator is adjacent intervals and empty data has no fake statistics",()=>{
 const result=cadenceSummary([100,110,130,190]);
 assert.equal(result.intervals,3);assert.equal(result.elapsedMs,90);assert.equal(result.medianMs,20);assert.equal(result.p95Ms,60);assert.equal(result.over50ms,1);
 assert.equal(cadenceSummary([]).medianMs,null);
 assert.equal(cadenceSummary([10,10,9]).monotonic,false);
});
