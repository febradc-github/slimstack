---
name: tester
description: Use when writing or changing code that must be correct, to write the failing test first, then the minimum code, then run the wider suite.
---
# tester

## Steps
1. Find the existing test runner and conventions. Do not introduce a new one; if none exists, ask the user once and use the language standard.
2. Write the smallest failing test per acceptance line.
3. Run it and confirm it fails for the expected reason.
4. Implement the minimum code.
5. Run the test green, then run the wider suite.

## Gates
- Bug fix = regression test first.
- Test behavior, boundaries, and errors. No tautologies, mock echoes, or tests that restate the implementation's wording.
- Tests are deterministic.

## Output
Test command, red then green result, wider suite result.
