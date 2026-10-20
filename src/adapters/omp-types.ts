// Local structural types: slimstack never imports an omp package.
export interface OmpContext {
  cwd: string;
  agent?: { kind: "main" | "sub" };
  ui: { notify(message: string, level?: "info"): void };
}

export interface OmpMessage {
  role: string;
  [k: string]: unknown;
}

export interface OmpSpawnEvent {
  agent?: string;
}

export interface OmpApi {
  setLabel(l: string): void;
  on(
    event: "context",
    h: (e: { messages: OmpMessage[] }, ctx: OmpContext) => { messages: OmpMessage[] } | undefined,
  ): void;
  on(event: "before_subagent_spawn", h: (e: OmpSpawnEvent) => { model: string; note: string } | undefined): void;
  registerCommand(
    name: string,
    def: { description: string; handler(args: string, ctx: OmpContext): void | Promise<void> },
  ): void;
}
