// ⌘L and ⌘G on Linear's own view (modkeys.js), run on main.js's real
// method. Herdr's global `mod.open` can't close a Linear that GitHub opened
// (with openOverlay), so ⌘L there opened a second Linear and ⌘G a second
// GitHub. main.js imports the herdr runtime, so those modules are stubs here
// (node:module hooks) that record what the popup asked herdr for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

globalThis.herdrCalls = [];
const stubs = {
  "gpui-kit": "export class View {} export const div = () => ({}), svg = () => ({});",
  "gpui-base": "const f = () => ({}); export const v_flex=f,h_flex=f,TextView=f,Scrollbar=f,v_virtual_list=f,Popup=f; export const InputState={new:()=>({})}, Input={new:f}, VirtualListScrollHandle={new:f};",
  herdr: [
    "const f = () => null; const rec = (name) => (...a) => { globalThis.herdrCalls.push([name, ...a]); return null; };",
    "export const agents=f,panes=()=>[],machines=()=>[],spaces=()=>[],exec=f,theme=f,appHome=()=>'/nonexistent',nextCommand=f,knownAgents=f,checking=()=>true,readTextFile=async()=>null,writeTextFile=async()=>{};",
    "export const props=()=>({ overlay: 'ov1' }), run=rec('run'), closeOverlay=rec('closeOverlay'), openOverlay=rec('openOverlay');",
  ].join("\n"),
};
registerHooks({
  resolve: (spec, ctx, next) => (spec in stubs ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url.startsWith("stub:") ? { format: "module", source: stubs[url.slice(5)], shortCircuit: true } : next(url, ctx)),
});
const { default: Linear } = await import("../main.js");

const pr = { mod: "github", label: "#12", props: { pr: { host: "github.com", repo: "o/r", number: 12 } } };
function press(pressed, backTo) {
  const o = Object.create(Linear.prototype);
  Object.assign(o, { backTo, from: backTo ? "github" : null, direct: false });
  globalThis.herdrCalls = [];
  o.modKeyPressed(pressed);
  return globalThis.herdrCalls;
}

test("⌘L closes a Linear that GitHub opened, instead of opening a second one", () => {
  assert.deepEqual(press("linear", pr), [["closeOverlay", "ov1"]]);
});

test("⌘G on a Linear opened from a PR goes back to that PR, even after moving to the list", () => {
  assert.deepEqual(press("github", pr), [
    ["closeOverlay", "ov1"],
    ["openOverlay", { mod: "github", kind: "dialog", width: 0.8, height: 0.8, props: pr.props }],
  ]);
});

test("on a Linear opened with ⌘L, both keys do what the global ones do", () => {
  assert.deepEqual(press("linear", null), [["closeOverlay", "ov1"]]);
  assert.deepEqual(press("github", null), [["run", "mod.open", { name: "github" }]]);
});

test("keys.json binds both keys on Linear's view, over the global ones", () => {
  const keys = JSON.parse(readFileSync(new URL("../../../keys.json", import.meta.url), "utf8"));
  assert.equal(keys.global["cmd-l"], "mod.open:linear");
  assert.equal(keys["mod:linear"]["cmd-l"], "linear.close");
  assert.equal(keys["mod:linear"]["cmd-g"], "linear.github");
});

test("the command loop sends linear.close and linear.github there", () => {
  const main = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  assert.match(main, /else if \(c === "close" \|\| c === "github"\) this\.modKeyPressed\(c === "close" \? "linear" : c\);/);
});
