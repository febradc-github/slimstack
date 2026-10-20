import type {BoardState, HistoryEntry, Run, Ticket, Comment} from "../types.ts";

export type RunView = Omit<Run, "token">;

export interface LiveState {
  rev: number;
  project: string;
  url: string;
  tickets: Ticket[];
  comments: Comment[];
  runs: RunView[];
  history: HistoryEntry[];
  allDone: boolean;
}

export interface ArchiveInfo {id: string; title: string; archivedAt: number; ticketCount: number}

export interface ArchiveSnapshot extends ArchiveInfo {
  project: string;
  state: Pick<BoardState, "tickets" | "comments" | "runs" | "history">;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const uiToken: string = document.querySelector('meta[name="slimstack-token"]')?.getAttribute("content") ?? "";

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {"x-slimstack-token": uiToken};
  const init: RequestInit = {method, headers};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.ok) return res;
  let message = res.statusText || "request failed (" + res.status + ")";
  try {
    const j = (await res.json()) as {error?: unknown};
    if (typeof j.error === "string") message = j.error;
  } catch {
    // keep the status text
  }
  if (res.status === 401) onUnauthorized();
  throw new ApiError(message, res.status);
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await send(method, path, body)).json()) as T;
}

export async function apiText(path: string): Promise<string> {
  return (await send("GET", path)).text();
}
