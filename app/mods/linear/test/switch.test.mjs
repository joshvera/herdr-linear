// What happens after the popup moves to another machine or a workspace signs
// out under it, run on main.js's real methods. main.js imports the herdr
// runtime, so those modules are replaced by stubs here (node:module hooks);
// the methods under test touch only the popup's own state, `linear()`
// (replaced per test) and `cx`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const stubs = {
  "gpui-kit": "export class View {} export const div = () => ({}), svg = () => ({});",
  "gpui-base": "const f = () => ({}); export const v_flex=f,h_flex=f,TextView=f,Scrollbar=f,v_virtual_list=f,Popup=f; export const InputState={new:()=>({})}, Input={new:f}, VirtualListScrollHandle={new:f};",
  herdr: "const f = () => null; export const agents=f,panes=()=>[],machines=()=>[],spaces=()=>[],run=f,exec=f,theme=f,appHome=()=>'/nonexistent',props=f,closeOverlay=f,openOverlay=f,nextCommand=f,knownAgents=f,checking=()=>true,readTextFile=async()=>null,writeTextFile=async()=>{};",
};
registerHooks({
  resolve: (spec, ctx, next) => (spec in stubs ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url.startsWith("stub:") ? { format: "module", source: stubs[url.slice(5)], shortCircuit: true } : next(url, ctx)),
});
const { default: Linear } = await import("../main.js");
const { mayCreate } = await import("../cache.js");

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const cx = { notify() {}, spawn(fn) { fn(cx); }, timer: { after() {}, every() {} } };

// A popup as init leaves it, signed in to two workspaces, its waker running.
function popup(ask) {
  const o = Object.create(Linear.prototype);
  Object.assign(o, {
    demo: false, withProps: false, lists: {}, ws: "w1", workspaces: [{ id: "w1" }, { id: "w2" }], screen: "list", cache: null,
    store: { write: async () => true, read: async () => ({ details: {} }) }, stamp: (() => { let n = 0; return () => ++n; })(),
    drilled: null, keys: { focus() {} }, settled: true, who: { machine: "", at: 1 },
  });
  o.asked = [];
  o.linear = async (req, ws) => {
    o.asked.push({ ...req, ws });
    return ask(req, ws);
  };
  o.startWaker?.(cx);
  return o;
}
const lists = () => ({ issues: [], projects: [] });

test("a workspace signed out under the popup by a call that isn't a load: the next one's lists are asked at once", async () => {
  const o = popup(lists);
  o.signedOutOf("w1"); // as linear() does for a search, a form's teams, an issue by key
  await settle();
  assert.equal(o.ws, "w2");
  const tabs = o.asked.filter((r) => r.op === "list" && r.ws === "w2").map((r) => r.tab).sort();
  assert.deepEqual(tabs, ["mine", "projects", "recent"]);
});

test("a switch with nothing in flight reloads what's shown", async () => {
  const o = popup(lists);
  o.dropShown(); // confirmWho's, reached from any linear() retry
  await settle();
  assert.equal(o.asked.filter((r) => r.op === "list").length, 3);
});

test("a list that fails after a sign-out elsewhere stops spinning and says why", async () => {
  const o = popup((req) => {
    if (req.tab === "mine") throw new Error("net down");
    return lists();
  });
  o.signedOutOf("w1");
  await settle();
  const l = o.lists.mine;
  assert.equal(l.loading, false);
  assert.equal(l.error, "net down");
  o.asked.length = 0;
  o.loadAll(cx);
  await settle();
  assert.ok(o.asked.some((r) => r.tab === "mine"), "the next refresh asks for it again");
});

test("a switch on the new issue form asks for the team's statuses again and keeps the chosen one", async () => {
  const team = { id: "t1", key: "ENG", defaultIssueState: { id: "s-default" } };
  const o = popup((req) => (req.op === "teams" ? { teams: [team] } : req.op === "states" ? { states: [{ id: "s-default" }, { id: "s-chosen" }] } : lists()));
  o.remember = () => {};
  o.screen = "create";
  o.form = {
    ws: "w1", team, state: "s-chosen", stateChosen: true, wantState: "s-chosen", wantTeam: "ENG", priority: 0, project: null, assignToMe: true,
    teams: [team], teamsInfo: { loaded: true, cached: false }, states: { t1: [{ id: "s-chosen" }] }, statesInfo: { t1: { loaded: true, cached: false } },
  };
  o.dropShown();
  await settle();
  const f = o.form;
  assert.ok(o.asked.some((r) => r.op === "states"), "statuses asked again");
  assert.equal(f.state, "s-chosen");
  assert.deepEqual(mayCreate({ teams: f.teamsInfo, states: f.statesInfo[f.team.id], projects: o.lists.projects, stateChosen: f.stateChosen, projectSet: false }), { ok: true, why: "" });
});
