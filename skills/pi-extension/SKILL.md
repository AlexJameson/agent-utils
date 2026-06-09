---
name: pi-extension
description: Build and debug Pi extensions and Pi skills with a minimal, practical workflow. Use when working on Pi overlays, extension hotkeys, pi-tui rendering, runtime sync issues, or installing skills into ~/.pi/agent/.
---

# Pi Extension Workflow

Use this skill for practical Pi extension and Pi skill work. Prefer the smallest correct change.

## 1. Confirm Runtime Location First

- Read the local workspace package manifest.
- Check whether Pi is using a copied install under `~/.pi/agent/extensions/<name>` or `~/.pi/agent/skills/<name>`.
- If behavior does not match local code, diff the workspace copy against the installed copy before assuming the bug is in the current tree.

## 2. Keep Installed Copies Clean

- Only sync files needed at runtime.
- Do not leave planning notes, logs, scratch files, or unrelated assets inside installed Pi directories.
- Keep docs and manifests in sync when they affect usage or installation.

## 3. Overlay Defaults

For terminal overlays, start with:

- `width: "100%"`
- `maxHeight: "100%"`
- `margin: 0`

Then reduce only when there is a concrete visual reason.

## 4. Input Handling

- Handle raw `Esc` and `matchesKey(data, "escape")` defensively.
- Keep hotkeys symmetric when possible.
- Avoid mode-specific shortcuts that silently change layout semantics.
- Keep footer hints aligned with the actual current bindings.

## 5. Rendering Rules

- Use `visibleWidth()` for layout math.
- Use `wrapTextWithAnsi()` when content should remain fully visible.
- Use `truncateToWidth()` only when truncation is explicitly the desired UX.
- If line numbers are shown, budget gutter width before wrapping.
- Re-render previews when the available width changes.

## 6. Diff Guidance

- Treat preview layout and diff layout as separate concerns.
- Side-by-side diff is good for comparison, but unified diff is usually better for narrow terminals and wrapped content.
- If line numbers cannot be represented honestly in a diff mode, omit them instead of inventing misleading values.

## 7. Verification

Run the smallest useful checks:

1. `npx tsc --noEmit`
2. Compare workspace files to the installed Pi copy when runtime sync matters.
3. Confirm docs and footer hints still match the implementation.

## 8. Never Store Credentials in Versioned Code

- **NEVER** hardcode API keys, tokens, passwords, or secrets in source files that will be committed.
- Use environment variables, runtime metadata services (e.g., Yandex Cloud metadata at `169.254.169.254`), or external secret stores.
- If a credential must be cached locally, use a temp file or runtime cache — not the repo.
- Review diffs before committing to ensure no secrets leak.

## 9. Skill Installation

- Repo skills can live under `skills/<skill-name>/`.
- A minimal skill folder should contain at least `SKILL.md` and `README.md`.
- If the repo uses a Pi manifest, ensure the root `package.json` exposes the skills directory.
- Install the skill into Pi by syncing it to `~/.pi/agent/skills/<skill-name>` when the user wants it available immediately.
