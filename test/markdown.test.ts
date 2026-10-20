import {describe, expect, test} from "bun:test";
import {renderMarkdown} from "../src/board/ui/markdown.ts";

describe("renderMarkdown", () => {
  test("escapes raw HTML", () => {
    const html = renderMarkdown("<img src=x onerror=alert(1)> and <script>alert(1)</script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes HTML inside code fences, inline code, headings, and lists", () => {
    const html = renderMarkdown("```\n<img src=x onerror=alert(1)>\n<script>x</script>\n```\n`<script>`\n# <b>t</b>\n- <i>x</i>");
    expect(html).not.toMatch(/<(img|script|b|i)[ >]/);
    expect(html).toContain("<pre><code>&lt;img src=x onerror=alert(1)&gt;\n&lt;script&gt;x&lt;/script&gt;</code></pre>");
    expect(html).toContain("<code>&lt;script&gt;</code>");
  });

  test("renders fences, lists, bold, inline code, headings, paragraphs", () => {
    expect(renderMarkdown("```ts\nconst a = 1;\n```")).toBe("<pre><code>const a = 1;</code></pre>");
    expect(renderMarkdown("- a\n- b\n* c")).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
    expect(renderMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(renderMarkdown("some **bold** and `code`")).toBe("<p>some <strong>bold</strong> and <code>code</code></p>");
    expect(renderMarkdown("# A\n## B\n### C")).toBe("<h4>A</h4><h5>B</h5><h6>C</h6>");
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  test("does not format inside inline code or fences", () => {
    expect(renderMarkdown("`**x**`")).toBe("<p><code>**x**</code></p>");
    expect(renderMarkdown("```\n- **x**\n```")).toBe("<pre><code>- **x**</code></pre>");
  });

  test("never produces links or images", () => {
    const html = renderMarkdown("[a](http://x) ![i](http://y)");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<img");
  });

  test("unterminated fence closes at end of input", () => {
    expect(renderMarkdown("```\nx")).toBe("<pre><code>x</code></pre>");
  });
});
