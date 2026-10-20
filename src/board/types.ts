export type Status = "todo" | "in_progress" | "testing" | "done";
export const STATUS_LABEL: Record<Status, string> = {todo: "To Do", in_progress: "In Progress", testing: "Testing", done: "Done"};
export type Assignee = "user" | "agent" | null;
export type AgentRole = "coder" | "tester" | "responder";
export type Mode = "implement" | "rework" | "resume" | "test" | "review_reply" | "reply";
export interface Ticket {n: number; title: string; instructions: string; pseudocode: string; acceptanceCriteria: string[]; assignee: Assignee; blockedBy: number[]; status: Status; createdAt: number; updatedAt: number; enteredTestingAt: number | null}
export type CommentKind = "message" | "bug" | "test_run" | "system";
export type BugStatus = "open" | "fixed" | "dismissed";
export interface Comment {id: number; ticket: number; author: "user" | "agent" | "system"; role: AgentRole | "session" | null; runId: string | null; kind: CommentKind; body: string; replyTo: number | null; bugStatus: BugStatus | null; passed: boolean | null; createdAt: number}
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "timeout" | "cancelled" | "lost";
export interface Run {id: string; ticket: number; role: AgentRole; mode: Mode; commentId: number | null; status: RunStatus; waitingFor: number[]; token: string; pid: number | null; exitCode: number | null; mcpCalls: number; createdAt: number; startedAt: number | null; endedAt: number | null; note: string | null}
export interface HistoryEntry {at: number; ticket: number | null; actor: "user" | "agent" | "system"; runId: string | null; action: string; detail: string}
export interface BoardState {version: 1; rev: number; nextTicket: number; nextComment: number; nextRun: number; tickets: Ticket[]; comments: Comment[]; runs: Run[]; history: HistoryEntry[]}
export type Actor = {kind: "user"} | {kind: "session"} | {kind: "run"; run: Run} | {kind: "system"};
export type BoardEvent =
  | {type: "assigned"; ticket: number; actor: Actor; from: Assignee; to: Assignee}
  | {type: "moved"; ticket: number; actor: Actor; from: Status; to: Status}
  | {type: "commented"; ticket: number; actor: Actor; commentId: number}
  | {type: "blockers_changed"; ticket: number}
  | {type: "changed"; rev: number};
