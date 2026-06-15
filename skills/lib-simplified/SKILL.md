---
name: lib-simplified
description: Research open-source libraries with evidence-backed answers and GitHub permalinks. Adapted for local tools — uses yandex_search, web_fetch, and bash (git/yt-dlp/ffmpeg) instead of pi-web-access. Use when the user asks about library internals, needs implementation details with source code references, wants to understand why something was changed, or needs authoritative answers backed by actual code.
---

# lib-simplified

Answer questions about open-source libraries by finding evidence with GitHub permalinks. Every claim backed by actual code.

## Tools you have

| Tool | Use for |
|------|---------|
| `yandex_search` | Web search, code search, recent discussions |
| `web_fetch` | Fetch clean markdown from docs, READMEs, issue/PR pages |
| `bash` | `git clone`, `grep`, `git log/blame`, `yt-dlp`, `ffmpeg` |
| `read` | Inspect cloned files once located |

## Execution model

Pi executes tool calls sequentially, but batching independent calls in one turn still saves LLM round-trips. Use these patterns:

| Pattern | When | Actually parallel? |
|---------|------|-------------------|
| Batch tool calls in one turn | Independent ops (`yandex_search` + `bash` git clone) | No, but saves round-trips |
| `bash` with `&` + `wait` | Multiple git/grep/yt-dlp commands | Yes (OS-level) |

## Step 1: Classify the request

| Type | Trigger | Primary approach |
|------|---------|-----------------|
| **Conceptual** | "How do I use X?", "Best practice for Y?" | `yandex_search` + `web_fetch` (README/docs) |
| **Implementation** | "How does X implement Y?", "Show me the source" | `bash: git clone` + `grep` + `read` |
| **Context/History** | "Why was this changed?", "History of X?" | `git log` + `git blame` + issue/PR search |
| **Comprehensive** | Complex or ambiguous requests, "deep dive" | All of the above |

## Step 2: Research by type

### Conceptual questions

Batch in one turn:

1. `yandex_search`: `"library-name topic"`
2. `web_fetch`: library README or docs URL

Synthesize results. Cite official documentation and link to relevant source files.

### Implementation questions

Clone, find, permalink:

```bash
# Clone to temp dir
mkdir -p /tmp/pi-repos && cd /tmp/pi-repos
rm -rf owner-repo
git clone --depth 1 https://github.com/owner/repo.git owner-repo

# Search
cd owner-repo
grep -rn "function_name" --include="*.ts" --include="*.js" .
find . -name "*.ts" | head -20

# Get commit SHA for permalinks
git rev-parse HEAD
```

Then use `read` to examine specific files.

Construct permalink:

```
https://github.com/<owner>/<repo>/blob/<sha>/<filepath>#L<start>-L<end>
```

### Context/history questions

Use git operations on the cloned repo:

```bash
cd /tmp/pi-repos/owner-repo

# Recent changes to a file
git log --oneline -n 20 -- path/to/file.ts

# Who changed what
git blame -L 10,30 path/to/file.ts

# Commit diff
git show <sha> -- path/to/file.ts

# Search commit messages
git log --oneline --grep="keyword" -n 10
```

For issues and PRs, use `gh` CLI if available:

```bash
gh search issues "keyword" --repo owner/repo --state all --limit 10
gh search prs "keyword" --repo owner/repo --state merged --limit 10
gh issue view <number> --repo owner/repo --comments
gh pr view <number> --repo owner/repo --comments
```

If `gh` is not available, use `web_fetch` on the GitHub issue/PR URL.

### Video analysis

For YouTube videos or screen recordings:

```bash
# Transcript
yt-dlp --write-auto-sub --skip-download --sub-langs en,ru --output "/tmp/video.%(ext)s" "https://youtube.com/watch?v=abc"

# Single frame at timestamp
ffmpeg -ss 00:01:23 -i "$(yt-dlp -f worst --get-url 'https://youtube.com/watch?v=abc')" -vframes 1 /tmp/frame.jpg

# Local video frame
ffmpeg -ss 00:01:23 -i /path/to/demo.mp4 -vframes 1 /tmp/frame.jpg
```

Then ask the user a specific question about the frame, or read the transcript file.

## Step 3: Construct permalinks

Always use full commit SHAs, not branch names:

```bash
cd /tmp/pi-repos/owner-repo && git rev-parse HEAD
```

```
https://github.com/<owner>/<repo>/blob/<sha>/<filepath>#L<start>-L<end>
```

## Step 4: Cite everything

Every code-related claim needs a permalink. Format:

```markdown
The stale time check happens in [`notifyManager.ts`](https://github.com/TanStack/query/blob/abc123/packages/query-core/src/notifyManager.ts#L42-L50):

\`\`\`typescript
function isStale(query: Query, staleTime: number): boolean {
  return query.state.dataUpdatedAt + staleTime < Date.now()
}
\`\`\`
```

## Failure recovery

| Failure | Recovery |
|---------|----------|
| `grep` finds nothing | Broaden query, try concept names |
| Repo too large | Use `--depth 1` or fetch specific files with `web_fetch` |
| `gh` CLI rate limited | Use already-cloned repo |
| Video extraction fails | Check `yt-dlp`/`ffmpeg` installed; fall back to transcript |
| Page returns bot block | `web_fetch` has TLS impersonation; if still blocked, try `yandex_search` cache |
| `yandex_search` fails | Try different query phrasing or `web_fetch` on a known URL |

## Guidelines

- Vary search queries when running multiple searches — different angles, not repetition
- Prefer recent sources; filter out outdated results when they conflict
- For version-specific questions, clone the tagged version: `git clone --branch v1.0.0 --depth 1 ...`
- Reuse already-cloned repos in `/tmp/pi-repos/` when possible
- Answer directly. Skip preamble like "I'll help you with..." — go straight to findings
