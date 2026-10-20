---
name: finisher
description: Use when implementation is complete and verified and the branch must be integrated by merge, PR, keep, or discard, then cleaned up.
---
# finisher

## Steps
1. Run verifier.
2. Ensure a clean tree and committed work.
3. Ask the user to choose: merge locally, open PR, keep, or discard.
4. Execute only the chosen option. PR: use `gh` when installed, else print the push command and the compare URL.
5. Clean the worktree and branch only after merge or discard.

## Gates
- Push and merge need explicit user confirmation.
- Discard needs the user to type `discard`.

## Output
The option executed and its result.
