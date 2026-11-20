// The cache's rules (cache.js): node --test app/mods/linear/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VERSION, LIMITS, empty, parse, whoOf, sameWho, applyPatch, writeWith, serial, stamper,
  seed, takesOver, isGone, staleMark, mayChangeState, mayCreate, mayWorktree, utf8Length,
} from "../cache.js";

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;
const here = whoOf("", NOW - 1000);
const hereLater = whoOf("", NOW);
const vps = whoOf("vps", NOW);

// A file held in memory, with herdr's compare-and-swap.
function memFile(text = null) {
  const f = {
    text,
    writes: 0,
    read: async () => f.text,
    write: async (_p, t, expected) => {
      if (expected !== f.text) throw new Error("stale snapshot");
      f.text = t;
      f.writes++;
    },
  };
  return f;
}

const row = (id, extra = {}) => ({ id, identifier: `ENG-${id}`, title: `Issue ${id}`, ...extra });
const list = (items, saved) => ({ items, warning: "", saved });

// ── the file format ──────────────────────────────────────────────────────

test("today's unversioned file, another version, or a bad one is an empty cache", () => {
  const today = { workspaces: [{ id: "w1", name: "a", urlKey: "a" }], lists: { w1: { mine: [row(1)] } } };
  assert.deepEqual(parse(JSON.stringify(today), "lists"), empty("lists"));
  assert.deepEqual(parse(JSON.stringify({ version: 1, lists: {} }), "lists"), empty("lists"));
  assert.deepEqual(parse("{not json", "lists"), empty("lists"));
  assert.deepEqual(parse(null, "details"), empty("details"));
});

test("a version 2 file reads back its who, workspaces and entries", () => {
  const doc = { ...empty("lists", here), workspaces: [{ id: "w1", name: "a", urlKey: "a" }], lists: { "w1/mine": list([row(1)], 5) } };
  assert.deepEqual(parse(JSON.stringify(doc), "lists"), doc);
});

test("the first write replaces today's unversioned file", async () => {
  const f = memFile(JSON.stringify({ lists: { w1: { mine: [] } } }));
  assert.equal(await writeWith(f, "p", "lists", { who: here, lists: { "w1/mine": list([], 1) } }, () => NOW), true);
  assert.equal(JSON.parse(f.text).version, VERSION);
});

// ── who ──────────────────────────────────────────────────────────────────

test("who is the machine: another machine is another who, a later confirmation is not", () => {
  assert.equal(sameWho(here, hereLater), true);
  assert.equal(sameWho(here, vps), false);
  assert.equal(sameWho(here, null), false);
});

test("a newer who from another machine replaces the whole file", async () => {
  const f = memFile(JSON.stringify({ ...empty("lists", here), lists: { "w1/mine": list([row(1)], 1) } }));
  await writeWith(f, "p", "lists", { who: vps, base: here.at, lists: { "w2/mine": list([row(9)], 2) } }, () => NOW);
  const doc = parse(f.text, "lists");
  assert.deepEqual(doc.who, vps);
  assert.deepEqual(Object.keys(doc.lists), ["w2/mine"]);
});

test("a copy that never saw the switch can't switch the file back, even confirming later", async () => {
  // A moved the file to vps (claiming it from here's t1); B read here's file
  // at t1 and its status on here answers after A's switch.
  const f = memFile(JSON.stringify({ ...empty("lists", vps), lists: { "w2/mine": list([row(9)], 2) } }));
  const late = whoOf("", NOW + 5000);
  assert.equal(await writeWith(f, "p", "lists", { who: late, base: NOW - 1000, lists: { "w1/mine": list([row(1)], 3) } }, () => NOW), false);
  assert.deepEqual(parse(f.text, "lists").who, vps);
  // A copy that had seen vps's file may move it on.
  assert.equal(await writeWith(f, "p", "lists", { who: late, base: vps.at, lists: {} }, () => NOW), true);
  assert.deepEqual(parse(f.text, "lists").who, late);
});

test("a copy still on the old machine can't write its rows back after the switch", async () => {
  const f = memFile(JSON.stringify({ ...empty("lists", vps), lists: { "w2/mine": list([row(9)], 2) } }));
  const wrote = await writeWith(f, "p", "lists", { who: here, lists: { "w1/mine": list([row(1)], 3) } }, () => NOW);
  assert.equal(wrote, false);
  assert.deepEqual(Object.keys(parse(f.text, "lists").lists), ["w2/mine"]);
});

test("the same machine unions, newer saved wins, and the file keeps the latest confirmation", () => {
  const doc = { ...empty("lists", hereLater), lists: { "w1/mine": list([row(1)], 10), "w1/recent": list([row(2)], 10) } };
  const out = applyPatch(doc, { who: here, lists: { "w1/mine": list([row(3)], 20), "w1/recent": list([row(4)], 5) } }, "lists", NOW);
  assert.deepEqual(out.who, hereLater, "an older confirmation doesn't move who back");
  assert.deepEqual(out.lists["w1/mine"].items, [row(3)]);
  assert.deepEqual(out.lists["w1/recent"].items, [row(2)], "an older answer doesn't beat a newer one");
});

test("two writers with entries for different keys both survive", async () => {
  const f = memFile(null);
  await writeWith(f, "p", "lists", { who: here, lists: { "w1/mine": list([row(1)], 1) } }, () => NOW);
  await writeWith(f, "p", "lists", { who: here, lists: { "w1/projects": list([], 2) } }, () => NOW);
  assert.deepEqual(Object.keys(parse(f.text, "lists").lists).sort(), ["w1/mine", "w1/projects"]);
});

test("a workspace that answered signed out is dropped, entries and switcher both", () => {
  const doc = { ...empty("lists", here), workspaces: [{ id: "w1" }, { id: "w2" }], lists: { "w1/mine": list([], 1), "w2/mine": list([], 1) } };
  const out = applyPatch(doc, { who: here, drop: ["w1"], lists: { "w1/recent": list([], 2) } }, "lists", NOW);
  assert.deepEqual(Object.keys(out.lists), ["w2/mine"]);
  assert.deepEqual(out.workspaces, [{ id: "w2" }]);
});

test("signed out everywhere empties the file", () => {
  const doc = { ...empty("details", here), details: { "w1/issue/a": { d: {}, saved: 1 } } };
  assert.deepEqual(applyPatch(doc, { who: here, clear: true }, "details", NOW).details, {});
});

test("a patch without a who writes nothing", () => {
  assert.equal(applyPatch(empty("lists"), { lists: {} }, "lists", NOW), null);
});

// ── caps ─────────────────────────────────────────────────────────────────

test("a pruned entry isn't brought back by the other writer", async () => {
  const projects = {};
  for (let i = 0; i < LIMITS.projectLists; i++) projects[`w1/project/p${i}`] = list([], 100 + i);
  const f = memFile(JSON.stringify({ ...empty("lists", here), lists: projects }));
  // Another copy, which read before p0 was the oldest, writes its old copy of p0.
  await writeWith(f, "p", "lists", { who: here, lists: { "w1/project/new": list([], 500), "w1/project/p0": list([], 100) } }, () => NOW);
  const keys = Object.keys(parse(f.text, "lists").lists);
  assert.equal(keys.length, LIMITS.projectLists);
  assert.ok(!keys.includes("w1/project/p0"));
  assert.ok(keys.includes("w1/project/new"));
});

test("a list keeps its first rows and says how many there were", () => {
  const items = Array.from({ length: 1000 }, (_, i) => row(i));
  const out = applyPatch(empty("lists"), { who: here, lists: { "w1/mine": list(items, 1) } }, "lists", NOW);
  assert.equal(out.lists["w1/mine"].items.length, LIMITS.rows);
  assert.equal(out.lists["w1/mine"].total, 1000);
});

test("the worst case stays under the lists file's bound, the least recent workspace going first", () => {
  const long = (ws, i) => row(`${ws}-${i}`, { title: "x".repeat(400), url: "https://linear.app/" + "y".repeat(150), branch: "b".repeat(80) });
  const lists = {};
  for (const [n, ws] of ["w1", "w2", "w3"].entries()) {
    for (const tab of ["mine", "projects", "recent"]) lists[`${ws}/${tab}`] = list(Array.from({ length: 1000 }, (_, i) => long(ws, i)), 10 + n);
  }
  for (let i = 0; i < 25; i++) lists[`w1/project/p${i}`] = list(Array.from({ length: 1000 }, (_, j) => long("p", j)), 5);
  for (let i = 0; i < 40; i++) lists[`w1/states/t${i}`] = list(Array.from({ length: 20 }, (_, j) => ({ id: `s${j}`, name: "State" })), 5);
  const out = applyPatch(empty("lists"), { who: here, lists }, "lists", NOW);
  assert.ok(utf8Length(JSON.stringify(out)) <= LIMITS.listBytes);
  const kept = new Set(Object.keys(out.lists).map((k) => k.split("/")[0]));
  assert.ok(!kept.has("w1"), "the least recent goes first");
  for (const tab of ["mine", "projects", "recent"]) assert.ok(out.lists[`w3/${tab}`]?.items.length > 0, `w3/${tab} kept, not empty`);
});

test("one workspace over the bound loses its project lists first, then rows, never its tabs", () => {
  const long = (i) => row(`r${i}`, { title: "x".repeat(900), url: "u".repeat(300), branch: "b".repeat(200) });
  const lists = {};
  for (const tab of ["mine", "projects", "recent"]) lists[`w1/${tab}`] = list(Array.from({ length: 100 }, (_, i) => long(i)), 10);
  lists["w1/project/p1"] = list(Array.from({ length: 100 }, (_, i) => long(i)), 1);
  const out = applyPatch(empty("lists"), { who: here, lists }, "lists", NOW);
  assert.ok(utf8Length(JSON.stringify(out)) <= LIMITS.listBytes);
  assert.ok(!("w1/project/p1" in out.lists));
  for (const tab of ["mine", "projects", "recent"]) {
    const l = out.lists[`w1/${tab}`];
    assert.ok(l.items.length > 0);
    assert.equal(l.total ?? l.items.length, 100, "a trimmed list says how many there were");
  }
});

test("details: at most 50, none older than 30 days, under their byte bound", () => {
  const details = {};
  for (let i = 0; i < 70; i++) details[`w1/issue/i${i}`] = { d: { description: "z".repeat(20000) }, saved: NOW - i * 1000 };
  details["w1/issue/old"] = { d: {}, saved: NOW - 31 * DAY };
  const out = applyPatch(empty("details"), { who: here, details }, "details", NOW);
  assert.ok(Object.keys(out.details).length <= LIMITS.details);
  assert.ok(!("w1/issue/old" in out.details));
  assert.ok("w1/issue/i0" in out.details, "the newest stay");
  assert.ok(utf8Length(JSON.stringify(out)) <= LIMITS.detailBytes + 200);
});

// ── the write loop ───────────────────────────────────────────────────────

test("a rejected compare-and-swap reads again and merges; three rejections give up quietly", async () => {
  const f = memFile(null);
  let sneak = true;
  const racing = {
    read: async () => {
      const t = f.text;
      if (sneak) { // another copy writes between this read and the write
        sneak = false;
        f.text = JSON.stringify({ ...empty("lists", here), lists: { "w1/recent": list([], 1) } });
      }
      return t;
    },
    write: f.write,
  };
  assert.equal(await writeWith(racing, "p", "lists", { who: here, lists: { "w1/mine": list([], 2) } }, () => NOW), true);
  assert.deepEqual(Object.keys(parse(f.text, "lists").lists).sort(), ["w1/mine", "w1/recent"]);

  const never = { read: async () => null, write: async () => { throw new Error("stale"); } };
  assert.equal(await writeWith(never, "p", "lists", { who: here }, () => NOW), false);
  const unreadable = { read: async () => { throw new Error("too big"); }, write: async () => {} };
  assert.equal(await writeWith(unreadable, "p", "lists", { who: here }, () => NOW), false);
});

test("serial runs jobs one at a time, even after one fails", async () => {
  const q = serial();
  const order = [];
  let release;
  const first = q(() => new Promise((r) => (release = r)).then(() => order.push(1)));
  const second = q(async () => { order.push(2); throw new Error("x"); });
  const third = q(async () => order.push(3));
  await Promise.resolve();
  assert.deepEqual(order, []);
  release();
  await first;
  await second.catch(() => {});
  await third;
  assert.deepEqual(order, [1, 2, 3]);
});

test("stamps never repeat and never go back", () => {
  let t = 100;
  const s = stamper(() => t);
  const a = s();
  const b = s();
  t = 50;
  const c = s();
  assert.ok(a < b && b < c);
});

// ── lists ────────────────────────────────────────────────────────────────

test("seeding keeps the list object, so a load in flight still answers into it", () => {
  const l = { items: [], loaded: false, loading: true };
  const held = l;
  assert.equal(seed(l, list([row(1)], 7)), true);
  assert.equal(held, l);
  assert.deepEqual(l.items, [row(1)]);
  assert.equal(l.cached, true);
  assert.equal(l.loading, true, "seeding doesn't touch the load's flag");
});

test("a cache read that lands after a live answer doesn't replace it", () => {
  const l = { items: [row(2)], loaded: true, cached: false };
  assert.equal(seed(l, list([row(1)], 7)), false);
  assert.deepEqual(l.items, [row(2)]);
});

// ── details ──────────────────────────────────────────────────────────────

test("a detail applies only to the issue and workspace on screen", () => {
  const want = { ws: "w1", id: "a" };
  assert.equal(takesOver(want, null, { ws: "w1", id: "b", at: 5, cached: false }), false, "another issue's answer");
  assert.equal(takesOver(want, null, { ws: "w2", id: "a", at: 5, cached: false }), false, "another workspace's");
  assert.equal(takesOver(want, null, { ws: "w1", id: "a", at: 5, cached: true }), true, "cached fills an empty screen");
  assert.equal(takesOver(want, { ws: "w1", id: "z", at: 9, cached: false }, { ws: "w1", id: "a", at: 1, cached: true }), true, "what's shown is another issue's");
});

test("cached never over live; live over cached; an older live answer never over a newer one", () => {
  const want = { ws: "w1", id: "a" };
  const live = (at) => ({ ws: "w1", id: "a", at, cached: false });
  const cached = (at) => ({ ws: "w1", id: "a", at, cached: true });
  assert.equal(takesOver(want, live(5), cached(9)), false);
  assert.equal(takesOver(want, cached(9), live(1)), true);
  assert.equal(takesOver(want, live(5), live(3)), false);
  assert.equal(takesOver(want, live(5), live(6)), true);
  assert.equal(takesOver(want, cached(5), cached(4)), false);
});

test("gone is Linear's not-found, the demo's, or an issue answered empty; a timeout isn't", () => {
  assert.equal(isGone(new Error("Linear: Entity not found: Issue")), true);
  assert.equal(isGone("Linear: Entity not found: Project"), true);
  assert.equal(isGone(new Error("no such issue")), true);
  assert.equal(isGone({ issue: { id: "" } }), true);
  assert.equal(isGone({ issue: { id: "a" } }), false);
  assert.equal(isGone(new Error("context deadline exceeded")), false);
  assert.equal(isGone(new Error("dial tcp: no route to host")), false);
  assert.equal(isGone(null), false);
});

test("the mark: refreshing with the time today, the date before, the error when it failed, nothing live", () => {
  const noon = new Date(2026, 10, 20, 12, 0).getTime();
  const morning = new Date(2026, 10, 20, 9, 5).getTime();
  const before = new Date(2026, 10, 18, 9, 5).getTime();
  assert.equal(staleMark(true, morning, "", true, noon), "Refreshing… · from 09:05");
  assert.equal(staleMark(true, before, "", true, noon), "Refreshing… · from 18 Nov");
  assert.equal(staleMark(true, morning, "offline", false, noon), "offline · showing from 09:05");
  assert.equal(staleMark(false, morning, "", true, noon), "");
});

// ── what cached data may do ──────────────────────────────────────────────

test("the status change waits for a live detail, and says why", () => {
  assert.equal(mayChangeState(null).ok, false);
  assert.deepEqual(mayChangeState({ d: {}, cached: true }), { ok: false, why: "Refreshing…" });
  assert.deepEqual(mayChangeState({ d: {}, cached: true, error: "offline" }), { ok: false, why: "offline" });
  assert.equal(mayChangeState({ d: {}, cached: false }).ok, true);
});

test("create waits only for what the form's choices were built from, and says a failure", () => {
  const liveL = { loaded: true, cached: false };
  const cachedL = { loaded: true, cached: true };
  assert.equal(mayCreate({ teams: cachedL, states: liveL, projects: liveL }).ok, false);
  assert.equal(mayCreate({ teams: liveL, states: cachedL, projects: cachedL }).ok, true, "no status or project chosen");
  assert.equal(mayCreate({ teams: liveL, states: cachedL, stateChosen: true }).ok, false);
  assert.equal(mayCreate({ teams: liveL, projects: cachedL, projectSet: true }).ok, false);
  assert.deepEqual(mayCreate({ teams: liveL, states: { loaded: false, error: "states: offline" }, stateChosen: true }), { ok: false, why: "states: offline" });
  assert.equal(mayCreate({ teams: liveL, states: liveL, projects: liveL, stateChosen: true, projectSet: true }).ok, true);
  assert.deepEqual(mayCreate({ teams: liveL, projects: { loaded: true, items: [], error: "offline" }, projectSet: true }), { ok: false, why: "offline" });
});

test("starting an issue may use any row; a worktree alone, or a project's, needs a live one", () => {
  assert.equal(mayWorktree({ start: true, issue: true, live: false }).ok, true);
  assert.equal(mayWorktree({ start: false, issue: true, live: false }).ok, false);
  assert.equal(mayWorktree({ start: true, issue: false, live: false }).ok, false);
  assert.equal(mayWorktree({ start: false, issue: false, live: true }).ok, true);
  assert.deepEqual(mayWorktree({ start: false, issue: false, live: false, absent: true }), { ok: false, why: "It isn't among the open projects any more." });
});

test("one detail too big to fit doesn't push out the smaller ones", () => {
  const details = { "w1/issue/huge": { d: { description: "z".repeat(LIMITS.detailBytes) }, saved: NOW } };
  for (let i = 0; i < 5; i++) details[`w1/issue/s${i}`] = { d: { description: "small" }, saved: NOW - 1000 - i };
  const out = applyPatch(empty("details"), { who: here, details }, "details", NOW);
  assert.ok(!("w1/issue/huge" in out.details));
  assert.equal(Object.keys(out.details).length, 5);
});
