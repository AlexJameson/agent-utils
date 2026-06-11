# pi-yandex-search Architecture

## Overview

Pi extension that registers a `yandex_search` tool, replacing the non-functional built-in `web_search` on Russian DPI-blocked infrastructure.

## Authentication

No credentials in source code. IAM tokens are fetched at runtime through a cascading fallback chain:

| Priority | Source | When it works |
|----------|--------|---------------|
| 1 | **Yandex Cloud metadata service** | On YC VMs (`169.***.***.***`) |
| 2 | **`yc iam create-token`** | Laptop with YC CLI installed and authenticated |
| 3 | **`YANDEX_IAM_TOKEN` env var** | Manual export, CI, etc. |
| 4 | **`~/.pi/yandex-iam-token` file** | Last-resort user-managed token |

Tokens are cached in memory until 60s before expiry. `FolderId` defaults to `b1g***` but can be overridden via `YANDEX_FOLDER_ID` env var.

## API

- **Endpoint**: `POST https://searchapi.api.cloud.yandex.net/v2/web/search`
- **Auth**: `Authorization: Bearer <IAM-token>`
- **Body**: JSON with `queryText`, `folderId`, `searchType`, `responseFormat: "FORMAT_XML"`
- **Response**: JSON wrapping base64-encoded XML. XML contains `<doc>` elements with `<url>`, `<title>`, `<headline>`, `<passage>`, `<extended-text>`.

## Module Structure

```
pi-yandex-search/
├── package.json
├── tsconfig.json
├── architecture.md
└── src/
    ├── index.ts      # Extension entrypoint: registers yandex_search tool
    ├── search.ts     # Yandex API client, IAM token fetch, XML parsing
    ├── storage.ts    # In-memory cache for tokens and search results
    └── types.ts      # Shared interfaces
```

## Caching

| Cache | Key | TTL | Purpose |
|-------|-----|-----|---------|
| IAM token | `yandex-search:token` | `expires_in - 60s` | Avoid metadata service round-trips |
| Search results | `search:<query>:<opts>` | 5 minutes | De-duplicate repeated queries in a session |

## Tool Interface

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

## Future Work

- **Async full-content fetching**: When `includeContent: true`, spawn background fetches for result URLs (like pi-web-access does), store via `pi.appendEntry()`, and notify when ready.
- **Curator UI**: Port the interactive browser curator from pi-web-access for manual result filtering.
- **Rate limiting**: Track API usage, warn near limits.
