---
name: brainstorm
description: Use when a request adds a feature, changes behavior, or has unclear intent, before any design, spec, or code is written.
---
# brainstorm

## Steps
1. Explore the code and docs first. Never ask what the repo answers.
2. Size the request. Small or obvious: go straight to tester. Medium or large: continue.
3. Ask the user one question at a time, with 2-4 options and a recommended default, only for preferences or tradeoffs.
4. Propose 2-3 approaches with tradeoffs, recommend one, and get approval.
5. Write the brief to `.slimstack/briefs/YYYY-MM-DD-<slug>.md` (first ensure `.slimstack/.gitignore` contains `*`) with sections `## Goal`, `## Approach`, `## Decisions` (each with why), `## Constraints`, `## Assumptions`.
6. Sceptical gate, every medium or large brainstorm after approval: ask the user one question, text `Proceed with sceptical-plan-reviewers?`, options:
   - `Proceed with sceptical-plan-reviewers` (recommended; description `3 Opus 5.5 high-effort reviewers cross-examine the brief for high- and medium-impact gaps; costs 3 Opus runs`)
   - `Skip sceptical review`
7. On proceed, read `${CLAUDE_SKILL_DIR}/references/sceptical-plan-reviewers.md` (omp: `skill://brainstorm/references/sceptical-plan-reviewers.md`) and follow it; it ends with the brief updated.
8. Hand the brief path to spec-writer.

## Gates
- HARD GATE: no code, scaffolding, or plan before the user approves an approach.
- The sceptical gate has no slash command; the user cannot start it directly.

## Output
The brief path.
