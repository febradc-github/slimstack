---
name: debugger
description: Use when a bug, failing test, or unexpected behavior appears, before proposing any fix, to reproduce it and find the root cause first.
---
# debugger

## Steps
1. Reproduce with the exact command and record the output.
2. Read the full error or trace.
3. List at most 3 ranked hypotheses. Test each with the cheapest discriminating probe (log, assert, bisect).
4. Fix the root cause with a regression test (tester).
5. Verify (verifier).

## Gates
- Never patch symptoms.
- After 3 failed fix attempts stop, report findings, and question assumptions with the user.

## Output
Root cause, fix, regression test, verification evidence.
