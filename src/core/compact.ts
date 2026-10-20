import { writeSpill } from "./spill.ts";

export const THRESHOLD_CHARS = 8_000;
export const MAX_LINE_CHARS = 1_500;
export const HEAD_LINES = 60;
export const TAIL_LINES = 60;
export const SIGNAL_CONTEXT = 1;
export const MAX_SIGNAL_LINES = 80;
export const MIN_SAVING = 0.1;
export const JSON_MIN_ITEMS = 20;
export const JSON_HEAD = 5;
export const JSON_TAIL = 2;
export const JSON_SIGNAL = 10;

export const SIGNAL_RE =
  /\b(error|errors|fail|failed|failure|failures|fatal|panic|exception|traceback|assert|assertion|warn|warning|denied|timeout|cannot|unable)\b/i;

const ANSI_CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

export interface CompactOptions {
  projectDir: string;
  sessionId: string;
  callId: string;
  stream: "stdout" | "stderr";
  thresholdChars?: number;
}

export interface CompactResult {
  text: string;
  before: number;
  after: number;
  spillPath: string;
}

function compactJson(input: string): string | null {
  if (!input.trimStart().startsWith("[")) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(input);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length < JSON_MIN_ITEMS) return null;
  const n = arr.length;
  const keep: number[] = [];
  for (let i = 0; i < JSON_HEAD; i++) keep.push(i);
  let signals = 0;
  for (let i = JSON_HEAD; i < n - JSON_TAIL && signals < JSON_SIGNAL; i++) {
    const s = JSON.stringify(arr[i]);
    if (s !== undefined && SIGNAL_RE.test(s)) {
      keep.push(i);
      signals++;
    }
  }
  for (let i = n - JSON_TAIL; i < n; i++) keep.push(i);
  let body = "";
  let prev = -1;
  for (const idx of keep) {
    const item = JSON.stringify(arr[idx]) ?? "null";
    if (prev === -1) body = item;
    else if (idx !== prev + 1) body += ",\n/* " + (idx - prev - 1) + " items omitted */\n" + item;
    else body += ",\n" + item;
    prev = idx;
  }
  return "[\n" + body + "\n]";
}

function cleanLines(input: string): string[] {
  const stripped = input.replace(ANSI_OSC, "").replace(ANSI_CSI, "");
  const out: string[] = [];
  let blank = false;
  let run = 0;
  let runLine = "";
  const flushRun = () => {
    if (run >= 3) out.push(runLine + " (x" + run + ")");
    else for (let k = 0; k < run; k++) out.push(runLine);
    run = 0;
  };
  for (const raw of stripped.split(/\r?\n/)) {
    let line = raw;
    const cr = line.lastIndexOf("\r");
    if (cr !== -1) {
      const parts = line.split("\r");
      let pick = "";
      for (let k = parts.length - 1; k >= 0; k--) {
        if (parts[k] !== "") {
          pick = parts[k]!;
          break;
        }
      }
      line = pick;
    }
    line = line.trimEnd();
    if (line.length > MAX_LINE_CHARS) {
      line = line.slice(0, MAX_LINE_CHARS) + "...[+" + (line.length - MAX_LINE_CHARS) + " chars]";
    }
    if (line === "") {
      if (blank) continue;
      blank = true;
    } else {
      blank = false;
    }
    if (run > 0 && line === runLine) {
      run++;
      continue;
    }
    flushRun();
    runLine = line;
    run = 1;
  }
  flushRun();
  return out;
}

function headTail(lines: string[]): string {
  const n = lines.length;
  if (n <= HEAD_LINES + TAIL_LINES) return lines.join("\n");
  const midEnd = n - TAIL_LINES;
  const keep = new Set<number>();
  for (let i = HEAD_LINES; i < midEnd && keep.size < MAX_SIGNAL_LINES; i++) {
    if (!SIGNAL_RE.test(lines[i]!)) continue;
    for (let c = Math.max(HEAD_LINES, i - SIGNAL_CONTEXT); c <= Math.min(midEnd - 1, i + SIGNAL_CONTEXT); c++) {
      keep.add(c);
    }
  }
  const mid = [...keep].sort((a, b) => a - b).slice(0, MAX_SIGNAL_LINES);
  const out: string[] = lines.slice(0, HEAD_LINES);
  let next = HEAD_LINES;
  for (const i of mid) {
    if (i > next) out.push("[... " + (i - next) + " lines omitted ...]");
    out.push(lines[i]!);
    next = i + 1;
  }
  if (midEnd > next) out.push("[... " + (midEnd - next) + " lines omitted ...]");
  for (let i = midEnd; i < n; i++) out.push(lines[i]!);
  return out.join("\n");
}

export function compactOutput(input: string, o: CompactOptions): CompactResult | null {
  const threshold = o.thresholdChars ?? THRESHOLD_CHARS;
  if (input.length < threshold) return null;
  const limit = input.length * (1 - MIN_SAVING);

  let body = compactJson(input);
  if (body !== null && body.length > limit) body = null;
  if (body === null) {
    const lines = cleanLines(input);
    body = lines.join("\n");
    if (body.length > threshold) body = headTail(lines);
  }
  if (body.length > limit) return null;

  const spillPath = writeSpill(o.projectDir, o.sessionId, o.callId, o.stream, input);
  if (spillPath === null) return null;

  const before = input.length;
  const tail = (after: number) =>
    "\n[slimstack: compacted " + before + "->" + after + " chars; full output: " + spillPath + "]";
  let text = body + tail(0);
  for (let i = 0; i < 3; i++) {
    const next = body + tail(text.length);
    if (next.length === text.length) {
      text = next;
      break;
    }
    text = next;
  }
  return { text, before, after: text.length, spillPath };
}
