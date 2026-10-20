---
name: lean
description: Use when the user asks to change response terseness (off, lite, full), toggle Bash output compaction, or see token-savings stats.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" *)
---
# lean

## Steps
1. Read the request from the invocation arguments (`$ARGUMENTS`; omp appends them as a `User:` line) or the user's message: `off|lite|full`, `compact on|off`, or `stats`.
2. Apply a new terseness level to your own replies immediately.
3. Persist or query by running exactly `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" <args>` and relay its output verbatim.
4. If that path still begins with a literal dollar-brace placeholder instead of a real directory, you are on omp: do not run it; tell the user to run `/slimstack <args>`.

## Gates
- Never change the level unprompted.
- State that Bash output compaction runs on Claude Code only (omp has its own shell minimizer).

## Output
The CLI's text, verbatim, plus one line naming the level now in force.
