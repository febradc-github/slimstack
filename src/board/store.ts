import {mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import type {BoardEvent, BoardState} from "./types.ts";

const HISTORY_CAP = 5000;
const RETRY_CODES: Record<string, true> = {EPERM: true, EBUSY: true, EACCES: true};
const RETRIES = 5;
const RETRY_MS = 20;

export type BoardListener = (event: BoardEvent) => void;

export function emptyState(): BoardState {
  return {version: 1, rev: 0, nextTicket: 1, nextComment: 1, nextRun: 1, tickets: [], comments: [], runs: [], history: []};
}

/** Windows antivirus/indexers briefly lock files: retry EPERM/EBUSY/EACCES. */
function withRetry<T>(fn: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= RETRIES || !code || !RETRY_CODES[code]) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_MS);
    }
  }
}

function isState(v: unknown): v is BoardState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    s.version === 1 &&
    Number.isFinite(s.rev) &&
    Number.isFinite(s.nextTicket) &&
    Number.isFinite(s.nextComment) &&
    Number.isFinite(s.nextRun) &&
    Array.isArray(s.tickets) &&
    Array.isArray(s.comments) &&
    Array.isArray(s.runs) &&
    Array.isArray(s.history)
  );
}

export class BoardStore {
  /** Receives listener errors; the daemon points it at daemon.log. */
  log: (message: string) => void = (m) => {
    process.stderr.write(m + "\n");
  };
  private readonly listeners = new Set<BoardListener>();
  private readonly queue: BoardEvent[] = [];
  private draining = false;

  private constructor(
    readonly file: string,
    private current: BoardState,
    /** Set when board.json was unreadable and moved aside; the daemon logs it. */
    readonly warning: string | null,
  ) {}

  static load(file: string, now: () => number = Date.now): BoardStore {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return new BoardStore(file, emptyState(), null);
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (isState(parsed)) return new BoardStore(file, parsed, null);
    const aside = `${file}.corrupt-${now()}`;
    withRetry(() => renameSync(file, aside));
    return new BoardStore(file, emptyState(), `board.json was unreadable or not version 1; moved to ${aside}`);
  }

  get state(): Readonly<BoardState> {
    return this.current;
  }

  subscribe(listener: BoardListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Runs `fn` on a clone of the state. A throw changes nothing. Otherwise the clone is persisted
   * (tmp + rename), becomes the state, and events are delivered in order (events raised by listeners
   * that mutate are delivered after the current batch).
   */
  mutate<R>(fn: (draft: BoardState) => {result: R; events: BoardEvent[]}): R {
    const draft = structuredClone(this.current);
    const {result, events} = fn(draft);
    draft.rev++;
    if (draft.history.length > HISTORY_CAP) draft.history.splice(0, draft.history.length - HISTORY_CAP);
    this.persist(draft);
    this.current = draft;
    for (const e of events) this.queue.push(e);
    this.queue.push({type: "changed", rev: draft.rev});
    this.drain();
    return result;
  }

  private persist(state: BoardState): void {
    mkdirSync(dirname(this.file), {recursive: true});
    const tmp = this.file + ".tmp";
    withRetry(() => writeFileSync(tmp, JSON.stringify(state)));
    withRetry(() => renameSync(tmp, this.file));
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    try {
      let e: BoardEvent | undefined;
      while ((e = this.queue.shift()) !== undefined) {
        for (const listener of this.listeners) {
          try {
            listener(e);
          } catch (err) {
            this.log(`board listener error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
