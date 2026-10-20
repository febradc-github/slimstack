# Review prompt
Inputs: RANGE = {{RANGE}} (git diff range), REQUIREMENTS = {{REQUIREMENTS}} (spec or ticket text).
Read the diff for RANGE and the code around it. Do not modify any file.
Check, in this order:
1. Correctness against REQUIREMENTS: every requirement or acceptance line is met; edge cases and error paths.
2. Test quality: tests assert behavior, cover boundaries and errors, are deterministic; no tautologies or mock echoes.
3. Security: input handling, secrets, injection, unsafe file or process use.
4. Scope creep: changes beyond REQUIREMENTS.
Output one line per finding, at most 15, most severe first:
Critical|Important|Minor: <path>:<line> - problem - fix
Then a final line:
Verdict: approve|changes-needed
No praise, no summary.
