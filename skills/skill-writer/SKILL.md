---
name: skill-writer
description: Use when creating or editing a skill in this plugin, to enforce size budgets, harness-neutral wording, and a pressure test.
---
# skill-writer

## Rules
- Frontmatter has only `name` (equals the directory name) and `description`.
- Description starts with `Use when` or `Use before`, is <= 250 chars, and contains no `: ` and no `#`.
- Body <= 3,000 bytes; bulk goes in `references/`.
- No harness tool names; say "dispatch a subagent", "ask the user", "checklist".
- Bundled-file references use both forms, Claude first: `${CLAUDE_SKILL_DIR}/references/x.md` (omp: `skill://<skill>/references/x.md`) for the skill's own files; `${CLAUDE_PLUGIN_ROOT}/skills/<other>/references/x.md` (omp: `skill://<other>/references/x.md`) for a sibling's.
- Any skill writing under `.slimstack/` first ensures `.slimstack/.gitignore` contains `*`.

## Steps
1. Write `skills/<name>/SKILL.md`: `# Title`, `## Steps` (numbered), `## Gates`, `## Output` where relevant.
2. Run `bun scripts/lint.ts`; fix every failure.
3. Pressure-test: dispatch a fresh subagent on a realistic task with the skill and another without it; compare behavior.
4. Edit the skill until the subagent follows it; repeat steps 2-3.

## Gates
- Do not finish while lint fails or the pressure test shows the skill ignored.

## Output
Lint result and the pressure-test comparison.
