# slimstack

![slimstack: a chibi dev team around a Kanban board](docs/slimstack/chibi.png)

Token-lean agentic workflow for Claude Code and omp, installed straight from this GitHub repo. It ships 12 workflow skills (brainstorm to finisher), a tiny session bootstrap that makes agents use them with terse-output rules, a Bash output compactor with full-output spill-to-disk and local savings stats, a model-run sceptical review gate at the end of brainstorm, and a locally hosted Kanban board where you are the orchestrator and headless agents code, test, and reply on your board actions.

## Install (GitHub only)

Claude Code:
- Install: `/plugin marketplace add febradc-github/slimstack` then `/plugin install slimstack@slimstack` (CLI: `claude plugin marketplace add febradc-github/slimstack` and `claude plugin install slimstack@slimstack`).
- Update: `claude plugin marketplace update slimstack` then `claude plugin update slimstack@slimstack`; run `/reload-plugins` in open sessions.
- Remove: `/plugin uninstall slimstack@slimstack`.

omp:
- Install: `omp plugin install github:febradc-github/slimstack`.
- Update: `omp plugin upgrade slimstack`.
- Remove: `omp plugin uninstall slimstack`.
- Restart omp after install or upgrade (extension modules load at session start).

Prerequisite: Node >= 18 on PATH for the Claude Code hooks and the board. omp needs no Node: its board bridge runs on omp itself, so `omp` must be on PATH.

## Skills

|Skill|Use|
|---|---|
|brainstorm|Explore intent, propose approaches, write a brief; ends with the sceptical gate|
|spec-writer|Turn the brief into a spec with testable requirements and acceptance|
|task-planner|Turn the spec into Kanban tickets with instructions, pseudocode, acceptance, blocked-by|
|board|Open, check, stop the board; choose the agent CLI; archive or clear a finished board|
|tester|Failing test first, minimum code, wider suite|
|debugger|Reproduce, find the root cause, then fix|
|reviewer|Request a review or verify received feedback|
|verifier|Run the proof and read its output before claiming done|
|finisher|Merge, PR, keep, or discard, then clean up|
|handoff|Write a compact resumable handoff|
|skill-writer|Create or edit skills within size and wording budgets|
|lean|Set terseness, toggle compaction, show token stats|

Flow: brainstorm -> (sceptical-plan-reviewers gate) -> spec-writer -> task-planner -> Kanban board (you assign; agents code, test, and reply) -> finisher.

Artifacts: brief `.slimstack/briefs/YYYY-MM-DD-<slug>.md`; spec `docs/slimstack/specs/YYYY-MM-DD-<slug>.md`; board state `.slimstack/board/`; handoff `.slimstack/handoffs/YYYY-MM-DD-HHMM-<slug>.md`. `.slimstack/` is git-ignored by its own `.gitignore`.

### Sceptical-plan-reviewers gate

After you approve an approach in a medium or large brainstorm, the agent asks `Proceed with sceptical-plan-reviewers?`. Accepting runs three Opus 5.5 high-effort reviewer agents (SkepticScope, SkepticDesign, SkepticRisk) that message each other to hunt for real high- and medium-impact gaps; the findings and recommendations are shown to you, and you choose which to apply. The gate is model-run only: you cannot start it yourself, and it costs three Opus runs when accepted.

## Tokens: what is and is not claimed

- Terse-output rules save roughly 8-10% in independent benchmarks (JetBrains). No more is claimed.
- The compactor applies to successful Bash output of 8,000-30,000 chars, on Claude Code only. Above about 30,000 chars Claude itself saves the output to a file and shows a 2,000-char preview; output of failed commands cannot be replaced by Claude hooks. omp uses its native `shellMinimizer`, so slimstack adds no compactor there.
- The full output is always spilled to `.slimstack/spill/` first (3-day retention); the compacted text ends with a marker naming the file.
- Stats are local only: `/slimstack:lean stats` (Claude) or `/slimstack stats` (omp). No telemetry.

## Controls

- `lean off|lite|full` sets response terseness; `compact on|off` toggles Bash output compaction.
- Claude: `/slimstack:lean <args>`. omp: `/slimstack <args>`.
- Config file `~/.slimstack/config.json` is shared by both harnesses; override the directory with env `SLIMSTACK_HOME`.

## Kanban board

Open it with `/slimstack:board open` (omp: `/slimstack board open`). It also opens itself the first time the task-planner creates tickets. It runs as a local daemon per project, stops after 2 hours idle, and restarts on demand.

What starts an agent (you are the orchestrator; nothing runs until you act):
- You assign a To Do or In Progress ticket to Agent: a coding agent starts (rework mode when the ticket has open bugs). If blockers are not Done it waits, shown as `Queued`, and starts when they are.
- You move a ticket to In Progress while it is assigned to Agent: a coding agent starts.
- A ticket enters Testing (by anyone): a tester agent starts.
- You comment in a thread started by a tester: the tester judges your reply on its merits, resolves the bug only for a fix it re-checks or a clearly reasoned dismissal, and otherwise asks for your reasoning.
- You comment in a thread started by a coding agent on an Agent ticket: that coder resumes.
- Any other comment of yours: a responder agent answers in the thread.
- You reassign a ticket away from Agent, or move it to To Do or Done: its running coder and tester agents are stopped.
- Restart agent (Agent runs tab) re-queues a coder (To Do or In Progress, assigned to Agent) or a tester (Testing).
- Per ticket, a coder and a tester never run at once; there is no global limit, so parallelism is however many tickets you assign.

Rules enforced by the server, for the interactive session and every agent run:
- Blocked-by: no ticket moves to In Progress, Testing, or Done while a blocker is not Done; cycles and self-blocks are rejected.
- Done: agents move a ticket to Done only from Testing, only when it is assigned to Agent, it has no open bug, and the newest tester `test_run` passed after it entered Testing. A ticket assigned to you (or unassigned) is moved to Done only by you.
- Agents never assign tickets, never move tickets back to To Do, never reopen Done tickets, and each run touches only its own ticket. Only tester runs file bugs or post test results.
- Archive or clear works only when every ticket is Done and no run is active.

Agent CLI: `/slimstack:board agent auto|claude|omp` (omp: `/slimstack board agent ...`). `auto` uses the harness that started the board. For anything else set `board.agent` to `custom` and `board.command` in `~/.slimstack/config.json`, using the placeholders `{mcpConfig}` `{ticket}` `{run}` `{role}` `{cwd}` `{prompt}`. The prompt goes to stdin unless an argument contains `{prompt}`.

Safety:
- The board listens on 127.0.0.1 only, behind a per-start token.
- Agent runs use `--permission-mode bypassPermissions` (Claude) or `--approval-mode yolo` (omp) and can run any command in the repo.
- Agents never commit; you do.
- Every run is a full headless session billed to your account.

Files: `.slimstack/board/` holds `board.json` (state), `runs/R-<n>.log` (agent logs), and `archive/`.

Troubleshooting:
- A run fails because policy disables bypass mode: set `board.agent` to `custom` with `board.command` = `["claude","-p","--mcp-config","{mcpConfig}","--strict-mcp-config","--permission-mode","acceptEdits","--allowedTools","Bash,Read,Edit,Write,Grep,Glob,mcp__slimstack-board__*"]`.
- `agent command not found on PATH`: put `claude` or `omp` on PATH, or use an absolute path in a custom command.
- Logs: `.slimstack/board/runs/R-<n>.log` and `.slimstack/board/daemon.log`.

## Development

- Try locally: `claude --plugin-dir .` or `omp -e .`.
- Check: `bun scripts/build.ts && bun scripts/lint.ts && bun test`.
- Commit `dist/` (users get a git clone; no build runs on their machine). Never commit a lockfile.
- Bump `version` in both `package.json` and `.claude-plugin/plugin.json` for every release; Claude users stay on the old copy otherwise.
- Run `bun scripts/set-owner.ts <github-user>` before the first push.

## Acceptance (after first push)

After `set-owner`, commit, and push:
1. `claude plugin validate .`
2. `/plugin marketplace add <user>/slimstack`, then `/plugin install slimstack@slimstack`.
3. New session, ask "Quote the first line of your slimstack context" -> `# slimstack`.
4. Ask Claude to dispatch a subagent that quotes the first line of its context starting with `## lean` -> `## lean: lite`.
5. Run `node -e "for(let i=0;i<1500;i++)console.log('line '+i)"` (about 15,000 chars, inside the 8,000-30,000 window) -> the Bash result ends with `[slimstack: compacted ...]`.
6. `/slimstack:lean stats` -> `compactions: 1`.
7. Typing `/slimstack:` lists `board` and no `sceptical-plan-reviewers` or `orchestrator` entry.
8. `/mcp` lists the slimstack `board` server as connected.

Gate (both harnesses, in any repo): ask for a medium feature (for example "add a --json output flag to the CLI") and approve an approach.
- The question `Proceed with sceptical-plan-reviewers?` appears; choose proceed.
- Three agents `SkepticScope`, `SkepticDesign`, `SkepticRisk` run on Opus 5.5 (Claude: `slimstack:sceptical-plan-reviewer` in the transcript; omp: the task UI model badge or routing note `slimstack: sceptical-plan-reviewers on opus-5.5 high`) and exchange messages.
- A findings table with only High and Medium rows appears (or the no-gaps line), then the question `Apply which sceptical-review recommendations?`.
- The brief gains `## Sceptical review`.

Board (Claude, scratch git repo with one commit):
- brainstorm -> spec-writer -> task-planner on a small feature; a browser tab opens `http://127.0.0.1:<port>/` with the tickets.
- Assign one to Agent: its card shows `Agent working` and Agent runs lists a running `R-1` coder whose log starts with `# R-1 coder implement` and shows the `claude -p` argv.
- The ticket reaches Testing, a tester run posts a `test_run` comment, and the ticket ends in Done or with Open bug comments.
- Reply `it's fine` in a bug thread: the tester replies asking for your reasoning and the bug stays Open.

omp: `omp plugin install github:<user>/slimstack`; `omp plugin list` shows `slimstack` enabled; in a new session `/slimstack stats` prints the no-compactions line.
