# pi-yandex-search

Pi extension that adds a `yandex_search` tool, replacing the broken built-in `web_search` on Russian DPI-blocked infrastructure.

## Authentication (no secrets in code)

The extension tries multiple token sources in order:

1. **Yandex Cloud metadata service** — automatic on YC VMs
2. **`yc iam create-token`** — for laptops with YC CLI installed
3. **`YANDEX_IAM_TOKEN`** env var — manual fallback
4. **`~/.pi/yandex-iam-token`** file — last-resort fallback

## Tool

```typescript
yandex_search({
  query?: string,
  queries?: string[],
  numResults?: number,
  includeContent?: boolean,  // NOT YET IMPLEMENTED
  recencyFilter?: "day" | "week" | "month" | "year",
  searchRegion?: "ru" | "com" | "tr",
})
```

## Installation

Already wired in the parent `agent-utils` package. If installing standalone:

```bash
ln -s $(pwd) ~/.pi/agent/extensions/pi-yandex-search
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/plugins/pi-yandex-search/src/index.ts"]
}
```

## Laptop usage

```bash
# Option 1: YC CLI (recommended)
yc iam create-token  # verify it works
# The extension calls this automatically

# Option 2: env var
export YANDEX_IAM_TOKEN=$(yc iam create-token)

# Option 3: file
echo "t1.9..." > ~/.pi/yandex-iam-token
```

## Architecture

See [architecture.md](./architecture.md).
