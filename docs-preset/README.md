# docs-preset

A portable documentation preset for AI coding agents. It helps a founder or a
small writing team create and maintain user-facing docs without configuring
agents by hand: repo tooling is discovered, writing conventions are recorded as
editable contracts, and the primary agent does the day-to-day work.

**v1 scope: OpenCode only.** One primary agent, two skills.

## Contents

- `agent/documentation-writer.md` — OpenCode primary agent (`mode: primary`).
  Tab to it and ask for doc work.
- `skills/good-docs/` — knowledge skill: Diataxis quadrants, constraints,
  validation checklists, custom content types, style defaults, and placeholders
  for project-specific rules.
- `skills/docs-env-scan/` — scan skill: discovers your docs tooling and
  user-facing documentation surfaces, drafts style conventions, writes
  validated contracts.
- `REQUIREMENTS.md` — versioned requirement sets for v1, v2, and v3.

## Install

```sh
# from your project root
mkdir -p .opencode/agent .agents/skills
cp docs-preset/agent/documentation-writer.md .opencode/agent/documentation-writer.md
cp -r docs-preset/skills/good-docs docs-preset/skills/docs-env-scan .agents/skills/
```

## First run

Open OpenCode, switch to the **documentation-writer** agent (Tab), and ask for
any doc task. On first run the agent scans your repo (or bootstraps conventions
if the repo is empty), proposes what it found in one message, and — once you
confirm — writes Markdown-KV contracts to `.agents/docs-preset/`:

- `TOOLING.md` — how we build and what is safe to edit.
- `STYLE.md` — how we write, including placeholders for team-specific rules.
- `STRUCTURE.md` — user-facing documentation surfaces, lightweight zones, and
  placement rules.

From then on, just ask for doc work. The agent reads the contracts, follows
them, and tells you when reality drifts from them. It treats Markdown as the
default source format but preserves detected MDX, reST, AsciiDoc, or mixed-format
conventions.

## Status

v1 scaffold — skill and agent bodies are being written against
`REQUIREMENTS.md`. V2 and V3 items such as quality scoring, export pipelines,
product-type template packs, reviewer subagents, and platform integrations are
intentionally absent.
