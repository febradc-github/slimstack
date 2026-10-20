// Minimal markdown subset. Output is the only HTML the UI injects, so the
// whole source is HTML-escaped first and only fixed tags are added afterwards.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+\.\s+(.*)$/;

function inline(s: string): string {
  const parts = s.split(/(`[^`\n]+`)/);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    out += i % 2 === 1 ? "<code>" + p.slice(1, -1) + "</code>" : p.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  }
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = esc(src).split(/\r?\n/);
  let out = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i++]!);
      i++; // closing fence (or end of input for an unterminated block)
      out += "<pre><code>" + code.join("\n") + "</code></pre>";
      continue;
    }
    const hm = HEADING.exec(line);
    if (hm) {
      const tag = "h" + (3 + hm[1]!.length);
      out += "<" + tag + ">" + inline(hm[2]!) + "</" + tag + ">";
      i++;
      continue;
    }
    const list = UL.test(line) ? UL : OL.test(line) ? OL : null;
    if (list) {
      const tag = list === UL ? "ul" : "ol";
      out += "<" + tag + ">";
      for (let m = list.exec(lines[i]!); m; m = i < lines.length ? list.exec(lines[i]!) : null) {
        out += "<li>" + inline(m[1]!) + "</li>";
        i++;
      }
      out += "</" + tag + ">";
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === "" || FENCE.test(l) || HEADING.test(l) || UL.test(l) || OL.test(l)) break;
      para.push(inline(l));
      i++;
    }
    out += "<p>" + para.join("<br>") + "</p>";
  }
  return out;
}
