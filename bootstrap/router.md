# slimstack
Workflow skills are available. Invoke the matching skill BEFORE acting; skip only for trivial one-step requests.
- New feature, behavior change, unclear intent: brainstorm -> spec-writer -> task-planner (creates tickets on the Kanban board; the user assigns and starts work there)
- Writing or changing code: tester (failing test first)
- Bug, failing test, unexpected behavior: debugger
- About to say done, fixed, or passing: verifier
- Review a change or receive review feedback: reviewer
- Verified work ready to integrate: finisher
- Context is large or the session is ending: handoff
- Kanban board (open, status, stop, agent CLI, archive or clear): board
- Creating or editing a skill: skill-writer
- Terseness level or token stats: lean
Artifacts: specs in docs/slimstack/specs/, briefs and board state in .slimstack/ (git-ignored). Use the board only through the slimstack board tools; never assign, move, or start tickets unless the user asks.
Compacted tool output ends with a `[slimstack: ... full output: <path>]` marker; read that file only if the compacted text is not enough.
