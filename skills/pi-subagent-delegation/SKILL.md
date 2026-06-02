---
name: pi-subagent-delegation
description: Rules for delegating tasks to pi-subagents (scout, worker, reviewer). Use when the user asks to research, investigate, implement, or review code using subagents, or when parallel/chain/fan-in delegation would keep the main session context clean.
license: MIT
---

# Subagent Delegation Skill

Guidelines for using `@narumitw/pi-subagents` to offload work into isolated subprocesses while keeping the main session context clean.

## When to Delegate

**Use subagents for:**
- Independent read-only research or codebase reconnaissance
- Parallel multi-domain investigation (e.g., bug + tests + docs simultaneously)
- Independent review or verification after implementation
- High-volume command output that would clutter main context
- Multi-step workflows where each step builds on the previous

**Do NOT use subagents for:**
- Simple answers or quick targeted edits
- Latency-sensitive one-step work
- Tasks requiring frequent user back-and-forth
- Parallel writes to the same files (serialize write-heavy work)

## Agent Roles

| Agent | Purpose | Tools | When to Use |
|-------|---------|-------|-------------|
| `scout` | Read-only reconnaissance | `read`, `grep`, `find`, `ls`, `bash` | Research, map code, find references, check configs |
| `planner` | Grounded implementation plans | `read`, `grep`, `find`, `ls` | Design decisions before coding |
| `reviewer` | Independent verification | `read`, `grep`, `find`, `ls`, `bash` | Post-implementation review, risk assessment |
| `worker` | General implementation | All default tools | Writing/fixing code after research is complete |

## Model Assignment

**Scout should use the same model as `pi-btw`:**
- `pi-btw` inherits the **main thread model** by default, or uses an explicit override via `/btw:model`
- To match this behavior, create a custom scout agent without a `model` field in its frontmatter — it will inherit the main model
- Alternatively, set the same explicit model that btw uses
- Do NOT use a cheaper/weaker model for scout — research quality affects everything downstream

**When to assign different models:**
- `worker` can use the main model (needs full capability for edits)
- `reviewer` can use the main model or a reasoning-focused model
- Only use cheaper models for truly trivial, low-risk lookups

## Task Structure Rules

**Subagents start with ZERO context.** They do not know our conversation history, project structure, or prior decisions. Every task must be self-contained.

### Required in every task:

1. **Absolute paths** — Never relative paths
   - Good: `/Users/alexjameson92/Desktop/repos/agent-utils/plugins/pi-file-view/src/overlay.ts`
   - Bad: `src/overlay.ts`

2. **Project context** — One-line summary of what the project is
   - Good: "Project: pi-file-view — a pi extension for file tree browsing and git diff viewing"

3. **Current state** — What we know, what we tried, what failed
   - Good: "We attempted to use `glow` for markdown preview but it returns empty output in execSync context. We fell back to `readFileSync`."

4. **Boundaries** — What the subagent may and may NOT do
   - Good: "Do not edit any files. Read-only investigation."
   - Good: "You may edit only `src/overlay.ts`. After editing, run `npx tsc --noEmit` to verify."

5. **Expected output** — What format to return findings in
   - Good: "Report as a numbered list with line numbers and code snippets."
   - Good: "Return the fixed code block plus a summary of changes."

### Chain Mode: Passing Context with `{previous}`

Use `{previous}` to inject the prior subagent's final output:

```json
{
  "chain": [
    {
      "agent": "scout",
      "task": "Find all usages of `glow` in the codebase. Report file paths and line numbers. Do not edit."
    },
    {
      "agent": "worker",
      "task": "Based on these findings: {previous}\n\nRemove all `glow` calls and replace with a Node.js markdown renderer. Edit files, then run `npx tsc --noEmit`."
    }
  ]
}
```

**Rules for `{previous}`:**
- Only works in `chain` mode (sequential steps)
- Replaces the literal text `{previous}` with the prior agent's final assistant message
- If the prior agent failed (non-zero exit), the chain stops automatically
- Keep the template text minimal — `{previous}` itself can be large

## Parallel Mode: Fan-Out / Fan-In

Use parallel mode when tasks are independent:

```json
{
  "tasks": [
    {
      "agent": "scout",
      "task": "Find auth-related source files. Report paths. Do not edit."
    },
    {
      "agent": "scout",
      "task": "Find auth-related tests. Report coverage gaps. Do not edit."
    }
  ],
  "aggregator": {
    "agent": "reviewer",
    "task": "Merge these findings into an implementation-risk summary. Use {previous}."
  }
}
```

**Rules for parallel:**
- Max 8 tasks (hard limit)
- Max 4 concurrent (hard limit)
- All tasks run in same filesystem — they can read each other's edits if sequential, but parallel tasks should not write to same files
- Aggregator receives ALL task outputs concatenated as `{previous}`
- If any task fails, the aggregator still runs but results indicate failures

## Verification Requirements

Every worker subagent must verify its own work before returning:

1. **TypeScript:** `npx tsc --noEmit`
2. **Tests:** `npm test` or equivalent
3. **Lint:** `npm run lint` if available
4. **Runtime check:** If applicable, test the actual behavior

The subagent should report verification results in its output. Do not accept "it should work" — require evidence.

## Result Integration

Subagent results come back as:
- `content[0].text` — Concise final output (shown in chat)
- `details.results[*].messages` — Full conversation history with all tool calls
- `details.results[*].usage` — Token/cost stats

**How to integrate:**
1. Read the `content[0].text` for the summary
2. Press `Ctrl+O` on the subagent result to expand and see full tool call history
3. If the worker edited files, the changes are already on disk — just verify with `git diff` or `read`
4. If research findings need action, either delegate another subagent or implement directly in main session

## Custom Agents

Create specialized agents in `~/.pi/agent/agents/*.md`:

```markdown
---
name: yfm-expert
description: Yandex Flavored Markdown specialist
tools: read, grep, find, ls, bash
---

You are a YFM/Diplodoc expert. When reviewing markdown:
- Check {{ variable }} syntax
- Verify {% include %} paths exist
- Flag unsupported directives
- Report issues with line numbers
```

**Rules:**
- Agent name must be unique (overrides built-in if same name)
- `tools` restricts what the subagent can do — use this for safety
- Omit `model` to inherit main thread model (recommended for scout)
- Project-local agents in `.pi/agents/*.md` require `agentScope: "both"` and user confirmation

## Anti-Patterns

| Bad | Good |
|-----|------|
| "Fix the bug" (no context) | "In `src/overlay.ts` line 145, `glow` returns empty via `execSync`. Find why and propose a fix." |
| Relative paths | Absolute paths |
| Assuming subagent knows our conversation | Embedding all relevant context in the task |
| Spawning 10 parallel tasks | Max 4 concurrent, split into logical groups |
| Worker doing research + implementation in one step | Scout researches → Worker implements (chain) |
| Not verifying changes | Worker runs `tsc --noEmit` before returning |
| Using weak/cheap model for scout | Scout uses same model as btw (main thread model) |

## How the User Invokes Subagents

**The user never types JSON.** They describe what they want in natural language, and the assistant constructs and executes the `subagent` tool call automatically.

**Examples of natural language triggers:**
- "Scout the codebase to find X" → single scout task
- "Research the bug, then fix it" → chain: scout → worker
- "Check both the source and tests in parallel, then summarize" → parallel + aggregator
- "Review this implementation independently" → reviewer single task

The assistant is responsible for embedding all required context (absolute paths, current state, boundaries) into the task strings before calling the tool.

## Quick Reference (Assistant's Tool Call Format)

**Single task:**
```json
{ "agent": "scout", "task": "..." }
```

**Chain (sequential):**
```json
{ "chain": [{ "agent": "scout", "task": "..." }, { "agent": "worker", "task": "Fix: {previous}" }] }
```

**Parallel + aggregator:**
```json
{ "tasks": [{ "agent": "scout", "task": "..." }, { "agent": "scout", "task": "..." }], "aggregator": { "agent": "reviewer", "task": "Summarize: {previous}" } }
```
