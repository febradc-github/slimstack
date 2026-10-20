---
name: spec-writer
description: Use when intent is settled and a written spec with testable requirements and acceptance criteria is needed before planning.
---
# spec-writer

## Steps
1. Read the brainstorm brief when one exists, including its `## Sceptical review` section.
2. Write `docs/slimstack/specs/YYYY-MM-DD-<slug>.md` with sections exactly:
   - `# Title`
   - `## Context` (2-4 sentences)
   - `## Requirements` (numbered R1.., each testable)
   - `## Acceptance` (per requirement: concrete input -> observable output)
   - `## Interfaces`
   - `## Constraints`
3. Self-review: every R# has an acceptance line; no TBD, TODO, or etc.; no empty section.
4. Ask the user to approve the spec.
5. Next skill: task-planner.

## Gates
- No planning before the user approves the spec.

## Output
The spec path.
