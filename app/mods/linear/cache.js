// The popup's cache, as data: what the two files hold, whose they are, how
// two copies' writes combine, how a write retries, and the rules for what a
// cached thing may replace or allow. No imports, so node can run the rules
// on their own (test/cache.test.mjs); store.js reads and writes the files.
//
//   an answer ──► patch { who, lists | details | workspaces | drop | clear }
//                   │
//   read file ──► parse (bad or old version: empty) ──► apply patch
//                   │   same machine: union by key, newer `saved` wins
//                   │   other machine: the newer `who.at` has the whole file
//                   ▼
//                 prune (rows, counts, age, bytes) ──► write if the file is
//                                                      still what was read
//
// Keys start with the workspace id: "<ws>/mine", "<ws>/project/<id>",
// "<ws>/issue/<id>". Times are ms since the epoch: `saved` is when the
// request that answered was sent; `who.at` when the machine was confirmed.

export const VERSION = 2;

export const LIMITS = {
  // Rows kept per list: the fresh answer shows them all.
  rows: 100,
  projectLists: 20,
  states: 30,
  // readTextFile stops at 1 MiB, and a file it can't read can't be rewritten
  // with compare-and-swap, so each file stays well under.
  listBytes: 400 * 1024,
  details: 50,
  detailBytes: 600 * 1024,
  detailAge: 30 * 24 * 3600 * 1000,
};

const MAPS = { lists: ["lists"], details: ["details"] };

export function empty(kind, who = null) {
  const doc = { version: VERSION, who };
  for (const m of MAPS[kind]) doc[m] = {};
  if (kind === "lists") doc.workspaces = [];
  return doc;
}

// A file's text as a document of `kind` ("lists" or "details"). Anything
// else (missing, unparseable, another version) is an empty one: the cache
// is a convenience, never an error.
export function parse(text, kind) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty(kind);
  }
  if (!raw || typeof raw !== "object" || raw.version !== VERSION) return empty(kind);
  const doc = empty(kind, parseWho(raw.who));
  for (const m of MAPS[kind]) {
    for (const [k, e] of Object.entries(raw[m] ?? {})) {
      if (e && typeof e === "object" && Number.isFinite(e.saved) && k.includes("/")) doc[m][k] = e;
    }
  }
  if (kind === "lists" && Array.isArray(raw.workspaces)) {
    doc.workspaces = raw.workspaces.filter((w) => typeof w?.id === "string" && w.id);
  }
  return doc;
}

function parseWho(w) {
  if (!w || typeof w !== "object" || typeof w.machine !== "string" || !Number.isFinite(w.at)) return null;
  return { machine: w.machine, at: w.at };
}

// ── who ────────────────────────────────────────────────────────────────────

// Who answers for Linear: the machine ("" for this computer) whose sign-in
// the popup uses, and when that was confirmed. Workspaces aren't part of
// it: one missing from status may only be a locked keychain, so a
// workspace's entries go only when a load for it answers signed out.
export function whoOf(machine, at) {
  return { machine: machine ?? "", at };
}

export function sameWho(a, b) {
  return Boolean(a && b) && a.machine === b.machine;
}

export const wsOf = (key) => key.slice(0, key.indexOf("/"));

// ── writes ─────────────────────────────────────────────────────────────────

// A copy's write onto what the file holds now. `patch`:
//   who           the who it was answered under (required)
//   base          the file's `who.at` when this copy last read or claimed
//                 it: another machine's who replaces the file only if this
//                 copy had seen it, so a copy that never saw a switch
//                 can't switch it back
//   lists/details entries by key
//   workspaces    what status said, for the workspace switcher
//   drop          workspace ids whose loads answered signed out
//   clear         signed out everywhere: nothing kept
// Returns the document to write, or null when the write is out of date (the
// file belongs to a machine confirmed after this copy's) or has no who.
export function applyPatch(doc, patch, kind, now) {
  if (!patch?.who) return null;
  let out;
  if (doc.who && sameWho(doc.who, patch.who)) {
    out = { ...doc, who: doc.who.at >= patch.who.at ? doc.who : patch.who };
    for (const m of MAPS[kind]) out[m] = { ...doc[m] };
  } else {
    if (doc.who && (doc.who.at > patch.who.at || (patch.base ?? 0) < doc.who.at)) return null;
    out = empty(kind, patch.who);
  }
  if (patch.clear) return empty(kind, out.who);
  const dropped = new Set(patch.drop ?? []);
  for (const m of MAPS[kind]) {
    for (const k of Object.keys(out[m])) if (dropped.has(wsOf(k))) delete out[m][k];
    for (const [k, e] of Object.entries(patch[m] ?? {})) {
      if (dropped.has(wsOf(k))) continue;
      const cur = out[m][k];
      if (!cur || e.saved >= cur.saved) out[m][k] = e;
    }
  }
  if (kind === "lists") {
    const ws = patch.workspaces ?? out.workspaces ?? [];
    out.workspaces = ws.filter((w) => !dropped.has(w.id));
  }
  return prune(out, kind, now);
}

// Caps, applied to the merged document, so a file is bounded by
// construction and an entry pruned here can't come back through another
// copy's write (its patch is merged before this runs).
export function prune(doc, kind, now) {
  const out = { ...doc };
  if (kind === "details") {
    const live = Object.entries(doc.details).filter(([, e]) => now - e.saved <= LIMITS.detailAge);
    out.details = newest(live, LIMITS.details, LIMITS.detailBytes);
    return out;
  }
  const lists = {};
  const projects = [];
  const states = [];
  for (const [k, e] of Object.entries(doc.lists)) {
    const capped = capRows(e);
    if (k.includes("/project/")) projects.push([k, capped]);
    else if (k.includes("/states/")) states.push([k, capped]);
    else lists[k] = capped;
  }
  Object.assign(lists, newest(projects, LIMITS.projectLists, Infinity), newest(states, LIMITS.states, Infinity));
  out.lists = lists;
  // Still too big: project lists go first, oldest first; then other
  // workspaces, the one saved least recently first; then the rows of the
  // workspace kept, halved, so it always keeps something.
  const size = () => utf8Length(JSON.stringify(out));
  while (size() > LIMITS.listBytes) {
    const entries = Object.entries(out.lists);
    const projs = entries.filter(([k]) => k.includes("/project/")).sort((a, b) => a[1].saved - b[1].saved);
    if (projs.length) {
      delete out.lists[projs[0][0]];
      continue;
    }
    const last = new Map();
    for (const [k, e] of entries) last.set(wsOf(k), Math.max(last.get(wsOf(k)) ?? 0, e.saved));
    if (last.size > 1) {
      const oldest = [...last].sort((a, b) => a[1] - b[1])[0][0];
      out.lists = Object.fromEntries(entries.filter(([k]) => wsOf(k) !== oldest));
      continue;
    }
    const big = entries.filter(([, e]) => Array.isArray(e.items) && e.items.length > 10).sort((a, b) => b[1].items.length - a[1].items.length)[0];
    if (!big) break;
    const [k, e] = big;
    out.lists = { ...out.lists, [k]: { ...e, items: e.items.slice(0, Math.ceil(e.items.length / 2)), total: e.total ?? e.items.length } };
  }
  return out;
}

function capRows(e) {
  if (!Array.isArray(e.items) || e.items.length <= LIMITS.rows) return e;
  return { ...e, items: e.items.slice(0, LIMITS.rows), total: e.total ?? e.items.length };
}

// At most `count` entries, newest first, together at most `bytes` long.
function newest(entries, count, bytes) {
  const out = {};
  let size = 0;
  for (const [k, e] of [...entries].sort((a, b) => b[1].saved - a[1].saved).slice(0, count)) {
    const n = utf8Length(JSON.stringify(k)) + utf8Length(JSON.stringify(e)) + 2;
    if (size + n > bytes) continue; // too big to fit: the smaller ones after it still may
    size += n;
    out[k] = e;
  }
  return out;
}

// What a string takes in UTF-8, without TextEncoder.
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// One write: read, apply the patch, write only if the file is still what
// was read (herdr's compare-and-swap), else read again; at most `tries`
// times, then give up. Never throws: whether it wrote. `io` is
// { read(path): text | null, write(path, text, expected) }.
export async function writeWith(io, path, kind, patch, now, tries = 3) {
  for (let i = 0; i < tries; i++) {
    let text;
    try {
      text = await io.read(path);
    } catch {
      return false;
    }
    const next = applyPatch(parse(text, kind), patch, kind, now());
    if (!next) return false;
    try {
      await io.write(path, JSON.stringify(next), text ?? null);
      return true;
    } catch {}
  }
  return false;
}

// Runs async jobs one after another, each after the last has settled.
export function serial() {
  let tail = Promise.resolve();
  return (job) => {
    const p = tail.then(job, job);
    tail = p.catch(() => {});
    return p;
  };
}

// Request stamps for one copy: the time, but never the same twice and never
// going back, so the later of two requests always has the larger stamp.
export function stamper(now) {
  let last = 0;
  return () => (last = Math.max(now(), last + 1));
}

// ── lists ──────────────────────────────────────────────────────────────────

// A list from the cache, into `l` in place (a load in flight holds that
// object and answers into it). Never over an answer that came live.
export function seed(l, kept) {
  if (!kept || !Array.isArray(kept.items) || (l.loaded && !l.cached)) return false;
  Object.assign(l, { items: kept.items, total: kept.total ?? kept.items.length, warning: kept.warning ?? "", loaded: true, cached: true, saved: kept.saved, error: "" });
  return true;
}

// ── details ────────────────────────────────────────────────────────────────

// Whether `next` ({ ws, id, at, cached }) may replace what's shown
// (`shown`, the same shape, or null) on a screen showing `want` ({ ws, id }).
// Another workspace's or issue's answer never; a cached one only fills an
// empty screen or replaces an older cached one; a live one replaces any
// cached one, and never a live one newer than itself.
export function takesOver(want, shown, next) {
  if (!want || next.ws !== want.ws || next.id !== want.id) return false;
  if (!shown || shown.ws !== want.ws || shown.id !== want.id) return true;
  if (next.cached) return Boolean(shown.cached) && next.at > shown.at;
  return Boolean(shown.cached) || next.at > shown.at;
}

// Whether a failed or empty answer means the issue or project is gone (not
// there, or not yours to see) rather than unreachable. The binary passes
// Linear's message on as "Linear: <message>"; the demo says "no such
// issue"; and an issue Linear answers as null comes back with no id.
export function isGone(errOrAnswer) {
  if (errOrAnswer == null) return false;
  if (typeof errOrAnswer === "object" && !(errOrAnswer instanceof Error) && "issue" in errOrAnswer) {
    return !errOrAnswer.issue?.id;
  }
  const msg = String(errOrAnswer?.message ?? errOrAnswer);
  return /entity not found|no such issue|no such project|could not find/i.test(msg);
}

// The quiet mark on something shown from the cache: being refreshed, or why
// it couldn't be, and how old it is. "" when it's live.
export function staleMark(cached, saved, error, loading, now) {
  if (!cached) return "";
  const from = Number.isFinite(saved) ? `from ${when(saved, now)}` : "from before";
  if (error) return `${error} · showing ${from}`;
  return loading ? `Refreshing… · ${from}` : from;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function when(ms, now) {
  const t = new Date(ms);
  const n = new Date(now);
  if (t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate()) {
    return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  }
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`;
}

// ── what cached data may do ────────────────────────────────────────────────
// Each answers { ok, why }: `why` is what to say when refused.

const refreshing = (err) => ({ ok: false, why: err || "Refreshing…" });

// The status menu and set-state: built from the detail's states and the
// issue's state, so only on a live detail.
export function mayChangeState(detail) {
  if (!detail?.d) return refreshing("Still loading…");
  if (detail.cached) return refreshing(detail.error);
  return { ok: true, why: "" };
}

// Create: the teams live; the chosen team's states live if a status was
// picked; the Projects list live if a project is set. Each one's fetch
// error is said rather than "Refreshing…", so a failure never leaves it
// shut without a reason.
export function mayCreate({ teams, states, projects, stateChosen, projectSet }) {
  for (const [need, l] of [[true, teams], [stateChosen, states], [projectSet, projects]]) {
    if (!need) continue;
    if (!l?.loaded) return refreshing(l?.error);
    if (l.cached) return refreshing(l.error);
  }
  return { ok: true, why: "" };
}

// A worktree: starting an issue re-reads it in the binary first and builds
// the worktree from that answer, so any row will do; otherwise the branch,
// team and title come from the row, so it must be from a live answer.
// `absent`: the live list answered without it (a project completed or
// canceled leaves the open projects), so waiting won't help.
export function mayWorktree({ start, issue, live, absent }) {
  if (start && issue) return { ok: true, why: "" };
  if (live) return { ok: true, why: "" };
  return absent ? { ok: false, why: "It isn't among the open projects any more." } : refreshing("");
}
