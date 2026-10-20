---
name: verifier
description: Use before claiming work is done, fixed, or passing, and before committing or opening a PR, to run the proof and read its output.
---
# verifier

## Steps
1. Identify the command that proves the claim (ticket acceptance criteria or spec acceptance).
2. Run it fresh.
3. Read the full output and the exit code. If a `[slimstack: ... full output: <path>]` marker hides needed lines, read that file.
4. Compare the result to the acceptance criteria.
5. State the result with evidence: the command and the decisive line.

## Gates
- On failure report the actual state.
- Never say "should work".

## Output
Claim, command, decisive output line, pass or fail.
