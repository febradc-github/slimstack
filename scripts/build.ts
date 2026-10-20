import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, sourceHash } from "./hash.ts";

process.chdir(ROOT);

const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;

function check(name: string, result: Bun.BuildOutput): void {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  throw new Error(`build failed: ${name}`);
}

rmSync("dist", { recursive: true, force: true });

check(
  "node bundles",
  await Bun.build({
    entrypoints: [
      "src/bin/claude-hook.ts",
      "src/bin/cli.ts",
      "src/adapters/omp.ts",
      "src/bin/board.ts",
      "src/bin/mcp.ts",
    ],
    outdir: "dist",
    naming: "[name].mjs",
    target: "node",
    format: "esm",
    minify: false,
    define: { __SLIMSTACK_VERSION__: JSON.stringify(version) },
  }),
);

check(
  "board ui",
  await Bun.build({
    entrypoints: ["src/board/ui/app.ts"],
    outdir: "dist/board-ui",
    naming: "[name].js",
    target: "browser",
    format: "esm",
    minify: true,
  }),
);

mkdirSync("dist/board-ui", { recursive: true });
cpSync("src/board/ui/index.html", join("dist", "board-ui", "index.html"));
cpSync("src/board/ui/app.css", join("dist", "board-ui", "app.css"));

writeFileSync(join("dist", "build-hash.txt"), sourceHash());
console.log(`built slimstack ${version} -> dist/`);
