# The Linear popup reopens where you left it, and shows what it knows at once

Status: reviewed twice (Opus, 2026-11-20). The second review's findings are
folded in (see "Second review" at the end) and built; they have not been
reviewed again apart from the whole-branch review of the build.

## Why

The user, in their words: "save state so closing and opening the modal
returns us to the exact spot no matter what sub-view we're at", and "add
caching to that too so results show up instantaneously".

Today (`app/mods/linear/main.js`, base 0.14.5):

- Closing the popup (`cmd-l`, esc) throws everything away but the tab
  (`localStorage "tab"`, `main.js:140`). Reopening always lands on the list,
  top row, empty filter. An issue you were reading, a project's issues you
  drilled into, the filter you typed and a half-written new issue are gone.
- `linear-cache.json` holds the three tabs' lists per workspace and the
  workspace list (`readCache`, `keep`, `main.js:322-363`). Everything else
  waits for an answer: a project's issues (`keep` skips `"project"`,
  `main.js:345`), an issue's detail (`loadDetail`), a project's detail
  (`openProject`), and the new issue form's teams and statuses (`create`,
  `pickTeam`).
- Even the cached tabs refresh late: `start()` asks `status` first
  (`findLinear`) and only then `loadAll` (`main.js:269-282`).
- The file has no version and no owner, is written with `fs.writeFile`
  (no compare-and-swap), is written under `herdr-app check`, and nothing
  stops an action from being built on cached data.
- The selection is an index (`this.at`, `main.js:1015-1022`), clamped every
  frame (`main.js:1446`): a list that changes order under it moves the
  highlight to another issue.

`cache.go` is the TUI picker's own cache (`stateDir()/lists.json`, used by
`tui.go`). The mod never reads it. It is not changed.

## Constraint: no binary change

The mod runs the herdr-linear release named by `LINEAR_VERSION`
(`main.js:21`), downloaded from the upstream repo's releases by `PROVISION`
(`app_test.go:25-31` pins it to `herdr-plugin.toml`). A Go change reaches
the mod only through a release, which this work may not make. So
everything here is in the mod, using only the ops 0.14.5 answers.

## Goals

1. **Restore.** Closing the popup and pressing `cmd-l` again lands on the
   same screen (list, drilled project list, issue, project, new issue
   form), the same workspace, tab, filter and selected row, with the
   selected row in sight and the text you had typed, if it was closed less
   than 2 hours ago (see Staleness).
2. **Cache.** Every list and detail the popup shows is drawn from the cache
   on the first frame after the cache file is read (milliseconds, no
   process), marked as being refreshed, and replaced by the fresh answer.
3. Fresh answers are asked for when the popup opens, without waiting for
   `status`.

## Not in this version

- **The exact scroll offset.** gpui-kit can't read a scroll offset
  (`ScrollHandle` has only `scroll_to_item`, `gpui-kit.d.ts:21331-21342`;
  `VirtualListScrollHandle` adds only `scroll_to_bottom`). The list is
  brought back with the selected row in its middle (below). An issue's or
  project's description opens at the top.
- **Open menus** (the status menu, the pull request chooser, the new
  issue's project dropdown). They are a moment of choosing on data that has
  to be fresh to act on. Not reopened.
- **Work in flight** when the popup closed (a start, a create, a status
  change). Restore never runs an action again. A create sent just before
  closing is handled for the draft (Change 4).
- **The filter's Linear search results** (`found`) are not cached: one
  query, under a second, and one more stale surface. A restored filter
  searches again as you'd typed it.
- **Refreshing while closed.** As for the GitHub mod: no background place
  for a mod without editing the user's layout.
- **Detecting a different Linear user in the same workspace**, and
  **telling a trashed issue from a live one.** `status` answers no viewer
  (`app.go:443-457`), and the issue fields have no `trashed` or
  `archivedAt` (`linear.go:200-206`). Both need a binary change in a later
  release. See Whose cache it is and What is gone.
- The TUI picker. The demo (nothing about the demo is cached or restored).

## Must not happen

1. **Acting on old data.** A choice built from cached fields is not offered
   or accepted until the data it is built from is fresh. See What cached
   data may do.
2. **Old data that looks current.** Anything drawn from the cache carries a
   quiet mark that it is being refreshed. If the refresh fails, the mark
   becomes the error and the age, never a silent stale view.
3. **Another account's data.** See Whose cache it is.
4. **Cached data replacing fresher data.** A cache read that finishes after
   a live answer never replaces it, for lists and details. A cached detail
   never changes a list row.
5. **Two writers losing each other's data**, or one writing its account's
   data into another's file. Two copies of the popup can be alive at once
   (`cmd-l`'s, and one opened on an issue from the GitHub mod or Recap).
6. **One workspace's data shown or stored as another's**, or one issue's or
   project's as another's.
7. **Writes under `herdr-app check`.** It runs `init` for real. No cache
   file write and no `localStorage` write while `checking()`: every
   `localStorage.setItem` in the mod (today's `on`, `workspace`, `tab`,
   `trees`, `team`, and the new `view`, `draft`) goes through one helper
   that checks it.
8. **Restore acting.** Reopening never sends anything to Linear but reads.
9. **The highlight moving to another issue** because a list refreshed.
10. **Losing typed text in the `cmd-l` popup.** Its new issue draft
    survives a close, a reopen and a restart until the issue is created or
    the user empties it. (A copy opened from another mod keeps no draft:
    it has its own store, see Where state lives, and is a quick look.)
11. **A duplicate issue** from a draft whose create was already sent.

## Where state lives

- **The spot** (what screen, which row, the filter) is the `cmd-l` popup's
  own: `localStorage` under `"view"`. `localStorage` is per mod copy
  (`AGENTS.md:980`). Inferred, not documented: the store is chosen by the
  copy's props without `overlay` (`data/linear/` holds four hashed stores;
  the `cmd-l` one keeps `on` and `trees` across opens). Hand-tested. Being
  synchronous, it puts the right screen on the first frame.
- **The draft**: same store, under `"draft"`, apart from the spot (its own
  lifetime).
- **"Opened with props"** means `p.issue || p.demo || p.backTo || p.back`
  (`props()` always has `overlay`). Such copies never restore, never save a
  spot and keep no draft.
- **Data from Linear, and which machine answers** (`on`), are shared by
  every copy: in the cache files, written with compare-and-swap. Today's
  per-copy `localStorage "on"` is read once as a fallback when the file
  has none, and no longer written.

## Staleness and what is gone (my calls)

- **The spot is restored if it was saved less than 2 hours ago.** Past
  that, the popup opens on the list, on the tab it was on, empty filter,
  top row, as today. Two hours covers stepping away to a terminal and
  back; after lunch or a night, the list is the better start. The spot is
  saved on each change and on close, so it ages from the close.
- **The draft does not expire.** If the spot is too stale but a draft is
  kept, the list says once: "A new issue draft is kept: ctrl+n".
- **The spot is dropped** (list, as today) when it doesn't parse or has
  another version, or later when a load for its workspace answers signed
  out. It is not checked against the cache's workspace list before
  `status` (a cache just reset by the version bump would drop a good spot).
- **The selected row** is an id, always (Change 5): if it's gone from a
  fresh list, the row now at its old position (clamped) is chosen.
- **An issue is gone** when its fresh `detail` fails with Linear's
  not-found message (`"Linear: " + message`, `linear.go:94`; "Entity not
  found", or the demo's "no such issue", `demo.go:296`) or answers with an
  empty `issue.id` (`freshIssue` returns a zero issue and no error when
  `issue` is null, `linear.go:346-352`). The rule is one pure function,
  `isGone(error | answer)`. Then: back to the list with "ENG-123 is gone, or
  you can't see it any more." Any other failure keeps the cached screen
  with the error mark. A *trashed* issue still answers and is restored as
  live: a known gap (Not in this version).
- **A project is gone** only when the `project` op or the drilled list
  fails with the not-found message. Not when it's missing from the Projects
  list: that list leaves out completed and canceled projects
  (`linear.go:320`) and stops at 1000 with a warning (`linear.go:216-219`).
  Then: back to the Projects tab with "<name> is gone, or you can't see it
  any more."
- **Nothing cached for the restored issue or project**: the screen comes
  back from the row the spot kept (identifier, title, state) and "Loading…"
  for the rest.

## The spot's format

```json
{ "version": 1, "at": 1795017543000, "ws": "<workspace id>",
  "screen": "list" | "issue" | "project" | "create",
  "tab": "mine" | "projects" | "recent",
  "drilled": { ...the project row } | null, "drillFrom": false,
  "filter": "text",
  "sel": "<issue or project id>" | null, "row": 0,
  "issue": { ...the issue row } | null,
  "project": { ...the project row } | null }
```

`at`: when it was saved. `row`: the selected row's index, used only when
`sel` is gone. Written when any of these change and in `close()` (then
`localStorage.flush()`), never per frame. `view.js` (no imports) makes it
(`snapshot`) and reads it back (`restore(spot, now)`), so node tests it.

**The list on restore.** On the first render whose rows include `sel`,
`scroll_to_item(entryOf[at], "center")`, once. `"top"` is documented only
as "the near edge" (`gpui-kit.d.ts:21353-21356`) and the render range is
measured twice per frame, so neither is a reliable way to reproduce the
offset. Hand-tested.

## The cache files

Two files in the app's folder, as the GitHub mod's (`cache.js`, `store.js`
there), version 2:

- `linear-lists.json` (lists; read on every open). A new name: today's
  `linear-cache.json` was written uncapped and may be past `readTextFile`'s
  1 MiB, which would block every compare-and-swap. The old file is left
  alone and no longer read:
  ```json
  { "version": 2,
    "who": { "machine": "", "at": 1795017543000 },
    "workspaces": [{ "id": "...", "name": "...", "urlKey": "..." }],
    "lists": { "<ws>/mine": { "items": [], "warning": "", "saved": 0 },
               "<ws>/projects": {...}, "<ws>/recent": {...},
               "<ws>/project/<project id>": {...},
               "<ws>/teams": { "items": [], "saved": 0 },
               "<ws>/states/<team id>": { "items": [], "saved": 0 } } }
  ```
- `linear-details.json` (read when an issue or project opens, or restore
  lands on one): `{ "version": 2, "who": {...}, "details": {
  "<ws>/issue/<id>": { "d": <detail answer>, "saved": 0 },
  "<ws>/project/<id>": { "d": <project answer>, "saved": 0 } } }`.

Rules:

- **Version.** A missing or other version, or a file that doesn't parse,
  is an empty cache, replaced by the first write. Never an error on screen.
- **Writing.** `fs` has no rename. `writeTextFile(path, text, expected)`
  (`herdr.d.ts:30-32`): read, apply the patch, write with the text read as
  `expected`; on rejection re-read and retry, 3 times, then give up
  quietly. `readTextFile` (1 MiB cap) for reading.
- **One write at a time per copy** (a serial queue).
- **Every patch carries the who it was answered under** (see Whose cache
  it is). Applying a patch to the file:
  - same who: union by key, for the same key the newer `saved` wins;
  - another who, older than the file's: nothing is written;
  - another who, newer: the whole file is replaced by the patch.
  Then caps and pruning on the result, so a pruned entry can't come back
  through the other writer.
- **`saved`** is when the request was sent (a per-copy stamp that never
  repeats), so a slow old answer never beats a later one.
- **Caps, so a file is bounded by construction** (measured: ~630 B per row
  in today's file; a tab can return 1000 rows, `linear.go:216`):
  - each list keeps its first 100 rows (the list says "100 of N shown from
    before" while cached; the fresh answer shows all);
  - project lists: 20, oldest first; states: 30 teams;
  - then, while the lists file is over 400 KB, whole workspaces go, the
    one saved least recently first;
  - details: 50 and 600 KB, oldest first; an entry older than 30 days
    goes.
  A test builds the worst case (3 workspaces × 3 tabs × 1000 long rows, 20
  project lists, 30 states) and asserts the written text is under 400 KB.
- **Under `checking()`**, and **in the demo**: nothing is read or written.

## Whose cache it is

The binary is asked as one machine (`on`, `""` this computer) and one
workspace (`ws`); tokens are per workspace (`account(w.ID)`,
`workspace.go:27`). **Who** is `{ machine, at }`: the machine that answers
for Linear, and when that was last confirmed. Every entry is also under a
workspace id.

- `findLinear` starts from the file's `who.machine` (shared by every copy),
  so two copies settle on the same machine instead of each trying its own
  first.
- **Before `status` answers**, a copy loads on the file's who. A successful
  answer from machine M for workspace W proves M has W (`appClient`,
  `app.go:182-203`), so its patch carries the file's who unchanged.
- **When `status` answers:**
  - the same machine: who's `at` is refreshed; nothing is dropped;
  - another machine (the old one no longer has a signed-in workspace, and
    `findLinear` moved on): a new who with a newer `at`. Its first patch
    replaces both files whole; the screen drops every seeded list, cached
    detail and the spot before the next frame, and loads fresh. A copy
    still on the old who can't write back (its patches are older).
- **A workspace missing from `status`** is *unknown*, not signed out:
  `appStatus` lists a workspace only if its token reads
  (`app.go:451-455`), and a locked keychain or absent D-Bus looks the same.
  A workspace's entries are dropped (screen and files) only when a load for
  it answers `signedOut` (`AppError.signedOut`, `main.js:64`). If that's the
  shown workspace, the popup goes to the first signed-in one and loads it,
  and the spot is dropped.
- **Signed out everywhere**: the screen goes to the list (`screen =
  "list"`, `cur`, `detail`, `projDetail`, `form` cleared, spot dropped; the
  sign-in view is drawn only on the list, `main.js:1482`), rows cleared,
  both files emptied.
- **The gap.** Signing in as a different user of the same workspace looks
  the same to `status`. The refresh on open replaces that data within one
  round trip. Until then the status change and Create are refused (What
  cached data may do); `s`, `ctrl-s` and `w` are offered but re-read the
  issue or take a fresh row first. Closing it needs the viewer from
  `status`: a later release.

## Changes

### 1. The cache module and store

`app/mods/linear/cache.js`, no imports: `parse`, `whoOf`, `sameWho`,
`applyPatch` (who rule, merge, prune), `writeWith` (compare-and-swap loop),
`serial`, `stamper`, `seed(l, kept)` (in place, never over a live list),
`takesOver(shown, next)`, `isGone`, `staleMark`, `mayChangeState`,
`mayCreate`, `mayWorktree`. `store.js` wraps `readTextFile`,
`writeTextFile` and `checking()`, as the GitHub mod's does.

### 2. Lists at once, and asked at once

- Read `linear-cache.json` first thing in `init` and seed every tab's list
  and the drilled project's list. Until the read finishes, the list body
  draws nothing rather than "Loading…".
- **Seeding is in place**: `seed` assigns into the list object a load in
  flight holds (today's `seedAll` replaces it, `main.js:340`, which would
  orphan an answer now that loads can start first). `loadProject` stops
  nulling the slot (`main.js:395`); a list for another project is a
  different key.
- With a known machine and workspace, every load starts at once, alongside
  `status`. One `findLinear` in flight is shared. A load that fails as
  unreachable falls back to `findLinear`, then loads again.
- **The workspace is explicit.** `linear(req, ws)` takes it and never
  re-reads `this.ws`, also on its retry after `findLinear`
  (`main.js:253-263` re-reads it today). `load` captures the workspace and,
  for a project's issues, the project id when it sends, stores the answer
  under them, and shows it only if they are still what's shown.
- Cache reads and answers re-check `this.demo` when they apply (the demo
  can be switched on mid-read, `main.js:209-215`).

### 3. Details at once

- `openIssue` and `openProject` show a cached detail at once if there is
  one, with the mark, and ask for the fresh one. `openByKey` still asks
  `find` first (it has only a key), then does the same.
- **Applying a detail is one pure function** (`takesOver` and
  `applyDetail` in `cache.js`): it applies only if the answer's workspace
  and issue (or project) id are what's shown, and its request started after
  the shown one's, or the shown one is cached and it's live. A cached
  detail sets only the shown detail and its `cached` flag. Only a live one
  goes on to `this.cur = d.issue` and `replaceRow` (`main.js:516-518`).
  `openProject` gets the same identity check (it has none today,
  `main.js:541-548`).
- The header (from the restored or listed row) and a cached body may
  briefly disagree on the state; the fresh answer settles both.
- The fresh answer is written to `linear-details.json`.
- A failed refresh keeps the cached screen; the mark becomes the error and
  its age ("from 14:02", or "from 18 Nov" when not today); `r` tries again.
  Gone: see Staleness and what is gone.

### 4. The new issue form and its draft

- `teams` and each team's `states` come from the cache at once, refreshed
  as today. A failed `states` fetch says so (today it's swallowed,
  `main.js:839`).
- **The draft** (`cmd-l` popup only): `{ ws, title, description, teamKey,
  stateId, priority, projectId, assignToMe, sentAt }`, saved as the form
  changes.
  - It's put back when the form opens in its workspace (restore, `n`,
    `ctrl-n`). In another workspace the form starts empty and the draft
    stays for its own.
  - It wins over the context project: `n` on project B's screen with a
    draft for project A opens the draft, project A. Without a draft, the
    context project as today.
  - It's applied after the teams answer and `pickTeam` (which resets the
    status and may clear the project, `main.js:832-834`). A team, status or
    project the fresh answers don't have falls back to today's default.
  - Emptying the title and description clears it. Esc keeps it.
  - **Sending**: `sentAt` is saved before the create is sent. On success
    the draft is cleared. On failure `sentAt` is cleared. A draft that
    comes back with `sentAt` set (the popup closed mid-send) shows "Sent at
    14:02; it may already exist (see Recent)", and the first enter only
    clears `sentAt`; a second enter sends.

### 5. Restore, and the selection by id

- **`this.sel` (an id) is the selection** for the whole session. `at` is
  derived from it on every render, after every seed, fresh answer, filter
  change and refresh: the row with that id, else the row at the old
  position, clamped. Moving the cursor sets `sel`. A frame with no rows
  (before the cache read) leaves `sel` alone. `ctrl-s`, `ctrl-o` and enter
  act on the row with id `sel`.
- `init`: unless opened with props, read `"view"` and `"draft"`. If the
  spot is fresh enough, set screen, workspace, tab, filter, drill, `sel`
  and the issue or project before the first render. The filter is set into
  the input before its `change` listener is registered (whether
  `set_value` fires `change` is undocumented, and the handler resets the
  row and searches, `main.js:161-166`). Then read the cache and seed.
- Save the spot when it changes and in `close()`.

## What cached data may do

| Built from | Action | While cached |
|---|---|---|
| `detail.states`, `detail.issue.state` | status menu (`c`, the state chip), its items, `set-state` | refused: "Refreshing…", or the refresh's error |
| `teams`, the chosen team's `states` (only if a status was picked), the Projects list (only if a project is set) | Create issue (enter, the button) | refused: "Refreshing…", or the failed fetch's error |
| an issue row, for **start** (`s`, `ctrl-s`, Start button) | `check-start` re-reads it (`app.go:348-357`) and the worktree is built from that answer (`main.js:731-735`) | allowed |
| an issue row, for **worktree only** (`w`), or a project row (`w`, `s`) | the worktree's branch, team, title come from the client (`appWorktree` trusts them, `app.go:481-517`) | refused until that row is from a live answer (the issue's fresh detail, or a live Projects list) |
| anything | `o`, `y`, `b`, `g`, `r`, moving, tabs, filter | allowed |

Each check is one pure function (`mayChangeState`, `mayCreate`,
`mayWorktree`) asked first by every caller, because clicks call these
methods directly (the state chip, `main.js:1251`; the create button,
`main.js:1362`; the start button, `main.js:1276`; the footer pills).

## Tests

`node --test app/mods/linear/test/*.test.mjs` (node 24; here through
`mise x node@24.16.0 --`). Added to `.github/workflows/test.yml` with
`actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`, as
the GitHub mod's workflow pins it.

What can fail on the base commit and what can't: `cache.js` and `view.js`
are new, so their tests are new-behaviour tests (on base they fail only by
import error, which proves nothing). The main.js source checks
(`callers.test.mjs`) run against today's main.js and must fail there for
the right reason (the gate is absent), which is shown before the change.

- `cache.js`: version and parse; who: a newer who replaces the file, an
  older one writes nothing ("a copy still on the old machine can't write
  its rows back"); same who unions; newer `saved` wins; caps after merge
  and "a pruned entry isn't brought back by the other writer"; the byte
  bound worst case; CAS retry and give up; `seed` keeps the list object
  and never goes over a live list; `takesOver`/`applyDetail` with another
  id, another workspace, older stamp, cached over live; `isGone` against
  "Linear: Entity not found: Issue", "no such issue", an empty id, and a
  timeout (not gone); `staleMark` today and another day; the three gates.
- `view.js`: snapshot round trip for each screen; older than 2 hours not
  restored; props copies never restore; the selection kept by id across a
  cached list then a reordered fresh list; the old position when the id
  is gone; no row change on a frame with no rows; the draft: other
  workspace, cleared when emptied, `sentAt` needs two enters.
- `callers.test.mjs`: every `op: "set-state"` lies inside the gated
  method, every `op: "create"` inside `submit`, every worktree send inside
  `worktree`, and each asks its gate as its first statement; `linear()`
  never reads `this.ws`; every `localStorage.setItem` and every cache write
  goes through the helper that checks `checking()`.

By hand (the hand-test list): each screen closed and reopened; the list's
row in sight; a draft across a restart; close during a create; an issue
deleted in Linear while closed; a status change refused while cached; sign
out of a workspace while on its issue screen; the `cmd-l` store vs a copy
opened from GitHub.

## Approaches considered

- **Cache and spot in the mod (chosen).** No binary change, which can't
  ship without a release anyway.
- **The binary's `cache.go`** for the app too. Needs a release, and every
  answer still costs a process.
- **The spot in a file instead of `localStorage`.** A file is shared by
  every copy, which is wrong here: the spot is the `cmd-l` popup's. And
  `localStorage` is synchronous, which puts the right screen on frame one.

## Gate

`gofmt -l`, `go vet ./...`, `go test -race -count=1 ./...`,
`sh scripts/test-build.sh`, `node --test app/mods/linear/test/*.test.mjs`,
`herdr-app check app/mods/linear`.

## Second review (Opus, 2026-11-20): what changed

- **Answers from before a machine switch** are dropped as they land: each
  load and detail request carries the copy's `gen`, bumped on a switch,
  and an answer under an old `gen` is neither shown nor written. The list
  objects are replaced on a switch, so fresh loads aren't blocked by the
  old ones' `loading`. A details file whose `who.machine` isn't the copy's
  is read as empty.
- **A create is never sent twice.** `linear()` retries after a failure only
  for reads: `create`, `set-state` and `start` are never re-sent. `sentAt`
  is written and flushed to disk before the create goes, and a failure
  keeps it (Linear may have made it): the next enter only says so, the one
  after sends.
- **Selection write-back:** when the chosen id is gone, the row at its old
  position is shown chosen, and becomes the choice (`sel`) only once that
  list is live. A filter change, a tab change, a workspace switch and a
  drill choose the first row; back, undrill and a click choose by id.
- **The cap ladder** keeps the workspace in use: over 400 KB, project
  lists go first (oldest first), then other workspaces (least recently
  saved first), then the kept workspace's rows are halved, largest list
  first, never below 10. Tested: one workspace over the bound keeps all
  three tabs, non-empty.
- **Who cannot flip back.** A patch carries `base`, the file's `who.at` the
  copy last saw. Another machine's who replaces the file only if `base` is
  at least the file's `who.at`. A copy that never saw a switch can't undo
  it, even with a later status answer. `findLinear` re-reads the file's
  who first and starts from its machine when another copy moved it.
- **Status alone never empties the files** (a locked keychain looks like a
  sign-out): signed out everywhere clears the screen; the files lose a
  workspace only when a load in it answers signed out, and only from a
  request sent after status settled (an earlier one may have gone to the
  wrong machine; it is asked again). `findLinear` no longer moves a shown
  workspace that status merely didn't list.
- **The create gate retries:** a create refused for a failed or missing
  teams or statuses fetch asks for it again. A live teams answer keeps the
  team chosen; a team's cached statuses are refreshed once per form.
- **Worktrees** take the project's row from the live Projects list (its
  branch and teams exist only there), say "It isn't among the open
  projects any more." when the live list lacks it, and capture the
  workspace and its key on entry. `ctrl-t` is refused while busy.
- **Demo** never reads or writes the spot or the draft. The status menu is
  cleared with the screen on a switch or sign-out. A restored filter
  searches again after the lists load.

## Whole-branch review of the build (Opus, 2026-11-20): what changed

- **Drafts are kept one per workspace** (`localStorage "drafts"`, `{ <ws>:
  draft }`). Typing in a form in workspace B used to overwrite A's draft
  and inherit its `sentAt` and team; a form's draft is now built only from
  its own workspace's.
- **After a mid-session machine switch** (the machine dropped off, status
  answered elsewhere) or a workspace signed out under the popup, the first
  task to notice (a load, a detail, a project's) loads what's shown again.
  Render no longer starts work.
- **Adopting a switch another copy made** (the file is already the new
  machine's) drops what's shown but clears nothing on disk; only the copy
  that claims the switch clears the files.
- **The workspace shown is matched by id only**: no other workspace's name
  or key stands in for it, and a worktree waits until it's known.
- **The form retries the Projects list** when a create is refused for it.
- Nits: teams and statuses answers carry `gen` and their request's stamp;
  a demo toggle drops answers from the other mode and leaves the demo's
  workspace; a detail is shown from the cache only under a known, matching
  who; one oversized detail no longer pushes out the rest.
- Not changed: `seenAt` is not advanced when status confirms the copy's
  own machine. Doing so would let a copy that never saw another's switch
  replace it (the flip-back the `base` rule stops); the cost is that this
  copy's later switch is refused once and heals on its next write.
