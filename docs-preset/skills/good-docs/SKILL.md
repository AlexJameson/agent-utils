---
name: good-docs
description: >-
  Use when writing, editing, reviewing, or restructuring documentation.
  Provides Diataxis-based classification (tutorial, how-to, reference,
  explanation), per-quadrant constraints and validation checklists, custom
  content types for non-Diataxis pages, default style rules, markup-format
  cautions, and placeholder prompts for project-specific quality/style rules.
  Consult before drafting any new page or assessing existing content.
---

# Good Docs

> STATUS: V1 SCAFFOLD — body to be written against REQUIREMENTS.md RS-V1-1.
> Frontmatter description is load-bearing for skill triggering.

## Planned sections

- Diataxis quadrants: practical definitions + classification criteria (V1-GD-1)
- Per-quadrant obligations and prohibitions as checkable constraints (V1-GD-2)
- Lightweight review checklist: completeness, clarity, structure, links,
  factual support, plus placeholders for team-specific criteria (V1-GD-3)
- Default custom content types: quickstart, FAQ, changelog, overview,
  troubleshooting, knowledge-base article (V1-GD-4)
- Default style rules and placeholder prompts for terminology, voice, quality
  bar, and reader assumptions (V1-GD-5)
- Minimal inline page skeletons for core quadrants and custom types (V1-GD-6)
- API/SDK docs as dormant types, used only when detected or requested (V1-GD-7)
- Markup-format cautions for Markdown, MDX, reST, AsciiDoc, and mixed-format
  repositories
- Markdown-KV guidance for preset contracts: use headings as records and
  `key: value` fields; avoid tables by default

## Hard constraint

This skill is pure knowledge: zero state, zero filesystem writes (GD-C1).
All project-specific facts come from `.agents/docs-preset/` contracts,
never from this file.
