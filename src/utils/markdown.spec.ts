import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "./markdown";

describe("release notes", () => {
  it("preserves headings, lists, emphasis and safe links", () => {
    const html = renderSafeMarkdown("# Changes\n\n- **Fixed** [playback](https://example.com)");
    expect(html).toContain("<h1>Changes</h1>");
    expect(html).toContain("<strong>Fixed</strong>");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it.each([
    '<img src=x onerror="window.api.config.reset()">',
    '<svg><a href="javascript:alert(1)">bad</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    "[bad](javascript:alert%281%29)",
    "[bad](data:text/html,bad)",
    "[bad](file:///etc/passwd)",
    "![remote image](https://example.com/tracker)",
    '[bad](https://example.com "onmouseover=alert(1)")',
  ])("does not create active content from %s", (source) => {
    const container = document.createElement("div");
    container.innerHTML = renderSafeMarkdown(source);
    expect(container.querySelector("script,img,svg,iframe,object,embed")).toBeNull();
    for (const node of container.querySelectorAll("*")) {
      expect([...node.attributes].some((attribute) => attribute.name.startsWith("on"))).toBe(false);
    }
    for (const link of container.querySelectorAll("a")) {
      expect(["http:", "https:"]).toContain(new URL(link.href).protocol);
    }
  });
});
