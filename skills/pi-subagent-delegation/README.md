# pi-subagent-delegation

Skill for delegating tasks to pi-subagents (scout, worker, reviewer). Keeps the main session context clean by offloading research, implementation, and review into isolated subprocesses.

## What it covers

- When to delegate vs. handle directly
- Agent roles (scout, planner, worker, reviewer)
- Model assignment recommendations
- How to structure self-contained tasks with absolute paths, project context, current state, boundaries, and expected output
- Chain mode with `{previous}` context passing
- Parallel mode with fan-out / fan-in aggregators
- Verification requirements (TypeScript, tests, lint)
- Result integration back into the main session
- Custom agent creation
- Common anti-patterns

## Usage

Pi loads this skill automatically when the `pi-subagent-delegation` package is installed. The assistant then follows these guidelines when constructing `subagent` tool calls.
