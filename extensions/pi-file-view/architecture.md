# pi-file-view Architecture & Requirements

## Project Overview

`pi-file-view` is a Pi extension for browsing files and git diffs inside a terminal overlay.

The current codebase is a single extension package with one custom overlay component that owns layout, input handling, file discovery, and preview rendering.

## Requirements

### Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| F1 | `/file-view:tree` command opens file tree overlay | P0 | Implemented |
| F2 | `/file-view:git` command opens git changes overlay | P0 | Implemented |
| F3 | `Ctrl+Shift+F` toggles overlay | P0 | Implemented |
| F4 | File tree on left, preview on right | P0 | Implemented |
| F5 | Navigate files with `↑↓` | P0 | Implemented |
| F6 | `Tab` switches focus between panes | P0 | Implemented |
| F7 | `t`/`g` switch modes while overlay is open | P0 | Implemented |
| F8 | `Esc` closes overlay | P0 | Implemented |
| F9 | Preview generic files as text | P0 | Implemented |
| F10 | Preview `.md` files with `pi-tui` `Markdown` | P0 | Implemented |
| F11 | Overlay restores session state when closed and reopened in the same Pi session | P0 | Implemented |
| F12 | Left-pane navigation wraps from first item to last and back | P0 | Implemented |
| F13 | Filtering the current visible directory or repo list | P0 | Removed |
| F14 | Tree view hides dotfiles | P1 | Implemented |
| F15 | Fast preview scrolling supports `PgUp/PgDn`, `Home/End`, and `Ctrl+U/Ctrl+D` | P1 | Implemented |
| F16 | `v` toggles git diff preview between side-by-side and unified while keeping navigation visible | P0 | Implemented |
| F24 | `/` opens an explicit filter field for the left navigation pane without stealing normal navigation keys outside filter mode | P1 | Implemented |
| F23 | On markdown files in tree mode, `v` toggles rendered preview vs raw source with line numbers | P1 | Implemented |
| F17 | Git mode discovers repos with shallow recursion from `cwd` | P0 | Implemented |
| F18 | Git mode lets the user switch between repo picker and repo tree | P0 | Implemented |
| F19 | Git repo view defaults to branch/worktree changes and can toggle to all files | P0 | Implemented |
| F20 | Git preview prioritizes unstaged, staged, then branch-vs-base diff | P0 | Implemented |
| F21 | Base branch is detected automatically from common local/remote defaults | P1 | Implemented |
| F22 | Tree view excludes `node_modules`, `dist`, `out` everywhere | P1 | Removed — tree view displays files as-is; only repo discovery excludes them |

### Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF1 | Cross-platform where Pi and its dependencies run |
| NF2 | Terminal-only rendering |
| NF3 | Graceful degradation when optional tools are missing |
| NF4 | TypeScript compiles without errors |

## Module Structure

```text
pi-file-view/
├── package.json
├── tsconfig.json
├── README.md
├── architecture.md
└── src/
    ├── index.ts
    ├── overlay.ts
    └── types.ts
```

## Core Components

### Extension Entry (`src/index.ts`)

- Registers `/file-view:tree`, `/file-view:git`, and `Ctrl+Shift+F`
- Opens the overlay through `ctx.ui.custom(..., { overlay: true, overlayOptions })`
- Maintains a single `activeOverlay` reference so the shortcut can toggle it
- Stores a session-only overlay snapshot so reopening restores the last in-memory state

Deployment note:
- Pi loads the installed extension from `~/.pi/agent/extensions/pi-file-view`
- Local workspace edits do not affect runtime until that installed copy is updated or reinstalled

Current overlay sizing request:
- `width: "100%"`
- `maxHeight: "100%"`
- `margin: 0`

### FileViewOverlay (`src/overlay.ts`)

- Custom `Focusable` component
- Owns runtime state for mode, pane focus, selection, scrolling, git repo state, and preview content
- Draws the bordered split-pane layout and footer hints

Current layout math:
- Left pane: `30%`
- Right pane: `70%`
- Height target: full available terminal height
- Content height: `dialogHeight - 6`

Session state currently persists for the lifetime of the Pi process:
- mode
- focused pane
- diff layout (`side-by-side` or `unified`)
- markdown preview mode (`rendered` or `raw`)
- current directory
- selected path
- left scroll offset
- selected repo
- git submode and git scope
- per-path right-pane scroll offsets

### Tree Mode

- Uses `readdirSync(currentDir, { withFileTypes: true })`
- Shows one directory level at a time
- Hides entries whose names start with `.`
- Supports an explicit `/` filter for the current visible list
- Supports `Enter` / `l` / `→` to enter a directory
- Supports `h` / `←` / `Backspace` to move to the parent directory
- Supports cyclic `↑↓` navigation and page jumps

This is not a recursive `find`-based tree.

### Git Mode

- Starts in a repo-picker view that discovers repos with shallow recursion from `cwd`
- Repo discovery currently scans up to 4 levels below `cwd`
- Supports switching from repo picker into a selected repo tree and back out again
- Provides two repo scopes:
  - `changes` for branch/worktree review
  - `all` for browsing the full repo tree
- Detects a base branch from common candidates such as `origin/HEAD`, `origin/main`, and `main`
- Computes branch changes with `merge-base(baseRef, HEAD)` and `git diff mergeBase...HEAD`
- Tracks file state from:
  - branch diff vs base
  - staged diff
  - unstaged diff
  - untracked files
- Renders diffs from plain `git diff --no-color --no-ext-diff` output inside the overlay itself
- Normalizes `CRLF` and bare `CR` before splitting diff output into lines

### Preview Renderers

Markdown:
- Reads file text with `readFileSync(..., "utf8")`
- Normalizes line endings
- Renders through `pi-tui` `Markdown` in rendered mode
- Can switch to raw source mode with real source line numbers
- Builds the markdown theme from the overlay's local `ctx` theme instance instead of Pi's global theme singleton
- Re-renders when the right pane width changes so wrapping stays correct
- Does not show line numbers because rendered markdown lines do not map cleanly to source lines

Generic files:
- Reads file text with `readFileSync(..., "utf8")`
- Normalizes line endings
- Wraps long lines to the available preview width
- Keeps source line numbers visible in the preview gutter

Directories:
- Show short instructional preview text instead of file content

Git diff:
- Uses an internal renderer that can switch between side-by-side and unified diff views
- Colors removed lines red and added lines green using the Pi theme
- Wraps long lines in both diff modes to preserve full content inside the visible preview area
- Unified mode shows actual diff source line labels using `old/new` numbering
- Side-by-side mode omits line numbers rather than showing misleading wrapped-row counts
- Right-pane scroll state is restored per file path

Scrolling:
- Right-pane `↑↓` scroll by 3 lines
- `PgUp/PgDn` and `Ctrl+U/Ctrl+D` jump by 2 viewports
- `Home/End` jump to top and bottom

View modes:
- the navigation pane stays visible at all times
- `/` opens a temporary filter field for the current left-pane list
- on markdown files in tree mode, `v` toggles rendered preview vs raw source
- `v` toggles git diff rendering between side-by-side and unified
- `r` toggles between the repo picker and the current repo view

Filter behavior:
- The filter only activates after pressing `/`
- Typing updates the current visible list without affecting normal navigation outside filter mode
- `Enter` leaves the filter and keeps the current query applied
- `Esc` leaves the filter and clears the query
- Arrow and paging keys leave the filter and continue browsing the filtered list

## Design Decisions

### Use `pi-tui` `Markdown` instead of `glow`

`glow` rendered correctly in an interactive shell but returned effectively empty output when captured from `execSync()` in the overlay process. Rendering markdown inside the TUI avoids that TTY-dependent failure mode and keeps wrapping aligned with the actual preview width.

### Derive markdown styling from the overlay theme

The overlay now builds its `MarkdownTheme` from the `ctx` theme instance passed into the extension instead of using Pi's global markdown theme helper. This avoids full-reload failures caused by global theme initialization order.

### Use direct directory browsing instead of a recursive tree walk

The current overlay behaves like a lightweight file browser rather than a precomputed recursive tree. `readdirSync()` plus explicit enter/up navigation keeps the implementation small and predictable.

### Keep navigation visible while using preview-specific toggles

The left pane is part of the browsing workflow, so preview toggles should change how the right pane renders content, not whether the navigation pane exists. The overlay keeps the split layout stable and uses `v` only for git diff presentation.

### Wrap instead of truncate when possible

The overlay budgets space for the line-number gutter before rendering text and diffs, then wraps to the remaining width. This preserves more of the actual content without requiring a larger terminal window.

### Default git mode to change review, not full repo listing

The primary git workflow is understanding what changed on the current branch relative to the base branch plus local staged and unstaged work. The overlay therefore defaults to a `changes` scope and keeps `all` as an explicit toggle for full repo browsing.

### Keep git review read-only

Git mode does not checkout branches or mutate the worktree. The repo tree is a local review UI, not a branch navigation tool.

## Success Criteria

| Criterion | Verification |
|-----------|--------------|
| TypeScript compiles | `npx tsc --noEmit` exits 0 |
| Extension loads | `pi -e ./src/index.ts` starts without error |
| Tree command works | `/file-view:tree` opens overlay with file list |
| Git command works | `/file-view:git` opens repo picker or the last selected repo state |
| Preview renders | Selecting file shows content in right pane |
| Markdown preview | `.md` files render through `pi-tui` `Markdown` |
| Fast preview scroll | `PgUp/PgDn`, `Home/End`, and `Ctrl+U/Ctrl+D` move through long previews |
| List filter | `/` filters the current left-pane list and does not intercept normal navigation outside filter mode |
| View toggle | `v` switches markdown between rendered/raw in tree mode and switches git diff layout in repo view |
| Git diff | Git previews show wrapped internal red/green diff rendering |
| Git repo discovery | Git mode finds repos up to four levels below the current working directory |
