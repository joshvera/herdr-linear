// Where the popup was (view.js): node --test app/mods/linear/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPOT_TTL, openedWithProps, snapshot, restore, pickRow,
  emptyDraft, readDraft, hasText, draftFor, onEnter, fromForm,
} from "../view.js";

const NOW = 1_800_000_000_000;
const issue = { id: "i1", identifier: "ENG-1", title: "One", state: { name: "Todo" } };
const project = { id: "p1", name: "Proj", status: { name: "Started" }, teams: ["ENG"] };
const base = { ws: "w1", screen: "list", tab: "mine", filter: "", sel: null, row: 0 };
const round = (s, at = NOW) => restore(JSON.stringify(snapshot(s, at)), NOW);

test("each screen comes back as it was saved", () => {
  assert.deepEqual(round({ ...base, filter: "login", sel: "i1", row: 4 }), {
    ws: "w1", screen: "list", tab: "mine", drilled: null, drillFrom: false, filter: "login", sel: "i1", row: 4, issue: null, project: null,
  });
  assert.deepEqual(round({ ...base, screen: "issue", issue, sel: "i1" }).issue, issue);
  assert.deepEqual(round({ ...base, screen: "project", tab: "projects", project }).project, project);
  const drilled = round({ ...base, tab: "projects", drilled: project, drillFrom: true, sel: "i9" });
  assert.deepEqual([drilled.screen, drilled.drilled, drilled.drillFrom, drilled.sel], ["list", project, true, "i9"]);
  assert.equal(round({ ...base, screen: "create" }).screen, "create");
});

test("older than two hours, from the future, unreadable or another version: not restored", () => {
  assert.equal(round(base, NOW - SPOT_TTL - 1), null);
  assert.notEqual(round(base, NOW - SPOT_TTL + 1000), null);
  assert.equal(round(base, NOW + 3600 * 1000), null);
  assert.equal(restore("{nope", NOW), null);
  assert.equal(restore(null, NOW), null);
  assert.equal(restore(JSON.stringify({ ...snapshot(base, NOW), version: 99 }), NOW), null);
});

test("an issue or project screen without its row, or an unknown screen, comes back as the list", () => {
  assert.equal(round({ ...base, screen: "issue", issue: null }).screen, "list");
  assert.equal(round({ ...base, screen: "project", project: { name: "no id" } }).screen, "list");
  assert.equal(restore(JSON.stringify({ ...snapshot(base, NOW), screen: "settings" }), NOW).screen, "list");
  assert.equal(restore(JSON.stringify({ ...snapshot(base, NOW), tab: "bogus" }), NOW).tab, "mine");
});

test("only the plain cmd-l popup restores: a copy opened on an issue, back to a mod, or the demo doesn't", () => {
  assert.equal(openedWithProps({ overlay: "o1" }), false);
  assert.equal(openedWithProps(null), false);
  assert.equal(openedWithProps({ overlay: "o1", issue: { key: "ENG-1" } }), true);
  assert.equal(openedWithProps({ demo: true }), true);
  assert.equal(openedWithProps({ back: "github" }), true);
  assert.equal(openedWithProps({ backTo: { mod: "github" } }), true);
});

// ── the chosen row ───────────────────────────────────────────────────────

test("the chosen issue stays chosen when the fresh list comes back in another order", () => {
  const cached = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const fresh = [{ id: "c" }, { id: "x" }, { id: "a" }, { id: "b" }];
  const at = pickRow(cached, "b", 0);
  assert.equal(cached[at].id, "b");
  assert.equal(fresh[pickRow(fresh, "b", at)].id, "b");
});

test("when the chosen one is gone, the row now where it was, clamped", () => {
  assert.equal(pickRow([{ id: "a" }, { id: "b" }, { id: "c" }], "gone", 1), 1);
  assert.equal(pickRow([{ id: "a" }], "gone", 5), 0);
  assert.equal(pickRow([{ id: "a" }, { id: "b" }], null, 1), 1);
});

test("a frame with no rows chooses nothing (and so can't move the choice)", () => {
  assert.equal(pickRow([], "a", 3), -1);
});

// ── the draft ────────────────────────────────────────────────────────────

const typed = { ...emptyDraft("w1"), title: "Fix login" };

test("the draft comes back in its own workspace only", () => {
  assert.equal(draftFor(typed, "w1"), typed);
  assert.equal(draftFor(typed, "w2"), null);
  assert.equal(draftFor(null, "w1"), null);
});

test("emptying the title and description clears it", () => {
  assert.equal(hasText({ ...typed, title: "  " }), false);
  assert.equal(draftFor({ ...typed, title: "" }, "w1"), null);
  assert.equal(hasText({ ...typed, title: "", description: "notes" }), true);
});

test("a draft whose create was sent asks before sending again", () => {
  assert.equal(onEnter(typed), "send");
  assert.equal(onEnter({ ...typed, sentAt: NOW }), "confirm");
});

test("the draft reads back, with defaults for what an older one lacks; junk is none", () => {
  assert.deepEqual(readDraft(JSON.stringify({ ws: "w1", title: "x" })), { ...emptyDraft("w1"), title: "x" });
  assert.equal(readDraft("{"), null);
  assert.equal(readDraft(JSON.stringify({ title: "no workspace" })), null);
});

test("the draft takes the form's choices and keeps its own sentAt", () => {
  const form = { team: { key: "ENG" }, state: "s1", priority: 2, project: "p1", assignToMe: false };
  assert.deepEqual(fromForm({ ...typed, sentAt: 5 }, "w1", form, "T", "D"), {
    ws: "w1", title: "T", description: "D", teamKey: "ENG", stateId: "s1", priority: 2, projectId: "p1", assignToMe: false, sentAt: 5,
  });
  assert.equal(fromForm(null, "w1", { team: null }, "T", "").teamKey, "");
});
