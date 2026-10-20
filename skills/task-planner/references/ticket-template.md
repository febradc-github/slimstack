# Ticket template (task-planner)
create_ticket fields:
- title: imperative, <= 80 chars, names the outcome ("Add --json flag to the export command").
- instructions (markdown), complete enough that someone with no other context can finish the ticket:
  ## Context: why this ticket exists; the spec path and the R# it covers.
  ## Files: create / modify / test, with paths.
  ## Interfaces: what it consumes from its blockers and what it produces (signatures, data shapes).
  ## Steps: numbered; failing test first where the repo has tests.
  ## Constraints: conventions to follow, things not to touch.
- pseudocode: the intended implementation in 5-30 lines of language-neutral pseudocode.
- acceptanceCriteria: 2-6 items, each "<concrete input or command> -> <observable output>".
- blockedBy: numbers of tickets whose output this one needs or that touch the same files.
