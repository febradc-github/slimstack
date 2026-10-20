/** The one object guard: proves a plain (non-array) object; its fields stay `unknown` until checked. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
