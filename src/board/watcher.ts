import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {rmSync} from "node:fs";
import {join} from "node:path";
import type {BoardConfig} from "../core/config.ts";
import {BoardError, blockersNotDone, openBugs, type Ops} from "./ops.ts";
import {buildPrompt, expandArgv, resolveAgentArgv, runEnv, writeRunMcpConfig, type Harness, type Spawner} from "./spawn.ts";
import type {BoardStore} from "./store.ts";
import {STATUS_LABEL, type Actor, type AgentRole, type BoardEvent, type BoardState, type Mode, type Run} from "./types.ts";

/** Schedules `fn` after `ms` and returns a function that cancels it. */
export type TimerSetter = (fn: () => void, ms: number) => () => void;

export interface WatcherOptions {
  store: BoardStore;
  ops: Ops;
  spawner: Spawner;
  projectRoot: string;
  boardDir: string;
  harness: Harness;
  pluginRoot: string;
  /** The daemon's own executable (becomes the bridge command in run MCP configs). */
  execPath: string;
  /** The daemon's environment; runs inherit it minus the nested-session variables. */
  env: NodeJS.ProcessEnv;
  /** Re-read at every run start so `board.agent` changes apply to the next run. */
  readConfig: () => BoardConfig;
  now?: () => number;
  setTimer?: TimerSetter;
}

const POLL_MS = 10_000;
const LOST_NOTE = "ended while the board daemon was down; exit status unknown";

const defaultTimer: TimerSetter = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Kills a run process this daemon did not spawn (adopted after a daemon restart). */
function killPid(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {windowsHide: true});
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

function isActive(r: Run): boolean {
  return r.status === "pending" || r.status === "running";
}

function duration(from: number, to: number): string {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

export class Watcher {
  private readonly store: BoardStore;
  private readonly ops: Ops;
  private readonly now: () => number;
  private readonly setTimer: TimerSetter;
  private readonly handles = new Map<string, {pid: number | null; kill(): void}>();
  private readonly timeouts = new Map<string, () => void>();
  private readonly orphans = new Set<string>();
  private cancelPoll: (() => void) | null = null;
  private pumping = false;
  private again = false;

  constructor(private readonly o: WatcherOptions) {
    this.store = o.store;
    this.ops = o.ops;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? defaultTimer;
    this.store.subscribe((e) => this.onEvent(e));
  }

  // ---------------------------------------------------------------- public API

  /** Called once at daemon start: reconcile runs the previous daemon left `running`, then start what is queued. */
  recover(): void {
    for (const run of this.store.state.runs.filter((r) => r.status === "running")) {
      if (run.pid !== null && isAlive(run.pid)) this.adopt(run);
      else this.markLost(run.id);
    }
    this.pump();
  }

  activeRunCount(): number {
    return this.store.state.runs.filter(isActive).length;
  }

  /** Authenticates a run's MCP calls; every accepted call is counted in `mcpCalls`. */
  actorForRunToken(token: string): Actor {
    const run = this.store.state.runs.find((r) => r.token === token);
    if (!run || token === "") throw new BoardError("unknown run token", 403);
    if (run.status !== "running") throw new BoardError(`run ${run.id} has ended`, 403);
    const updated = this.store.mutate((draft) => {
      const r = draft.runs.find((x) => x.id === run.id)!;
      r.mcpCalls++;
      return {result: r, events: []};
    });
    return {kind: "run", run: updated};
  }

  /** Stops a pending or running run. Ended runs are left alone. */
  cancel(runId: string, note: string): void {
    const run = this.store.state.runs.find((r) => r.id === runId);
    if (!run) throw new BoardError(`run ${runId} not found`, 404);
    if (run.status === "pending") {
      this.patchRun(runId, (r) => {
        r.status = "cancelled";
        r.note = note;
        r.endedAt = this.now();
      }, `${runId} cancelled`, note);
      this.pump();
      return;
    }
    if (run.status !== "running") return;
    this.patchRun(runId, (r) => {
      r.status = "cancelled";
      r.note = note;
    }, `${runId} cancelled`, note);
    this.killRun(run);
    this.pump();
  }

  /** Daemon shutdown: running runs are cancelled (their processes killed); pending runs stay queued for the next daemon. */
  stopAll(note: string): void {
    for (const run of this.store.state.runs.filter((r) => r.status === "running")) this.cancel(run.id, note);
    this.cancelPoll?.();
    this.cancelPoll = null;
  }

  /** User pressed Restart agent: queue the agent that belongs to the ticket's current state. */
  restart(n: number): void {
    const ticket = this.store.state.tickets.find((t) => t.n === n);
    if (!ticket) throw new BoardError(`T-${n} not found`, 404);
    if ((ticket.status === "todo" || ticket.status === "in_progress") && ticket.assignee === "agent") {
      this.queueCoder(n);
    } else if (ticket.status === "testing") {
      this.queueTester(n);
    } else {
      throw new BoardError(`nothing to restart for T-${n} (${STATUS_LABEL[ticket.status]}, ${ticket.assignee ?? "unassigned"})`, 409);
    }
  }

  // ---------------------------------------------------------------- triggers

  private onEvent(e: BoardEvent): void {
    switch (e.type) {
      case "assigned": {
        if (e.actor.kind === "user") {
          const ticket = this.store.state.tickets.find((t) => t.n === e.ticket);
          if (e.to === "agent" && ticket && (ticket.status === "todo" || ticket.status === "in_progress")) this.queueCoder(e.ticket);
          if (e.from === "agent" && e.to !== "agent") this.stopTicket(e.ticket, ["coder"], `Agent stopped: T-${e.ticket} was reassigned.`);
        }
        this.pump();
        return;
      }
      case "moved": {
        if (e.to === "testing") this.queueTester(e.ticket);
        if (e.actor.kind === "user") {
          const ticket = this.store.state.tickets.find((t) => t.n === e.ticket);
          if (e.to === "in_progress" && ticket?.assignee === "agent") this.queueCoder(e.ticket);
          if (e.to === "todo" || e.to === "done") {
            this.stopTicket(e.ticket, ["coder", "tester"], `Agent stopped: T-${e.ticket} moved to ${STATUS_LABEL[e.to]}.`);
          }
        }
        this.pump();
        return;
      }
      case "commented":
        if (e.actor.kind === "user") this.onUserComment(e.ticket, e.commentId);
        return;
      case "blockers_changed":
        this.pump();
        return;
      case "changed":
        return;
    }
  }

  private onUserComment(n: number, commentId: number): void {
    const s = this.store.state;
    const comment = s.comments.find((c) => c.id === commentId);
    const ticket = s.tickets.find((t) => t.n === n);
    if (!comment || !ticket) return;
    const root = comment.replyTo === null ? comment : (s.comments.find((c) => c.id === comment.replyTo) ?? comment);
    if (root.author === "agent" && root.role === "tester") this.enqueue(n, "tester", "review_reply", commentId);
    else if (root.author === "agent" && root.role === "coder" && ticket.assignee === "agent") this.enqueue(n, "coder", "resume", commentId);
    else this.enqueue(n, "responder", "reply", commentId);
  }

  private stopTicket(n: number, roles: AgentRole[], message: string): void {
    const runs = this.store.state.runs.filter((r) => r.ticket === n && isActive(r) && roles.includes(r.role));
    if (runs.length === 0) return;
    for (const run of runs) this.cancel(run.id, message);
    this.ops.addSystemComment(n, message);
  }

  private queueCoder(n: number): void {
    const active = this.store.state.runs.find((r) => r.ticket === n && r.role === "coder" && isActive(r));
    if (active) {
      this.note(n, `coder already active: ${active.id}`);
      return;
    }
    this.enqueue(n, "coder", openBugs(this.store.state, n).length > 0 ? "rework" : "implement", null);
  }

  private queueTester(n: number): void {
    const active = this.store.state.runs.find((r) => r.ticket === n && r.role === "tester" && r.mode === "test" && isActive(r));
    if (active) {
      this.note(n, `tester already active: ${active.id}`);
      return;
    }
    this.enqueue(n, "tester", "test", null);
  }

  private enqueue(ticket: number, role: AgentRole, mode: Mode, commentId: number | null): void {
    this.store.mutate((draft) => {
      const run: Run = {
        id: `R-${draft.nextRun++}`,
        ticket,
        role,
        mode,
        commentId,
        status: "pending",
        waitingFor: role === "coder" ? blockersNotDone(draft, ticket).map((t) => t.n) : [],
        token: randomBytes(24).toString("hex"),
        pid: null,
        exitCode: null,
        mcpCalls: 0,
        createdAt: this.now(),
        startedAt: null,
        endedAt: null,
        note: null,
      };
      draft.runs.push(run);
      this.log(draft, ticket, run.id, `${run.id} ${role} ${mode} queued`);
      return {result: run, events: []};
    });
    this.pump();
  }

  // ---------------------------------------------------------------- scheduling

  /** Starts every pending run whose conditions hold. Re-entrant calls (from events raised while pumping) are folded into one more pass. */
  private pump(): void {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        for (const id of this.store.state.runs.filter((r) => r.status === "pending").map((r) => r.id)) this.consider(id);
      } while (this.again);
    } finally {
      this.pumping = false;
    }
  }

  private cancelPending(id: string, note: string): void {
    this.patchRun(id, (r) => {
      r.status = "cancelled";
      r.note = note;
      r.endedAt = this.now();
    }, `${id} cancelled`, note);
  }

  private consider(id: string): void {
    const s = this.store.state;
    const run = s.runs.find((r) => r.id === id);
    if (!run || run.status !== "pending") return;
    const ticket = s.tickets.find((t) => t.n === run.ticket);
    if (!ticket) return this.cancelPending(id, "ticket no longer exists");

    if (run.role === "coder") {
      if (ticket.status === "done") return this.cancelPending(id, "ticket is Done");
      if (ticket.assignee !== "agent") return this.cancelPending(id, "ticket no longer assigned to Agent");
      if (run.mode === "resume") {
        const answered = this.answeredBy(s, run);
        if (answered) return this.cancelPending(id, `answered by ${answered}`);
      }
      const waiting = blockersNotDone(s, ticket.n).map((t) => t.n);
      if (waiting.length !== run.waitingFor.length || waiting.some((v, i) => v !== run.waitingFor[i])) {
        this.patchRun(id, (r) => void (r.waitingFor = waiting), `${id} waiting`, waiting.map((n) => `T-${n}`).join(", "));
      }
      if (waiting.length > 0) return;
    } else if (run.role === "tester" && run.mode === "test" && ticket.status !== "testing") {
      return this.cancelPending(id, "ticket left Testing");
    }

    // One coder-or-tester process per ticket, and one responder per ticket.
    const busy = s.runs.some(
      (r) =>
        r.id !== id &&
        r.ticket === run.ticket &&
        (r.status === "running" || this.handles.has(r.id)) &&
        (run.role === "responder") === (r.role === "responder"),
    );
    if (busy) return;
    this.start(run);
  }

  /** Id of a coder run that already answered in the thread of a `resume` run's triggering comment. */
  private answeredBy(s: Readonly<BoardState>, run: Run): string | null {
    const trigger = s.comments.find((c) => c.id === run.commentId);
    if (!trigger) return null;
    const rootId = trigger.replyTo ?? trigger.id;
    const answer = s.comments.find(
      (c) => c.ticket === run.ticket && (c.id === rootId || c.replyTo === rootId) && c.id > trigger.id && c.author === "agent" && c.role === "coder" && c.runId !== null,
    );
    return answer?.runId ?? null;
  }

  // ---------------------------------------------------------------- run lifecycle

  private start(run: Run): void {
    const cfg = this.o.readConfig();
    const mcpFile = join(this.o.boardDir, "runs", `${run.id}.mcp.json`);
    let handle: {pid: number | null; kill(): void};
    let started = false;
    const early: {code?: number | null} = {};
    try {
      const template = resolveAgentArgv(cfg, this.o.harness, this.o.execPath);
      writeRunMcpConfig(mcpFile, {
        boardDir: this.o.boardDir,
        token: run.token,
        harness: this.o.harness,
        pluginRoot: this.o.pluginRoot,
        execPath: this.o.execPath,
        daemonEnv: this.o.env,
      });
      const roleFile = join(this.o.pluginRoot, "skills", "board", "references", `role-${run.role}.md`);
      const {argv, stdin} = expandArgv(template, {
        mcpConfig: mcpFile,
        ticket: String(run.ticket),
        run: run.id,
        role: run.role,
        cwd: this.o.projectRoot,
        prompt: buildPrompt(run, roleFile),
      });
      handle = this.o.spawner.start(
        {
          argv,
          cwd: this.o.projectRoot,
          env: runEnv(this.o.env, {run, boardDir: this.o.boardDir, argv0: argv[0]!, execPath: this.o.execPath, custom: cfg.agent === "custom"}),
          stdin,
          logFile: join(this.o.boardDir, "runs", `${run.id}.log`),
          header: `# ${run.id} ${run.role} ${run.mode} T-${run.ticket} ${new Date(this.now()).toISOString()}`,
        },
        (code) => {
          if (started) this.onExit(run.id, code);
          else early.code = code;
        },
      );
    } catch (e) {
      rmSync(mcpFile, {force: true});
      this.failToStart(run, e instanceof Error ? e.message : String(e));
      return;
    }
    started = true;
    this.handles.set(run.id, handle);
    this.patchRun(run.id, (r) => {
      r.status = "running";
      r.startedAt = this.now();
      r.pid = handle.pid;
      r.waitingFor = [];
    }, `${run.id} ${run.role} ${run.mode} started`);
    if (cfg.timeoutMinutes > 0) {
      this.timeouts.set(run.id, this.setTimer(() => this.onTimeout(run.id, cfg.timeoutMinutes), cfg.timeoutMinutes * 60_000));
    }
    if ("code" in early) this.onExit(run.id, early.code ?? null);
  }

  private failToStart(run: Run, message: string): void {
    this.patchRun(run.id, (r) => {
      r.status = "failed";
      r.note = message;
      r.endedAt = this.now();
    }, `${run.id} failed`, message);
    this.ops.addSystemComment(
      run.ticket,
      `Run ${run.id} (${run.role}, ${run.mode}) could not start: ${message}. Use Restart agent in the ticket's Agent runs tab to try again.`,
    );
  }

  private onTimeout(id: string, minutes: number): void {
    this.timeouts.delete(id);
    const run = this.store.state.runs.find((r) => r.id === id);
    if (!run || run.status !== "running") return;
    this.patchRun(id, (r) => {
      r.status = "timeout";
      r.note = `timed out after ${minutes} minutes`;
    }, `${id} timeout`, `after ${minutes} minutes`);
    this.killRun(run);
    if (this.orphans.has(id)) this.markEnded(id);
  }

  private killRun(run: Run): void {
    const handle = this.handles.get(run.id);
    if (handle) handle.kill();
    else if (run.pid !== null) {
      killPid(run.pid);
      if (this.orphans.has(run.id)) this.markEnded(run.id);
    }
  }

  /** An adopted run has no exit callback; once it is killed or gone, close it out. */
  private markEnded(id: string): void {
    this.orphans.delete(id);
    this.timeouts.get(id)?.();
    this.timeouts.delete(id);
    rmSync(join(this.o.boardDir, "runs", `${id}.mcp.json`), {force: true});
    this.patchRun(id, (r) => void (r.endedAt ??= this.now()), `${id} ${this.store.state.runs.find((r) => r.id === id)?.status ?? "ended"}`);
    this.pump();
  }

  private onExit(id: string, code: number | null): void {
    this.timeouts.get(id)?.();
    this.timeouts.delete(id);
    this.handles.delete(id);
    rmSync(join(this.o.boardDir, "runs", `${id}.mcp.json`), {force: true});
    const at = this.now();
    const run = this.patchRun(id, (r) => {
      if (r.status === "running") r.status = code === 0 ? "succeeded" : "failed";
      r.exitCode = code;
      r.endedAt ??= at;
    }, `${id} ended`, `exit ${code ?? "unknown"}`);
    if (run && (run.status !== "succeeded" || run.mcpCalls === 0)) {
      this.ops.addSystemComment(
        run.ticket,
        `Run ${run.id} (${run.role}, ${run.mode}) ${run.status}, exit ${code ?? "unknown"}, after ${duration(run.startedAt ?? run.createdAt, at)}. Log: .slimstack/board/runs/${run.id}.log. Use Restart agent in the ticket's Agent runs tab to try again.`,
      );
    }
    this.pump();
  }

  // ---------------------------------------------------------------- recovery

  private adopt(run: Run): void {
    this.orphans.add(run.id);
    const minutes = this.o.readConfig().timeoutMinutes;
    if (minutes > 0) {
      const left = minutes * 60_000 - (this.now() - (run.startedAt ?? this.now()));
      this.timeouts.set(run.id, this.setTimer(() => this.onTimeout(run.id, minutes), Math.max(0, left)));
    }
    this.cancelPoll ??= this.setTimer(() => this.poll(), POLL_MS);
  }

  private poll(): void {
    this.cancelPoll = null;
    for (const id of [...this.orphans]) {
      const run = this.store.state.runs.find((r) => r.id === id);
      if (!run || run.status !== "running") {
        this.orphans.delete(id);
        continue;
      }
      if (run.pid === null || !isAlive(run.pid)) this.markLost(id);
    }
    if (this.orphans.size > 0) this.cancelPoll = this.setTimer(() => this.poll(), POLL_MS);
  }

  private markLost(id: string): void {
    this.orphans.delete(id);
    this.timeouts.get(id)?.();
    this.timeouts.delete(id);
    rmSync(join(this.o.boardDir, "runs", `${id}.mcp.json`), {force: true});
    const run = this.patchRun(id, (r) => {
      r.status = "lost";
      r.note = LOST_NOTE;
      r.endedAt = this.now();
    }, `${id} lost`, LOST_NOTE);
    if (run) {
      this.ops.addSystemComment(
        run.ticket,
        `Run ${run.id} (${run.role}, ${run.mode}) lost: ${LOST_NOTE}. Log: .slimstack/board/runs/${run.id}.log. Use Restart agent in the ticket's Agent runs tab to try again.`,
      );
    }
    this.pump();
  }

  // ---------------------------------------------------------------- store helpers

  private log(draft: BoardState, ticket: number | null, runId: string | null, action: string, detail = ""): void {
    draft.history.push({at: this.now(), ticket, actor: "system", runId, action, detail});
  }

  private note(ticket: number, action: string): void {
    this.store.mutate((draft) => {
      this.log(draft, ticket, null, action);
      return {result: undefined, events: []};
    });
  }

  private patchRun(id: string, change: (r: Run) => void, action: string, detail = ""): Run | undefined {
    return this.store.mutate((draft) => {
      const run = draft.runs.find((r) => r.id === id);
      if (!run) return {result: undefined, events: []};
      change(run);
      this.log(draft, run.ticket, run.id, action, detail);
      return {result: run as Run | undefined, events: []};
    });
  }
}
