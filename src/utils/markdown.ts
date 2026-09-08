import { Marked } from "marked";

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

// 远端 Markdown 不允许原始 HTML、嵌入资源或非 HTTP 链接进入特权渲染页面。
const markdown = new Marked({
  async: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      try {
        const url = new URL(href);
        if (url.protocol === "https:" || url.protocol === "http:") {
          return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
      } catch {}
      return label;
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

/** 将更新说明转换为不含主动内容的 Markdown HTML。 */
export const renderSafeMarkdown = (source: string): string =>
  markdown.parse(source.slice(0, 100_000), { async: false });
