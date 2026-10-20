import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import {randomBytes} from "node:crypto";
import {basename, join} from "node:path";
import {readConfig} from "../core/config.ts";
import {ensureSlimstackDir} from "../core/paths.ts";
import type {DaemonInfo} from "./client.ts";
import {openUrl} from "./open-url.ts";
import {createOps} from "./ops.ts";
import {boardDir as boardDirOf, pluginRoot as defaultPluginRoot} from "./paths.ts";
import {createBoardServer, type BoardServer} from "./server.ts";
import {realSpawner, type Spawner} from "./spawn.ts";
import {BoardStore} from "./store.ts";
import {VERSION} from "./version.ts";
import {Watcher} from "./watcher.ts";

export interface DaemonOptions {
  projectRoot: string;
  harness: "claude" | "omp";
  env?: NodeJS.ProcessEnv;
  uiDir?: string;
  spawner?: Spawner;
  pluginRoot?: string;
}

export interface Daemon {
  url: string;
  port: number;
  uiToken: string;
  stop(): Promise<void>;
  /** Resolves once the daemon has fully stopped (by `stop()`, `/api/shutdown`, or the idle check). */
  stopped: Promise<void>;
}

const IDLE_CHECK_MS = 60_000;
const IDLE_LIMIT_MS = 2 * 60 * 60 * 1000;
const LOG_MAX_BYTES = 1_000_000;
const FRESH_LOCK_MS = 5_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function acquireLock(file: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(file, "wx");
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      let pid = Number.NaN;
      let fresh = false;
      try {
        pid = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
        fresh = Date.now() - statSync(file).mtimeMs < FRESH_LOCK_MS;
      } catch {
        // the holder just released it: retry
        if (attempt < 3) continue;
        throw err;
      }
      if (Number.isInteger(pid) && pid > 0) {
        if (isAlive(pid)) throw new Error(`board daemon already running (pid ${pid})`);
      } else if (fresh) {
        // the holder is between creating the lock and writing its pid
        throw new Error("board daemon already running (pid unknown)");
      }
      if (attempt >= 1) throw new Error(`could not take board lock ${file}`);
      unlinkSync(file);
    }
  }
}

/** Atomic file replace; Windows indexers and readers can briefly lock the target. */
function writeFileAtomic(file: string, data: string): void {
  const tmp = file + ".tmp";
  writeFileSync(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}

export async function startDaemon(o: DaemonOptions): Promise<Daemon> {
  const env = o.env ?? process.env;
  const root = o.pluginRoot ?? defaultPluginRoot();
  const projectRoot = o.projectRoot;
  const dir = boardDirOf(projectRoot);

  ensureSlimstackDir(projectRoot);
  mkdirSync(join(dir, "runs"), {recursive: true});
  mkdirSync(join(dir, "archive"), {recursive: true});

  const lockFile = join(dir, "daemon.lock");
  acquireLock(lockFile);

  const logFile = join(dir, "daemon.log");
  try {
    if (statSync(logFile).size > LOG_MAX_BYTES) writeFileSync(logFile, "");
  } catch {
    // no log yet
  }
  const log = (message: string) => {
    try {
      appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
    } catch {
      // logging must never break the daemon
    }
  };

  const infoFile = join(dir, "daemon.json");
  let server: BoardServer | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  try {
    const store = BoardStore.load(join(dir, "board.json"));
    store.log = log;
    if (store.warning) log(store.warning);

    const uiToken = randomBytes(24).toString("hex");
    const mcpToken = randomBytes(24).toString("hex");
    let port = 0;
    const url = () => `http://127.0.0.1:${port}/`;
    const ops = createOps(store, {boardDir: dir, projectName: basename(projectRoot), boardUrl: url});
    const watcher = new Watcher({
      store,
      ops,
      spawner: o.spawner ?? realSpawner,
      projectRoot,
      boardDir: dir,
      harness: o.harness,
      pluginRoot: root,
      execPath: process.execPath,
      env,
      readConfig: () => readConfig(env).board,
    });

    let lastActivity = Date.now();
    let browserOpened = false;
    let stopping: Promise<void> | undefined;
    let markStopped!: () => void;
    const stopped = new Promise<void>((resolve) => {
      markStopped = resolve;
    });

    const stop = (): Promise<void> => {
      stopping ??= (async () => {
        clearInterval(idleTimer);
        try {
          watcher.stopAll("board stopped");
        } catch (err) {
          log(`stopAll failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await server?.close();
        rmSync(infoFile, {force: true});
        rmSync(lockFile, {force: true});
        log("daemon stopped");
        markStopped();
      })();
      return stopping;
    };

    server = createBoardServer({
      ops,
      store,
      watcher,
      uiToken,
      mcpToken,
      uiDir: o.uiDir ?? join(root, "dist", "board-ui"),
      projectName: basename(projectRoot),
      url,
      onActivity: () => {
        lastActivity = Date.now();
      },
      onSessionCreate: () => {
        if (browserOpened) return;
        browserOpened = true;
        if (readConfig(env).board.openBrowser && server!.sseClientCount() === 0) openUrl(url());
      },
      onShutdown: () => {
        void stop();
      },
      log,
    });

    let preferred = 0;
    try {
      const n = Number.parseInt(readFileSync(join(dir, "last-port"), "utf8").trim(), 10);
      if (Number.isInteger(n) && n > 0 && n < 65536) preferred = n;
    } catch {
      // first start
    }
    try {
      port = await server.listen(preferred);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (preferred === 0 || (code !== "EADDRINUSE" && code !== "EACCES")) throw err;
      port = await server.listen(0);
    }
    writeFileSync(join(dir, "last-port"), String(port));
    const info: DaemonInfo = {pid: process.pid, port, mcpToken, harness: o.harness, startedAt: Date.now(), version: VERSION};
    writeFileAtomic(infoFile, JSON.stringify(info));
    process.stderr.write(`slimstack board: ${url()}\n`);
    log(`daemon started: ${url()} pid ${process.pid} harness ${o.harness} version ${VERSION}`);

    watcher.recover();

    idleTimer = setInterval(() => {
      const busy = store.state.runs.some((r) => r.status === "running");
      if (server!.sseClientCount() === 0 && !busy && Date.now() - lastActivity > IDLE_LIMIT_MS) {
        log("idle for 2 h: stopping");
        void stop();
      }
    }, IDLE_CHECK_MS);
    idleTimer.unref();

    return {url: url(), port, uiToken, stop, stopped};
  } catch (err) {
    clearInterval(idleTimer);
    await server?.close();
    rmSync(infoFile, {force: true});
    rmSync(lockFile, {force: true});
    throw err;
  }
}
