import router from "../../bootstrap/router.md" with { type: "text" };
import leanLite from "../../bootstrap/lean-lite.md" with { type: "text" };
import leanFull from "../../bootstrap/lean-full.md" with { type: "text" };
import toolsClaude from "../../bootstrap/tools-claude.md" with { type: "text" };
import toolsOmp from "../../bootstrap/tools-omp.md" with { type: "text" };
import type { LeanLevel } from "./config.ts";

export type Harness = "claude" | "omp";
export type Role = "main" | "sub";

/** Session bootstrap text. Contains nothing per-session so the prompt cache stays stable. */
export function buildBootstrap(o: { harness: Harness; role: Role; lean: LeanLevel }): string | null {
  const lean = o.lean === "off" ? null : o.lean === "full" ? leanFull : leanLite;
  if (o.role === "sub") return lean === null ? null : lean.trim();
  const parts = [router];
  if (lean !== null) parts.push(lean);
  parts.push(o.harness === "omp" ? toolsOmp : toolsClaude);
  return parts.map((p) => p.trim()).join("\n\n");
}
