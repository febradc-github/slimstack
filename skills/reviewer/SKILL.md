---
name: reviewer
description: Use when requesting a code review of a change or when receiving review feedback that must be verified before acting.
---
# reviewer

## Steps
Request a review:
1. Fill `${CLAUDE_SKILL_DIR}/references/review-prompt.md` (omp: `skill://reviewer/references/review-prompt.md`) with the diff range and the spec or ticket text.
2. Dispatch a fresh subagent with it.

Receive a review:
1. Verify each finding against the code before acting.
2. Implement Critical and Important findings.
3. Push back with evidence when a finding is wrong.

## Gates
- No performative agreement.
- Never act on an unverified finding.

## Output
Findings with disposition (fixed, rejected with evidence) and the reviewer's verdict.
