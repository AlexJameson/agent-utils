# pi-file-view

Pi extension for browsing files and git diffs in a terminal overlay.

## Installation

### From GitHub (recommended)

```bash
pi install git:github.com/your-username/agent-utils
```

Or with a pinned ref:
```bash
pi install git:github.com/your-username/agent-utils@main
```

### Manual copy

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
| `Enter` | Open/select file |
| `Tab` | Switch focus between panes |
| `t` | Switch to tree mode |
| `g` | Switch to git mode |
| `Esc` | Close overlay |

## Architecture

See `architecture.md` for current design docs, requirements, and future phases.
