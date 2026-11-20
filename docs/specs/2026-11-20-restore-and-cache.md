# The Linear popup reopens where you left it, and shows what it knows at once

Status: draft, not yet reviewed.

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
  `main.js:345`), the filter's Linear search, an issue's detail
  (`loadDetail`), a project's detail (`openProject`), and the new issue
  form's teams and statuses (`create`, `pickTeam`).
- Even the cached tabs refresh late: `start()` asks `status` first
  (`findLinear`, one process per machine tried) and only then `loadAll`
  (`main.js:269-282`).
- The file has no version and no owner, is written with `fs.writeFile`
  (no compare-and-swap, so two copies of the popup can lose each other's
  writes), is written under `herdr-app check`, and nothing stops an action
  from being built on cached data.

`cache.go` is the TUI picker's own cache (`stateDir()/lists.json`, used by
`tui.go`). The mod never reads it. It is not changed.

## Constraint: no binary change

The mod runs the herdr-linear release named by `LINEAR_VERSION`
(`main.js:21`), downloaded from the upstream repo's releases by `PROVISION`.
A change to the Go code reaches the mod only through a release, which this
work may not make. So everything here is in the mod, and uses only the ops
the 0.14.5 binary already answers.

## Goals

1. **Restore.** Closing the popup and pressing `cmd-l` again lands on the
   same screen (list, drilled project list, issue, project, new issue
   form), the same tab, filter, selected row and list scroll position,
   with the text you had typed, as long as it was closed less than 2 hours
   ago (see Staleness).
2. **Cache.** Every list and detail the popup shows is drawn from the cache
   on the first frame after the cache file is read (milliseconds, no
   process), marked as being refreshed, and replaced by the fresh answer.
3. Fresh answers are asked for when the popup opens, without waiting for
   `status`.

## Not in this version

- **The description's scroll position** on an issue or project screen.
  gpui-kit can't read a scroll area's offset: `ScrollHandle` only has
  `scroll_to_item` (`gpui-kit.d.ts:21331-21342`), and the markdown body is
  one element. The body opens at the top. The list's position is restored
  to the row (below).
- **Open menus** (the status menu, the pull request chooser, the new
  issue's project dropdown). They are a moment of choosing, built from
  data that has to be fresh to act on. They are not reopened.
- **Work in flight** when the popup closed (a start, a create, a status
  change). Closing a copy cancels its tasks; restore never runs an action
  again. What it did, it did.
- **Refreshing while closed.** As for the GitHub mod: no background place
  for a mod without editing the user's layout.
- **Detecting a different Linear user in the same workspace.** `status`
  answers workspaces (id, name, urlKey) but no viewer (`app.go:443-457`),
  and the binary can't change. See Whose cache it is.
- The TUI picker. The demo (nothing about the demo is cached or restored).

## Must not happen

1. **Acting on old data.** A choice built from cached fields is not offered
   or accepted until the data it is built from is fresh. See What cached
   data may do.
2. **Old data that looks current.** Anything drawn from the cache carries a
   quiet mark that it is being refreshed. If the refresh fails, the mark
   becomes the error and the age ("from 14:02"), never a silent stale view.
3. **Another account's data.** See Whose cache it is.
4. **Cached data replacing fresher data.** A cache read that finishes after
   a live answer never replaces it, for lists and details. A cached detail
   never changes a list row.
5. **Two writers losing each other's data.** Two copies of the popup can be
   alive at once (`cmd-l`'s, and one opened on an issue from the GitHub mod
   or Recap). A write must not drop the other's newer entries.
6. **One workspace's data shown as another's**, or one project's issues as
   another project's.
7. **Writes under `herdr-app check`.** It runs `init` for real. No cache
   file write and no `localStorage` write while `checking()`.
8. **Restore acting.** Reopening never sends anything to Linear but reads.
9. **Losing typed text.** A new issue's title and description survive a
   close, a reopen and a restart until the issue is created or the user
   clears them.

## Where state lives

- **The spot** (what screen, which row, the filter) is the `cmd-l` popup's
  own: it goes in `localStorage` under `"view"`. `localStorage` is per mod
  copy (`AGENTS.md:980`); the store is chosen by the copy's props (today's
  `data/linear/` has one store per props set), so the plain `cmd-l` popup
  always finds its own, and a copy opened on an issue from another mod
  neither reads nor clobbers it. `localStorage` is synchronous, so the
  restored screen is right on the very first frame.
- **The new issue draft** goes in the same store under `"draft"`, apart from
  the spot, because it has its own lifetime (Must not 9).
- **Data from Linear** is shared by every copy: it goes in the cache files
  in the app's folder, written with compare-and-swap.

## Staleness and what is gone (my calls)

- **The spot is restored if the popup closed less than 2 hours ago.** Past
  that, the popup opens on the list, on the tab it was on, with an empty
  filter and the top row, as today. Two hours covers stepping away to
  work in a terminal and coming back; after a lunch or a night, you've
  moved on and the list is the better start. The age is from the last
  change to the spot, so leaving the popup open on one screen for hours
  and then closing it counts from the close (the spot is written on
  close too).
- **The draft does not expire.** It is put back into the form the next
  time the form opens (by restore, `n` or `ctrl-n`), and cleared when the
  issue is created. If the spot is too stale to restore and a draft is
  kept, the list says so once: "A new issue draft is kept: ctrl+n".
- **The spot is dropped**, and the popup opens on the list, when:
  - its workspace is not one `status` (or the cache's workspace list)
    knows: you signed out of it;
  - the popup was opened with props (`issue`, `demo`): those copies open
    where they are told, and never restore or save a spot;
  - the saved spot doesn't parse or has another version.
- **The restored thing no longer exists:**
  - *A selected row* no longer in the list: the row at the same position,
    clamped to the list (so the cursor stays near where it was). Rows are
    matched by id, never by index, so a list that changed order keeps the
    same issue chosen.
  - *An issue* whose fresh `detail` fails with "not found" / "no such
    issue" (the binary passes Linear's message through; the demo says
    `no such issue`, `demo.go:296`): back to the list, with
    "ENG-123 is gone, or you can't see it any more." Any other failure
    (offline, timeout) keeps the cached screen with the error mark: the
    issue may well still be there.
  - *A project* (screen or drilled list) whose fresh answer says not found,
    or that is missing from a fresh Projects list: back to the Projects
    tab, with "<name> is gone, or you can't see it any more."
  - *An issue or project with nothing cached* (never opened before, or
    pruned): the screen is restored with what the spot itself kept (the
    row's own fields: identifier, title, state; these are stored with the
    spot, see The spot's format) and "Loading…" for the rest.

## The spot's format

```json
{ "version": 1, "at": 1795017543000, "ws": "<workspace id>",
  "screen": "list" | "issue" | "project" | "create",
  "tab": "mine" | "projects" | "recent",
  "drilled": { "id": "...", "name": "...", "status": {...}, "teams": [...] } | null,
  "drillFrom": false,
  "filter": "text",
  "sel": "<issue or project id>" | null, "row": 0, "top": "<entry key>" | null,
  "issue": { ...the issue row as listed } | null,
  "project": { ...the project row as listed } | null }
```

`at` is when the spot was saved; `row` is the selected row's index, used
only when `sel` is gone. It is
written when the spot changes (screen, tab, row, filter, drill, workspace)
and on `close()` with `localStorage.flush()`, never on every frame. Pure
functions in `view.js` make it from the popup's state and read it back
(`snapshot`, `restore`), so node can test them.

**The list's position.** `top` is the key of the first entry the virtual
list drew last (`range.start` in its render callback, `main.js:1196-1197`).
On restore, after the first frame with rows, `scroll_to_item(index of that
key, "top")`, then the selected row is kept in sight as today (`follow`).
If the key is gone, the selected row is scrolled to. If the range includes
rows drawn above the visible edge, the position is off by those rows: check
by hand.

## The cache files

Two files in the app's folder, as the GitHub mod's (`cache.js`, `store.js`
there), version 2:

- `linear-cache.json` (lists; read on every open, kept small):
  ```json
  { "version": 2,
    "who": { "machine": "", "workspaces": ["<id>", ...], "at": 1795017543000 },
    "workspaces": [{ "id": "...", "name": "...", "urlKey": "..." }],
    "lists": { "<ws>/mine": { "items": [], "warning": "", "saved": 0 },
               "<ws>/projects": {...}, "<ws>/recent": {...},
               "<ws>/project/<project id>": {...},
               "<ws>/found": { "query": "...", "items": [], "saved": 0 },
               "<ws>/teams": { "items": [], "saved": 0 },
               "<ws>/states/<team id>": { "items": [], "saved": 0 } } }
  ```
- `linear-details.json` (read when an issue or project is opened or the
  spot restores to one): `{ "version": 2, "who": {...}, "details": {
  "<ws>/issue/<id>": { "d": <detail answer>, "saved": 0 },
  "<ws>/project/<id>": { "d": <project answer>, "saved": 0 } } }`.

Rules (the GitHub mod's, which were reviewed):

- **Version.** Today's file has no `version`. A missing or other version,
  or a file that doesn't parse, is an empty cache and is replaced by the
  first write. Never an error on screen.
- **Writing.** `fs` has no rename. Use `writeTextFile(path, text,
  expected)` (`herdr.d.ts:30-32`): read, merge, write with the text just
  read as `expected`; on rejection re-read and retry, 3 times, then give up
  quietly. `readTextFile` for reading (1 MiB cap, so the files stay well
  under).
- **One write at a time per copy** (a serial queue): three tabs answering
  together each write.
- **Merge.** Union by key; for the same key the newer `saved` wins; then
  caps and pruning on the merged result.
- **`saved`** is when the request was sent, not when it answered, so a slow
  old answer never beats a later quick one.
- **Caps.** Details: 50 and 600 KB, oldest first. Project lists
  (`<ws>/project/<id>`): 20, oldest first. States: 30 teams. The lists file
  stays under 400 KB: project lists give way first, then `found`.
- **Under `checking()`**: no writes.
- **The demo** reads and writes nothing.

## Whose cache it is

The binary is asked as one machine (`this.on`, `""` this computer) and one
workspace (`this.ws`); tokens are per workspace (`account(w.ID)`,
`workspace.go:27`). `status` says which workspaces are signed in on that
machine. So **who** is `{ machine, workspaces }`, and every cached entry is
under a workspace.

- The first frame shows the cache for the last known who, as today.
- `status` is still asked on every open, in parallel with the loads.
- When it answers:
  - another machine than `who.machine` (you're now signed in elsewhere):
    everything cached is dropped from the screen and from both files;
  - the same machine, with workspaces missing that `who` had: those
    workspaces' entries are dropped from the screen and the files (signed
    out of them). If the shown one is among them, the popup goes to the
    first signed-in workspace and loads it; the spot is dropped;
  - workspaces added: kept, nothing dropped.
- Signed out everywhere: the rows are cleared and the sign-in screen shows,
  as today, and both files are emptied.
- **The gap.** Signing out of a workspace and in again as a different user
  of the same workspace looks the same to `status`. The 60-second refresh
  and the refresh on open replace that data within one round trip, and no
  action is offered on it before then (What cached data may do). Closing
  this needs `status` to return the viewer: a binary change for a later
  release.

## Changes

### 1. The cache module and store

`app/mods/linear/cache.js`, no imports: version, parse, who (`whoOf`,
`sameWho`, `dropFor(who, next)` saying what to drop), `applyPatch` (merge,
prune), `writeWith` (compare-and-swap loop), `serial`, `stamper`,
`seed(l, kept)` (never over a live list), `takesOver(shown, next)`,
`canChange(...)`, `staleMark(...)`. `store.js` wraps `readTextFile` /
`writeTextFile` / `checking()`, as the GitHub mod's does.

### 2. Lists at once, and asked at once

- Read `linear-cache.json` first thing in `init` and seed every tab's list,
  the drilled project's list, and `found` for the restored filter. Until
  that read finishes, the list body draws nothing rather than "Loading…".
- With a known `on` and `ws`, start every load at once, alongside `status`.
  One `findLinear` in flight is shared. A load that fails as signed out or
  unreachable falls back to today's `findLinear`, then loads again.
- `load` captures the workspace and, for a project's issues, the project
  id when the request is sent, stores the answer under them, and shows it
  only if they are still what's shown (today it checks the workspace only,
  `main.js:374`).
- Search (`lookUp`): a cached `found` for the same query and workspace is
  shown at once with the mark; the search still runs.

### 3. Details at once

- `openIssue` and `openProject` show a cached detail at once if there is
  one, with the mark, and ask for the fresh one as today. Opening from
  another mod (`openByKey`) still asks `find` first (it has only a key),
  then does the same.
- A cached detail sets only the shown detail and a `cached` flag. It does
  not go through `loadDetail`'s tail (`this.cur = d.issue`, `replaceRow`,
  `main.js:516-518`), so it never writes into a list.
- The shown detail is replaced only by an answer whose request started
  after the shown one's (`takesOver`).
- The fresh answer is written to `linear-details.json`.
- A failed refresh keeps the cached screen, and the mark becomes the error
  and its age; `r` tries again. Not found: see Staleness and what is gone.

### 4. The new issue form at once

- `teams` and each team's `states` come from the cache at once, refreshed
  as today. The project choices are the Projects list (cached or fresh).
- The draft (title, description, team key, status id, priority, project
  id, assign to me) is saved to `"draft"` as it changes and put back when
  the form opens. A saved team, status or project that the fresh answers
  no longer have falls back to today's default for that field.

### 5. Restore

- `init`: unless opened with props, read `"view"` and `"draft"`; if the
  spot is fresh enough (`restore(spot, now)` in `view.js`) set screen, tab,
  filter (into the input), drill, row and the issue or project from it
  before the first render, then read the cache and seed as above.
- Save the spot when it changes and in `close()`. Not under `checking()`,
  not in the demo, not from a copy opened with props.

## What cached data may do

The binary re-reads an issue before `check-start` and `start`
(`app.go:348-374`), so Start and worktrees are safe from cached rows. The
risk is choices built on the client from cached fields:

| Built from | Action | While cached |
|---|---|---|
| `detail.states`, `detail.issue.state` | status menu (`c`, the state chip), `set-state` | refused: "Refreshing…" |
| `teams`, `states/<team>`, the Projects list | Create issue (enter, the button) | refused: "Refreshing…" until teams, the chosen team's states and the Projects list are fresh |
| a row or the shown issue | `w`, `s`, `ctrl-s`, Start button | allowed: the binary checks |
| anything | `o`, `y`, `b`, `g`, `r`, moving, tabs, filter | allowed |

The check lives in one function each (`mayChangeState`, `mayCreate`) that
`statusMenu`, the menu item's `run`, and `submit` ask first, because clicks
call these directly (`chip(... click: statusMenu)`, `main.js:1251`; the
create button, `main.js:1362`). A test reads main.js and checks they do.

## Tests

`node --test app/mods/linear/test/*.test.mjs` (node 24; here through
`mise x node@24.16.0 --`). Added to `.github/workflows/test.yml` with a
`setup-node` step pinned to the commit the GitHub mod's workflow uses.

- `cache.js`: version and parse; who and what a status answer drops; merge
  with two writers; newer `saved` wins; caps after merge; CAS retry and
  give up; seed never over live; `takesOver`; `canChange`; `staleMark`.
- `view.js`: snapshot round trip for each screen; older than 2 hours is not
  restored; a spot for a workspace not signed in is dropped; props copies
  never restore; selection by id, and the nearest row when it's gone; the
  draft survives a stale spot and is cleared on create.
- `callers.test.mjs`: `statusMenu`, the status menu's run and `submit` ask
  their gate first; a cached detail never reaches `replaceRow` or
  `this.cur`; every `localStorage.setItem` for the spot and draft and every
  cache write goes through a function that checks `checking()`.

Each behaviour change gets a test that fails on the base commit first.

By hand (the hand-test list): each screen closed and reopened; the list's
scroll position; a draft across a restart; an issue deleted in Linear
while the popup is closed; a status change refused while cached; sign out
of a workspace.

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
