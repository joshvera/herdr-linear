// main.js imports the herdr runtime, so node can't run it; it reads it.
// Every way to change Linear or make a worktree (keys, the state chip, the
// buttons and the footer's pills all end in these methods) must ask its gate
// first. Source checks: they prove the wiring is there, not that the screen
// refuses (that's on the hand-test list); the gates themselves are tested in
// cache.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../main.js", import.meta.url), "utf8");

// A method's body: from `  name(` at two spaces in, to the next `  }` there.
function span(name) {
  const start = src.search(new RegExp(`\\n  (?:async )?${name}\\(`));
  assert.ok(start >= 0, `main.js has no method ${name}`);
  return [start, src.indexOf("\n  }\n", start)];
}
const body = (name) => src.slice(...span(name));
const statements = (name) => body(name).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).slice(1);

const inside = (re, name) => {
  const [a, b] = span(name);
  const hits = [...src.matchAll(re)].map((m) => m.index);
  assert.ok(hits.length > 0, `main.js never sends ${re}`);
  for (const i of hits) assert.ok(i > a && i < b, `${re} sent outside ${name}`);
};

test("set-state is sent only from the status menu, which asks mayChangeState first", () => {
  inside(/op: "set-state"/g, "statusMenu");
  assert.match(statements("statusMenu")[0], /^if \(!this\.may\(mayChangeState\(/);
  // The menu's item runs later, after the detail may have been replaced.
  assert.match(body("statusMenu"), /run: \(cx\) => \{\s*if \(!this\.may\(mayChangeState\(/);
});

test("create is sent only from submit, which asks mayCreate first", () => {
  inside(/op: "create"/g, "submit");
  assert.ok(statements("submit").slice(0, 3).some((l) => /this\.may\(mayCreate\(/.test(l)), "submit asks mayCreate");
});

test("a worktree is made only from worktree(), which asks mayWorktree first", () => {
  inside(/op: "worktree"/g, "worktree");
  assert.ok(statements("worktree").slice(0, 4).some((l) => /this\.may\(mayWorktree\(/.test(l)), "worktree asks mayWorktree");
});

test("linear() takes the workspace from its caller and never reads this.ws", () => {
  assert.doesNotMatch(body("linear"), /this\.ws/);
});

test("a cached detail never reaches the list rows or the issue shown", () => {
  for (const name of ["showCachedDetail", "showCachedProject"]) {
    assert.doesNotMatch(body(name), /replaceRow|this\.cur =|this\.curProject =/);
  }
});

test("every localStorage write and every cache write goes through the check-aware helpers", () => {
  const sets = [...src.matchAll(/localStorage\.setItem\(/g)].map((m) => m.index);
  const [a, b] = span("remember");
  assert.ok(sets.length > 0 && sets.every((i) => i > a && i < b), "localStorage.setItem only inside remember()");
  assert.match(body("remember"), /checking\(\)/);
  assert.doesNotMatch(src, /fs\.writeFile|writeTextFile\(/, "cache files are written only by store.js");
});

test("the selection is an id: moving sets sel, and the row acted on is derived from it", () => {
  for (const k of ["down", "up", "pagedown", "pageup"]) assert.match(body("listKey"), new RegExp(`k === "${k}" && n\\) this\\.select\\(`));
  assert.doesNotMatch(body("listKey"), /this\.at =/, "keys never move the index alone");
  assert.match(body("listView"), /this\.select\(e\.row\)/, "a click chooses by id too");
  assert.match(body("chooseRow"), /pickRow\(/);
  assert.match(body("render"), /this\.chooseRow\(\)/);
});

test("a change to Linear is never sent again after a failure", () => {
  const l = body("linear");
  assert.ok(l.indexOf("if (CHANGES.has(req.op)) throw e;") >= 0 && l.indexOf("if (CHANGES.has(req.op)) throw e;") < l.indexOf("await this.findLinear();\n      return ask("));
  assert.match(src, /const CHANGES = new Set\(\["create", "set-state", "start"\]\)/);
});

test("a failed create keeps the draft marked as sent, written to disk before it goes", () => {
  const b = body("submit");
  const catchAt = b.lastIndexOf("} catch (e) {");
  assert.doesNotMatch(b.slice(catchAt), /sentAt: 0/);
  assert.ok(b.indexOf("sentAt: Date.now()") < b.indexOf("await localStorage.flush()"));
  assert.ok(b.indexOf("await localStorage.flush()") < b.indexOf('op: "create"'));
});

test("status finding no one clears the screen but not the files", () => {
  assert.doesNotMatch(body("toSignedOut"), /store\.write/);
});

test("an answer asked under another sign-in is dropped as it lands", () => {
  for (const name of ["load", "loadDetail", "loadProjectDetail"]) {
    const b = body(name);
    assert.match(b, /const gen = this\.gen;/, name);
    assert.ok((b.match(/if \(gen !== this\.gen\) return;/g) ?? []).length >= 2, `${name} checks after an answer and after a failure`);
  }
});
