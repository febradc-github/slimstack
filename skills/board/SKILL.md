---
name: board
description: Use when the user wants to open, check, or stop the slimstack Kanban board, change which CLI runs board agents, or archive or clear a finished board.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" board *) mcp__plugin_slimstack_board__list_tickets mcp__plugin_slimstack_board__archive_board mcp__plugin_slimstack_board__clear_board
---
# board

## Steps
1. `open`, `status`, `stop`, `agent [auto|claude|omp]`: run exactly `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" board <args>` and relay its output verbatim.
2. If that path still begins with a literal dollar-brace placeholder, you are on omp: tell the user to run `/slimstack board <args>`.
3. Archive or clear, only when the user asked for it in this conversation: call list_tickets first. Any ticket not Done: name them and stop. Otherwise call archive_board (optional title) or clear_board and report the result.

## How it works (when asked)
- The user is the orchestrator. Agents start only from board actions: assign to Agent -> coding agent once blockers are Done; move to Testing -> tester; comment -> reply; reply in an agent's thread -> that agent.
- The server enforces blocked-by and Done rules.
- A custom agent command goes in `~/.slimstack/config.json` `board.command`.

## Gates
- Never assign, move, or start tickets yourself.
- Never archive or clear unprompted.

## Output
The CLI output, or the archive id or removed count.
