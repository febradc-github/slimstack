# Sceptical plan review (brainstorm gate; model-run only)
Run only from brainstorm's sceptical gate, after the user approved the approach and chose "Proceed with sceptical-plan-reviewers".

## Reviewers
Three peers, same agent, different lenses. Their names are their message addresses.
- SkepticScope: user intent, missing or wrong requirements, acceptance gaps, edge cases, scope omissions.
- SkepticDesign: fit with existing code and patterns, interfaces, data and state flow, dependencies, migration, performance.
- SkepticRisk: failure modes, security and privacy, data loss, concurrency, operability, how the result will be verified.

## Launch (all three in one batch, never one after another)
Fill sceptic-prompt.md (same directory) once per reviewer: ROLE = name, LENS = its lens line, PEERS = the other two names, BRIEF = the brief path.
- Claude Code: three Agent calls in one message, subagent_type `slimstack:sceptical-plan-reviewer`, name = reviewer name, prompt = filled template.
- omp: one task call; context = "Sceptical review of <brief path>. Peers: SkepticScope, SkepticDesign, SkepticRisk."; three items with name = reviewer name, agent = `sceptical-plan-reviewer`, task = filled template, solutionSpace = "gap discovery; design under review, causes open".
If the launch fails (unknown agent, model unavailable), show the error and ask the user: "Retry on the default model" or "Skip sceptical review". Retry = the same launch with Claude subagent_type `general-purpose` / omp agent `task`.

## Synthesize
1. Collect the three reports. Merge duplicates; keep the strongest evidence and list every raiser.
2. Drop a finding when a peer refuted it with evidence you confirm, when it is Low impact, when the brief already covers it, or when it has no concrete evidence.
3. Open the cited file/line for every remaining High finding and confirm it yourself.
4. Keep at most 8, High first.

## Present
No findings left: say "Sceptical review: no high- or medium-impact gaps found." and continue to spec-writer.
Otherwise show this table, then ask one question:
| # | Impact | Gap | Evidence | Recommendation | Raised by (peer status) |
Question "Apply which sceptical-review recommendations?", options: "Apply all" (recommended), "Apply High only", "Choose by number" (the user replies with numbers), "Apply none".
Update the brief's Approach/Decisions for applied items and append "## Sceptical review" listing applied (# and change) and declined (# and gap). Continue to spec-writer with the brief path.
