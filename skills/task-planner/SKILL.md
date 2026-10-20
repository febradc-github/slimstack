---
name: task-planner
description: Use when an approved spec needs to become Kanban board tickets with complete instructions, pseudocode, acceptance criteria, and blocked-by dependencies.
allowed-tools: mcp__plugin_slimstack_board__create_ticket mcp__plugin_slimstack_board__list_tickets mcp__plugin_slimstack_board__get_ticket
---
# task-planner

## Steps
1. Read the spec, and its brief when one exists.
2. Split the work into tickets that one person or one agent can each finish alone. Write every ticket with `${CLAUDE_SKILL_DIR}/references/ticket-template.md` (omp: `skill://task-planner/references/ticket-template.md`).
3. blockedBy rules: a ticket that needs another's output lists it; two tickets that touch the same file are chained (parallel agents share one working tree).
4. Self-review before creating: every spec R# is covered by an acceptance criterion, no placeholders, each ticket <= ~5 files.
5. Create the tickets with create_ticket in dependency order, using numbers returned by earlier calls in blockedBy.
6. Show a table (T-n, title, blocked by) and the board URL from the last result. Tell the user: assign tickets to Agent or to yourself on the board; nothing starts until you do.

## Gates
- Never assign, move, or start tickets.
- Board tools missing or failing: report the error and stop (Claude: `/mcp` shows the server status). Never fall back to a plan file.

## Output
The ticket table and the board URL.
