import {spawn} from "node:child_process";
import {appendFileSync, mkdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {startDaemon} from "../board/daemon.ts";
import {boardDir} from "../board/paths.ts";

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (args.includes("--launch")) {
  // Re-spawn detached so the daemon is outside the caller's process tree, then leave.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args.filter((a) => a !== "--launch")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.on("error", () => {});
  child.unref();
  process.exit(0);
}

const projectRoot = flag("--project");
const harness = flag("--harness");
if (!projectRoot || (harness !== "claude" && harness !== "omp")) {
  process.stderr.write("usage: board.mjs [--launch] --project <dir> --harness claude|omp\n");
  process.exit(1);
}

try {
  const daemon = await startDaemon({projectRoot, harness});
  const shutdown = () => {
    void daemon.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await daemon.stopped;
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("board daemon already running")) process.exit(0);
  try {
    const dir = boardDir(projectRoot);
    mkdirSync(dir, {recursive: true});
    appendFileSync(join(dir, "daemon.log"), `${new Date().toISOString()} startup failed: ${err instanceof Error ? (err.stack ?? message) : message}\n`);
  } catch {
    process.stderr.write(`slimstack board: ${message}\n`);
  }
  process.exit(1);
}
