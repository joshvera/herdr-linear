// Where the cmd-l popup was, as data: what's saved when it closes, whether
// it's fresh enough to go back to, which row is chosen as lists change under
// it, and the new issue's draft. No imports, so node can run these
// (test/view.test.mjs); main.js keeps them in its localStorage.

export const SPOT_VERSION = 1;
// Closed longer ago than this, the popup opens on its list instead.
export const SPOT_TTL = 2 * 3600 * 1000;

const SCREENS = new Set(["list", "issue", "project", "create"]);
const TABS = new Set(["mine", "projects", "recent"]);

// Whether a copy was opened by something with a place in mind (another mod
// on an issue, the demo): those go where they're told and keep no spot or
// draft. props() always has `overlay`, so that alone doesn't count.
export function openedWithProps(p) {
  return Boolean(p?.issue || p?.demo || p?.backTo || p?.back);
}

// The spot to save, from the popup's state.
export function snapshot(s, now) {
  return {
    version: SPOT_VERSION,
    at: now,
    ws: s.ws ?? "",
    screen: s.screen,
    tab: s.tab,
    drilled: s.drilled ?? null,
    drillFrom: Boolean(s.drillFrom),
    filter: s.filter ?? "",
    sel: s.sel ?? null,
    row: s.row ?? 0,
    issue: s.screen === "issue" ? s.issue ?? null : null,
    project: s.screen === "project" ? s.project ?? null : null,
  };
}

// The spot to go back to, or null: none, unreadable, another version, or
// older than the TTL. An issue or project screen without its row, or a
// screen this version doesn't know, comes back as the list.
export function restore(text, now) {
  let s;
  try {
    s = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return null;
  }
  if (!s || typeof s !== "object" || s.version !== SPOT_VERSION || !Number.isFinite(s.at)) return null;
  if (now - s.at > SPOT_TTL || now < s.at - 60000) return null;
  let screen = SCREENS.has(s.screen) ? s.screen : "list";
  if (screen === "issue" && !s.issue?.id) screen = "list";
  if (screen === "project" && !s.project?.id) screen = "list";
  return {
    ws: typeof s.ws === "string" ? s.ws : "",
    screen,
    tab: TABS.has(s.tab) ? s.tab : "mine",
    drilled: s.drilled?.id ? s.drilled : null,
    drillFrom: Boolean(s.drillFrom && s.drilled?.id),
    filter: typeof s.filter === "string" ? s.filter : "",
    sel: typeof s.sel === "string" ? s.sel : null,
    row: Number.isInteger(s.row) && s.row >= 0 ? s.row : 0,
    issue: screen === "issue" ? s.issue : null,
    project: screen === "project" ? s.project : null,
  };
}

// ── the chosen row ─────────────────────────────────────────────────────────

// The index of the chosen row in `rows` (each { id }): the one with id
// `sel`, else the row now where it was (`row`), clamped; -1 with no rows.
export function pickRow(rows, sel, row) {
  if (!rows.length) return -1;
  if (sel != null) {
    const i = rows.findIndex((r) => r.id === sel);
    if (i >= 0) return i;
  }
  return Math.max(0, Math.min(row ?? 0, rows.length - 1));
}

// ── the new issue's draft ──────────────────────────────────────────────────

export function emptyDraft(ws) {
  return { ws, title: "", description: "", teamKey: "", stateId: "", priority: 0, projectId: "", assignToMe: true, sentAt: 0 };
}

// The drafts, one per workspace ({ <ws>: draft }), so a form typed in one
// workspace never touches another's. Junk entries are left out.
export function readDrafts(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return {};
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return {};
  const out = {};
  for (const [ws, d] of Object.entries(m)) {
    if (d && typeof d === "object" && d.ws === ws && ws) out[ws] = { ...emptyDraft(ws), ...d };
  }
  return out;
}

// The drafts with workspace `ws`'s replaced (null: removed).
export function withDraft(drafts, ws, d) {
  const out = { ...drafts };
  if (d) out[ws] = d;
  else delete out[ws];
  return out;
}

// Whether a draft has anything worth keeping: typed text. Emptying both
// fields clears it.
export function hasText(d) {
  return Boolean(d && (d.title.trim() || d.description.trim()));
}

// The draft for the form opening in workspace `ws`, if it has text.
export function draftFor(drafts, ws) {
  const d = drafts?.[ws];
  return d && d.ws === ws && hasText(d) ? d : null;
}

// What enter does with the draft: "send", or "confirm" when a create from
// it was already sent (the popup closed mid-send, so it may exist), which
// clears `sentAt` so the next enter sends.
export function onEnter(d) {
  return d?.sentAt ? "confirm" : "send";
}

// Workspace `ws`'s draft from the form, keeping what the form doesn't hold
// (its sentAt). Another workspace's draft is never its base.
export function fromForm(d, ws, form, title, description) {
  const base = d?.ws === ws ? d : emptyDraft(ws);
  return {
    ...base,
    ws,
    title,
    description,
    teamKey: form?.team?.key ?? base.teamKey ?? "",
    stateId: form?.state ?? "",
    priority: form?.priority ?? 0,
    projectId: form?.project ?? "",
    assignToMe: form?.assignToMe ?? true,
  };
}
