---
name: good-docs
description: >-
  Use when writing, editing, reviewing, or restructuring user-facing
  documentation. Provides Diataxis-based classification, lightweight custom
  content types, review checklists, style defaults, markup-format cautions, and
  placeholder prompts for project-specific quality/style rules.
---

# Good Docs

This skill is stateless reference material. It never writes files and never
stores project-specific facts. Project facts come from `.agents/docs-preset/`
contracts.

## Classification

Use Diataxis as guidance, not law:

- **Tutorial**: learning-oriented path. The reader follows one safe route to
  learn by doing. Avoid branching and exhaustive options.
- **How-to**: task-oriented path. The reader has a goal and needs steps. Keep
  prerequisites, steps, expected result, and troubleshooting tight.
- **Reference**: lookup-oriented surface. The reader needs accurate facts,
  parameters, fields, commands, or APIs. Avoid narrative teaching.
- **Explanation**: understanding-oriented topic. The reader needs concepts,
  architecture, tradeoffs, or rationale. Avoid pretending it is a procedure.

If none fits, use or propose a custom type.

## Default Custom Types

### Type: quickstart
purpose: Get the reader to first success quickly.
structure: goal, prerequisites, shortest path, expected result, next links
tone: direct and minimal

### Type: faq
purpose: Answer common concrete questions.
structure: grouped questions with direct answers and links to deeper docs
tone: concise and searchable

### Type: changelog
purpose: Explain user-visible changes over time.
structure: version/date, added, changed, fixed, removed, migration notes
tone: factual

### Type: overview
purpose: Orient the reader to a product or area.
structure: what it is, who it is for, core concepts, common next steps
tone: explanatory but brief

### Type: troubleshooting
purpose: Help readers diagnose and fix known problems.
structure: symptom, likely cause, fix, verification, escalation
tone: practical and calm

### Type: knowledge-base-article
purpose: Capture reusable domain/product knowledge.
structure: context, answer, details, related material, source/verification notes
tone: clear and self-contained

## Review Checklist

Use these defaults unless `STYLE.md` defines project-specific criteria:

### Criterion: Completeness
question: Does the page contain enough information for its stated purpose?

### Criterion: Clarity
question: Can the intended reader understand what to do or learn without hidden assumptions?

### Criterion: Structure
question: Does the page type match its structure, headings, and level of detail?

### Criterion: Links
question: Are required next steps, prerequisites, and related pages linked correctly?

### Criterion: Factual Support
question: Are product claims supported by supplied materials, existing docs, code, schemas, or user confirmation?

### Criterion: Team-specific Quality Bar
status: placeholder
question: What would make this team's documentation unacceptable?

## Style Defaults

- Prefer clear, concise, user-facing prose.
- Use active voice where natural.
- Address the reader directly in procedural docs when the repo style allows it.
- State assumptions when they affect the task.
- If multiple interpretations are plausible, ask or list the alternatives.
- Preserve existing terminology, headings, links, frontmatter, includes,
  admonitions, anchors, diagrams, and code-block conventions.
- Do not invent product facts.
- Prefer Markdown-KV records over tables in preset contracts.

## Markup Cautions

### Format: Markdown
preserve: frontmatter, relative links, admonitions, Mermaid, tabs, snippets, anchors
caution: Markdown dialects differ; match the repo's configured extensions.

### Format: MDX
preserve: imports, JSX components, props, frontmatter
caution: Do not rewrite JSX as plain Markdown unless asked.

### Format: reST
preserve: directives, roles, labels, toctrees, Sphinx/autodoc syntax
caution: indentation and blank lines are semantic.

### Format: AsciiDoc
preserve: attributes, includes, conditionals, blocks, anchors, xrefs
caution: do not replace semantic blocks with Markdown equivalents.

## Page Skeletons

### Skeleton: How-to
title: Task title
sections: Overview, Prerequisites, Steps, Verify, Troubleshooting, Next steps

### Skeleton: Reference
title: Reference subject
sections: Summary, Syntax/schema, Parameters/fields, Examples, Notes, Related docs

### Skeleton: Explanation
title: Concept title
sections: Summary, Context, How it works, Tradeoffs, Related docs

### Skeleton: Tutorial
title: Learning goal
sections: What you'll build, Prerequisites, Steps, What happened, Next steps
