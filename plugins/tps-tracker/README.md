# tps-tracker

Pi extension that shows live token-per-second generation speed in the status bar.

## Installation

### From GitHub

```bash
pi install git:github.com/your-username/agent-utils
```

Or with a pinned ref:
```bash
pi install git:github.com/your-username/agent-utils@main
```

### Manual copy

```bash
cp -r plugins/tps-tracker ~/.pi/agent/extensions/
```

### Temporary load

```bash
pi -e ./src/index.ts
```

## What it does

- Shows a live "Generating… ● 42.3 tok/s" indicator in the Pi status bar during assistant responses
- Switches to "Done ✓ 38.1 tok/s" when generation completes
- Falls back to character-based estimation when usage tokens are unavailable
- Auto-clears the status after 8 seconds
- Provides a `/tps` command to check current speed on demand
