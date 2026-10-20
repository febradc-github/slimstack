---
name: handoff
description: Use when context is large, the session is ending, or work moves to a fresh session or agent, to write a compact resumable handoff.
---
# handoff

## Steps
1. Ensure `.slimstack/.gitignore` contains `*`.
2. Write `.slimstack/handoffs/YYYY-MM-DD-HHMM-<slug>.md`, at most 60 lines, with sections:
   - `Goal`
   - `State` (done / in progress / next, with file paths)
   - `Decisions` (each with why)
   - `Verify` (exact commands)
   - `Gotchas`
   - `Artifacts` (brief and spec paths, board URL)
3. A resuming session reads the handoff first, then calls list_tickets when a board is in use.

## Output
The handoff path.
