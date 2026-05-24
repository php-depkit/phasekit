# Phasekit

## Tech Stack
- typescript
- bun

## Documentation
- PRD: .planning/PHASEKIT-PRD.md
- INITIAL IMPLEMENTATION PLAN: .planning/IMPLEMENTATION.md
- INITIAL IDEA: .planning/FEEDBACK.md
- AGENT MEMORY: .planning/MEMORY.md
- IMPLEMENTATION PLAN: .planning/APPROVED-IMPLEMENTATION-PLAN.md
- TODO: .planning/TODO.md
- AGENTS.md

## Core rules
- Do not run or rely on old GSD workflows. They are for reference only.
- Do not make up requirements.
- If something affects architecture, public behavior, state schema, plugin behavior, command names, or persistence, ask before deciding.
- Keep tasks small enough for executor sub-agents to complete without ambiguity.
- The main agent is an orchestrator. It should plan, assign, inspect, and verify. It should not implement large chunks directly.
- Use sub-agents for focused execution, review, and verification whenever possible.
- Do not proceed to broad implementation until the plan is written and accepted.
- Do not touch unrelated files.
- Write durable notes, decisions, blockers, and open questions to .planning/MEMORY.md between runs.
- You **must** keep TODO.md up to date with your progress
- You **must** commit after every plan is verified

## Product Constraints
- v1 is OpenCode-only, with a harness-agnostic core.
- OpenCode plugins can register native tools, but commands and agents must be generated as markdown/config artifacts.
- Plugin tools are the executable surface.
- Generated commands/agents are wrappers that call tools.
- Canonical shared state lives in .planning JSON files.
- SQLite is local cache only and must be rebuildable.
- No compatibility layer for old GSD commands.
- No parallel execution in v1.
- No assumptions by default. Research and ask when unclear.
- Review and verification run by default before commit.

## Memory
- Keep .planning/MEMORY.md updated with:
  - decisions made
  - questions answered
  - assumptions explicitly approved
  - blockers
  - completed phase/TODO status
  - verification findings
  - next recommended action
