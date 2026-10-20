// Tiny element builder. Text children become text nodes, never markup.

export type Child = Node | string | number | null | undefined | false | Child[];
export type Props = Record<string, unknown> | null | undefined;

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  let value: unknown;
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null) continue;
      if (k === "class") el.className = String(v);
      else if (k === "value") value = v; // after children, so <select> options exist
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (typeof v === "boolean") {
        if (Reflect.has(el, k)) Reflect.set(el, k, v);
        else if (v) el.setAttribute(k, "");
      } else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  if (value !== undefined) Reflect.set(el, "value", String(value));
  return el;
}
