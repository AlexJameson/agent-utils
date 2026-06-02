# pi-file-view Execution Plan

## Scope

This plan covers the next major iteration of `pi-file-view`:
- faster preview scrolling
- session-persistent overlay state
- cyclic list navigation
- non-recursive filtering with `/`
- git-mode refactor around shallow repo discovery and local PR-style review against the base branch

## 1. State Model Refactor

Files:
- `pi-file-view/src/index.ts`
- `pi-file-view/src/types.ts`
- `pi-file-view/src/overlay.ts`

Add a session-persistent overlay state object in `src/types.ts`:
- `OverlaySessionState`
- `GitSubmode = "repo-picker" | "repo-tree"`
- `GitTreeScope = "changes" | "all"`
- fields:
  - `mode`
  - `focusedPane`
  - `currentDir`
  - `selectedPath`
  - `leftScroll`
  - `filterQuery`
  - `filterMode`
  - `rightScrollByPath: Record<string, number>`
  - `selectedRepoPath`
  - `gitSubmode`
  - `gitTreeScope`
  - `gitBaseRef?`

In `src/index.ts`:
- add module-level `lastOverlayState: OverlaySessionState | null`
- pass `initialState` into `FileViewOverlay`
- save returned state on close/toggle

In `src/overlay.ts`:
- accept `initialState`
- add `getState()` or `snapshotState()`
- restore selection by `selectedPath`, not raw index

## 2. Split Source Data From Visible Data

File:
- `pi-file-view/src/overlay.ts`

Current issue:
- `files` is both the source list and rendered list

Refactor into:
- `allFiles: FileEntry[]`
- `visibleFiles: FileEntry[]`

Add helpers:
- `refreshVisibleFiles()`
- `restoreSelection()`
- `selectedFile(): FileEntry | undefined`

This is required for:
- filtering
- repo-picker vs repo-tree
- preserving selection when lists change

## 3. Faster Right-Pane Scrolling

File:
- `pi-file-view/src/overlay.ts`

Keep existing:
- `↑↓`
- `PageUp/PageDown`

Add:
- `Home` -> top
- `End` -> bottom
- `Ctrl+U` -> half-page up
- `Ctrl+D` -> half-page down

Implementation:
- add helpers:
  - `maxRightScroll()`
  - `scrollRightBy(delta: number)`
  - `scrollRightTo(position: number)`
- clamp against `Math.max(0, previewContent.length - contentHeight)`

Persist per-file scroll:
- before changing selection, save current `rightScroll` into `rightScrollByPath[currentPath]`
- after loading preview, restore saved scroll for new path

Update footer hints accordingly.

## 4. Cyclic Left-Pane Navigation

File:
- `pi-file-view/src/overlay.ts`

Change `handleLeftPaneInput()`:
- `up` on first item -> last item
- `down` on last item -> first item

Add optional page movement too:
- `PageUp/PageDown` for faster left-pane traversal

After every selection move:
- save old preview scroll
- load preview for new item
- adjust left scroll

## 5. Filter Mode With `/`

Files:
- `pi-file-view/src/overlay.ts`
- optionally `src/types.ts`

Recommended minimal UX:
- `/` enters filter mode
- filter uses `pi-tui` `Input`
- `Esc` exits filter mode
- empty query restores full current directory/repo view

Add state:
- `filterInput: Input | null`
- `filterMode: boolean`
- `filterQuery: string`

Behavior:
- when in filter mode:
  - delegate printable/editing keys to `Input`
  - on every change, call `refreshVisibleFiles()`
  - preserve selection by path if still visible
  - otherwise select first visible result
- filter only current loaded directory/repo level
- match files and folders by name, non-recursive

Render:
- show filter line above the panes or in the header
- simplest option: replace header subtitle with `/query` while filtering

## 6. Tree Mode Cleanup

File:
- `pi-file-view/src/overlay.ts`

Keep current non-recursive browsing, but make it filter-aware:
- `loadTreeFiles()` populates `allFiles`
- `refreshVisibleFiles()` produces `visibleFiles`
- navigation and rendering use `visibleFiles`

Persist tree state:
- `currentDir`
- `selectedPath`
- `leftScroll`
- `filterQuery`

## 7. Git Mode Redesign

Files:
- `pi-file-view/src/overlay.ts`
- `pi-file-view/src/types.ts`

Replace current boolean repo assumption with a submode state machine.

Add git state:
- `gitSubmode: "repo-picker" | "repo-tree"`
- `selectedRepoPath: string | null`
- `gitTreeScope: "changes" | "all"`
- `gitBaseRef: string | null`

### 7a. Repo Picker

Add helper:
- `discoverRepos(root: string, depth: number): FileEntry[]`

Behavior:
- shallow recursive scan from `cwd`
- default depth `2`
- detect repo by:
  - `.git/` directory
  - `.git` file
- show repo directories only
- allow entering selected repo with `Enter`

Good default:
- include `cwd` if it is a repo
- sort nearest repos first, then alphabetically

### 7b. Repo Tree

Once repo selected:
- root browsing at repo top level
- same navigation model as tree mode
- same filter model
- same session persistence

Important design choice:
- do not default to full repo tree for git mode
- default to `changes` scope
- add toggle for `all`

Recommended keys:
- `a` for all files
- `c` for changes only
- `r` to return to repo picker

## 8. PR-Like `changes vs base` Data Model

File:
- `pi-file-view/src/overlay.ts`

Add helpers:
- `detectBaseRef(repoPath): string | null`
- `getMergeBase(repoPath, baseRef): string | null`
- `loadGitChangesTree(repoPath, scope, currentDir?)`
- `loadGitPreview(file)`

Base branch detection order:
1. upstream default if resolvable
2. `origin/HEAD`
3. `origin/main`
4. `origin/master`
5. `main`
6. `master`

Data sources:
- branch changes: `git diff --name-status mergeBase...HEAD`
- staged: `git diff --cached --name-status`
- unstaged: `git diff --name-status`
- untracked: `git status --porcelain -uall`

For each file entry, attach derived metadata:
- `inBranchDiff`
- `staged`
- `unstaged`
- `untracked`

This should become new optional fields on `FileEntry`.

## 9. Git Preview Rules

File:
- `pi-file-view/src/overlay.ts`

For selected file in git mode, preview should prioritize:
1. unstaged diff
2. staged diff
3. branch-vs-base diff
4. raw file content in `all` mode if no diff applies

Add helpers:
- `loadGitDiffPreview(file)`
- `loadGitFilePreview(file)`
- `buildDiffCommand(...)`

Keep `delta` as renderer when available.

## 10. Render Updates

File:
- `pi-file-view/src/overlay.ts`

Update UI text:
- header should show:
  - current mode
  - current directory or selected repo
  - git scope in git mode
  - filter query when active
- footer should show:
  - fast scroll keys
  - filter entry key `/`
  - repo/scope keys in git mode

Update left-pane item rendering:
- repo-picker: repo icon/label
- repo-tree changes scope: status badges
- repo-tree all scope: normal tree plus status badges when present

## 11. Suggested Internal Method Layout

Inside `FileViewOverlay`, add or refactor toward these methods:
- `snapshotState()`
- `restoreState(state)`
- `refreshVisibleFiles()`
- `restoreSelection()`
- `selectedFile()`
- `saveCurrentPreviewScroll()`
- `restorePreviewScroll(filePath)`
- `scrollRightBy(delta)`
- `scrollRightTo(position)`
- `enterFilterMode()`
- `exitFilterMode(clear?: boolean)`
- `applyFilter(query)`
- `discoverRepos(root, depth)`
- `enterRepo(repoPath)`
- `leaveRepo()`
- `detectBaseRef(repoPath)`
- `getMergeBase(repoPath, baseRef)`
- `loadGitRepoFiles()`
- `loadGitChangedFiles()`

## 12. Order of Implementation

Recommended sequence:
1. state snapshot/restore plumbing
2. `allFiles` vs `visibleFiles`
3. cyclic navigation
4. fast right-pane scrolling
5. filter mode
6. git submode state machine
7. shallow repo discovery
8. base-branch diff/change model
9. git preview prioritization
10. render/footer polish
11. architecture doc update
12. validation

## 13. Validation Plan

Manual checks:
- close/open overlay in same Pi session restores:
  - mode
  - selected repo
  - current directory
  - selected file
  - filter query
  - right-pane scroll
- `↑` on first left item wraps to last
- `/` filters current list only
- right pane:
  - `PageUp/PageDown`
  - `Home/End`
  - `Ctrl+U/Ctrl+D`
- git mode from one-two levels above repo:
  - shows repo picker
  - enters repo tree
  - defaults to `changes`
  - can switch to `all`
- git preview shows meaningful branch-vs-base view

Type/build checks:
- `npx tsc --noEmit`

## 14. Main Risks

- base branch detection ambiguity in repos without remotes
- combining staged/unstaged/branch status on one file without confusing labels
- preserving selection when filters or scope changes remove the current item
- keeping the implementation small enough while reusing tree-mode logic

## 15. Recommendation on Scope

Best next implementation slice:
1. fast scrolling
2. session state
3. wrap-around navigation
4. `/` filter
5. git repo picker + `changes` scope against base branch

Defer:
- complex branch browsing
- recursive filtering
- very rich git status UI beyond clear badges and scope toggles
