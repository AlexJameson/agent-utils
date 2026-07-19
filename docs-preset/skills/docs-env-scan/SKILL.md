---
name: docs-env-scan
description: >-
  Use when documentation tooling, structure, or conventions are unknown;
  when contracts in .agents/docs-preset/ are missing, contradicted, or
  stale; or when the user asks to (re)scan the docs environment. Detects
  docs-as-code tooling, user-facing documentation surfaces, lightweight zones,
  edit-safety boundaries, and style conventions; then writes user-validated
  Markdown-KV contracts (TOOLING.md, STYLE.md, STRUCTURE.md). Runs in codify
  mode for existing repos and bootstrap mode for empty ones.
---

# Docs Environment Scan

> STATUS: V1 SCAFFOLD — body to be written against REQUIREMENTS.md RS-V1-2.
> Frontmatter description is load-bearing for skill triggering.

## Planned sections

- Detection checklist: docs root/surfaces, platform/tooling, nav config,
  markup flavor, build/lint commands, frontmatter conventions, languages,
  generated outputs, and locked/non-editable boundaries (V1-SC-1, V1-SC-2)
- Surface detection: user-facing README, docs directory, examples, changelog,
  release notes, tutorials, API samples, and user-facing developer notes
  (V1-SC-8)
- Safety constraint reading: local agent/rules files may inform safety, but are
  not user-facing documentation surfaces by default (V1-SC-12)
- Confidence taxonomy: detected / inferred / user / unknown — never guess
  unknown facts (V1-SC-3)
- Validation protocol: one compact message, write contracts only after confirm
  unless the user explicitly asks for bootstrap defaults (V1-SC-4, V1-SC-6)
- Contract formats: TOOLING.md, STYLE.md, STRUCTURE.md as Markdown-KV documents;
  preserve unknown keys and extension records (V1-SC-6, V1-SC-13)
- Bootstrap mode: ask at most three questions — product, primary reader, first
  desired docs outcome (V1-SC-5)
- Re-run protocol: idempotent, preserve user edits, re-validate only changed
  facts (V1-SC-10)
- Zone detection: obvious product/section zones from top-level docs directories
  and navigation labels (V1-SC-7)
- Style inference from cheap signals: language, heading style, tone,
  terminology, filename pattern, frontmatter, admonitions, code blocks (V1-SC-9)

## Hard constraint

On-demand only: no automation, no scheduled re-scans, no exhaustive page-by-page
audit in v1. STRUCTURE.md stays compact and partial.
