# pi-file-view

Pi extension for browsing files and git diffs in a terminal overlay.

## Installation

### From GitHub (recommended)

```bash
pi install git:github.com/AlexJameson/agent-utils
```

Or with a pinned ref:
```bash
pi install git:github.com/AlexJameson/agent-utils@main
```

### Manual copy after cloning

```bash
cp -r plugins/pi-file-view ~/.pi/agent/extensions/
```

### Temporary load

```bash
pi -e ./src/index.ts
```

## Commands

- `/file-view:tree` — Open file tree overlay
- `/file-view:git` — Open git changes overlay

## Keyboard shortcuts

- `Ctrl+Shift+F` — Toggle file view overlay (tree mode)

## Overlay controls

| Key | Action |
|-----|--------|
| `↑↓` | Navigate file tree (left pane) or scroll preview (right pane) |
| `PgUp` / `PgDn` | Move faster through the list or preview |
| `Enter` | Open/select file |
| `/` | Open a temporary filter field for the navigation pane |
| `Tab` | Switch focus between panes |
| `t` | Switch to tree mode |
| `g` | Switch to git mode |
| `r` | Toggle between repo picker and repo view |
| `a` / `c` | In repo view, switch between all files and changed files |
| `v` | On markdown files in tree mode, switch between rendered and raw source; in repo view, switch between side-by-side and unified diff |
| `Esc` | Close overlay |

Notes:

- Plain-text file previews keep source line numbers when wrapped.
- Hidden files and folders such as `.pi` are shown by default in tree and repo browsing views.
- The navigation pane filter is modal: `/` opens it, `Enter` keeps the current filter, and `Esc` clears it.
- Markdown files in tree mode can switch between rendered preview and raw source with line numbers using `v`.
- Unified diff shows actual source line labels in `old/new` form such as `12/12`, `12/-`, and `-/12`.
- Side-by-side diff omits line numbers to avoid ambiguous numbering.
- Rendered markdown preview does not show source line numbers.

## Architecture

See `architecture.md` for current design docs, requirements, and future phases.
