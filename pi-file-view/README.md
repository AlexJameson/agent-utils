# pi-file-view

Pi extension for browsing files and git diffs in a terminal overlay.

## Installation

```bash
# Copy to pi extensions directory
cp -r pi-file-view ~/.pi/agent/extensions/
```

Or load temporarily:
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
| `Enter` | Open/select file |
| `Tab` | Switch focus between panes |
| `t` | Switch to tree mode |
| `g` | Switch to git mode |
| `Esc` | Close overlay |

## Dependencies

- `delta` — Enhanced git diff (optional, falls back to `git diff`)

## Architecture

See `plans/architecture.md` for current design docs, requirements, and future phases.
