# pi-file-view Implementation Log

## 2026-06-02

### Layout Controls
- Added a `v` toggle to switch between split view and a single full-width preview pane.
- Narrowed the left navigation pane from 35% to 30% in split mode.
- Persisted the selected pane layout in session state so reopening the overlay restores the last view mode.

### Side-By-Side Diff Preview
- Replaced external `delta`-formatted git preview output with an internal side-by-side diff renderer built from plain `git diff --no-color --no-ext-diff` output.
- Added green/red preview coloring for added and removed lines.
- This also avoids leaking terminal-oriented formatter control sequences into the overlay, which was the likely cause of the stale git preview lines appearing above the panel after switching views.

### Filter Removal
- Removed the interactive file filter field because it made overlay escape and pane switching unreliable in practice.
- Restored a simpler overlay input model with no text-entry mode inside the browser.

### Follow-Up Interaction Fixes
- Increased right-pane scroll speed so `↑↓` move by 3 lines and `PgUp/PgDn` plus `Ctrl+U/Ctrl+D` jump by 2 viewports.
- Hardened `Esc` handling by recognizing the raw escape byte directly, so the overlay closes reliably again.
- Increased git repo discovery depth from 2 to 4 levels below `cwd` so repos under paths like `Desktop/repos/...` are found.

### Session State And Navigation
- Added session-scoped overlay state snapshots in `src/index.ts` so reopening the overlay restores the previous in-memory state.
- Persisted current mode, current directory, selected path, focused pane, selected repo, git scope, and per-file preview scroll offsets.
- Switched left-pane navigation to wrap around from top to bottom and bottom to top.

### Faster Preview Scrolling
- Kept line-by-line right-pane scrolling and added faster navigation with `PgUp`, `PgDn`, `Home`, `End`, `Ctrl+U`, and `Ctrl+D`.
- Stored right-pane scroll per selected file so long markdown or diff previews reopen where the user left them.

### Git Mode Refactor
- Replaced the old `cwd must already be a git repo` behavior with a shallow repo-picker discovered from the current working directory.
- Added repo-tree browsing with two scopes:
  - `changes` for local PR-style review against the detected base branch plus staged/unstaged/untracked changes
  - `all` for browsing the full repo tree
- Added base-branch detection and merge-base comparison so git mode reflects current branch changes relative to the likely base branch.
- Kept the git experience read-only and diff-focused.

### Runtime Deployment
- Confirmed Pi was loading the installed extension from `~/.pi/agent/extensions/pi-file-view`, not the workspace copy under `agent-utils/pi-file-view`.
- Synced the installed `src/index.ts` and `src/overlay.ts` with the workspace version so the active runtime used the markdown-preview fixes.

### Full Reload Fix
- Replaced the markdown theme dependency on Pi's global theme helper with a theme built from the overlay's local `ctx` theme instance.
- This removed a likely full-reload failure mode where markdown rendering could break if the global theme singleton was not initialized yet.

### Markdown Preview
- Replaced the external `glow` markdown preview path with `pi-tui` `Markdown`.
- Markdown is now rendered from file contents read through Node.js instead of a subprocess.
- The preview is re-rendered against the current right-pane width so wrapping stays aligned with the overlay.

### Overlay Sizing
- Increased overlay request width from `92%` to `98%` in `src/index.ts`.
- Increased overlay height target in `src/overlay.ts` from `rows - 4` / `rows * 0.88` to `rows - 2` / `rows * 0.94`.
- Shifted pane split from `40/60` to `35/65` to leave more room for preview content.

### Architecture Doc Sync
- Rewrote `plans/architecture.md` to match the actual code instead of the older design notes.
- Removed stale claims about:
  - `glow`-based markdown rendering
  - recursive `find`-based tree building
  - universal directory exclusions for `node_modules`, `dist`, and `out`

### Research Summary
- Confirmed the original markdown failure root cause was real, but not caused by environment variables. `glow` produced effectively empty output when invoked through non-TTY `execSync()` capture.
- Confirmed earlier scout notes about `\r` normalization and right-pane discoverability were historical by the time the current implementation was reviewed.
