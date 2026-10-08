import type { DocumentModel, NodeModel, PageModel } from "../ir/types";
import { escape, safeUrl } from "../utils/naming";
export function walk(node: NodeModel): NodeModel[] {
  return [node, ...node.children.flatMap(walk)];
}
export function html(
  page: PageModel,
  doc: DocumentModel,
  script: boolean,
): string {
  const prefix = page.path.startsWith("pages/") ? "../" : "";
  function render(node: NodeModel, depth: number, interactive = false): string {
    let tag = node.tag,
      attrs = "",
      action = node.interaction;
    if (
      !interactive &&
      action?.type === "url" &&
      safeUrl(action.target ?? "")
    ) {
      tag = "a";
      attrs = ` href="${escape(action.target!)}"`;
    }
    if (!interactive && action?.type === "navigate") {
      const target = doc.pages.find((p) => p.id === action.target);
      if (target) {
        tag = "a";
        attrs = ` href="${prefix}${target.path}"`;
      }
    }
    if (!interactive && action?.type === "back") {
      tag = "button";
      attrs = ' type="button" data-history-back';
    }
    if (interactive && ["a", "button"].includes(tag)) tag = "span";
    if (
      interactive &&
      [
        "div",
        "p",
        "section",
        "article",
        "header",
        "footer",
        "main",
        "nav",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
      ].includes(tag)
    )
      tag = "span";
    if (tag === "button" && !attrs) attrs = ' type="button"';
    const indent = "  ".repeat(depth);
    const start = `${indent}<${tag} class="${node.className}"${attrs}`;
    if (node.asset) {
      const img = `<img src="${prefix}${escape(node.asset)}" alt="${escape(node.name)}" width="${Math.max(1, Math.round(node.width))}" height="${Math.max(1, Math.round(node.height))}">`;
      return tag === "img"
        ? `${indent}${img.replace("<img ", `<img class="${node.className}" `)}`
        : `${start}>${img}</${tag}>`;
    }
    const content =
      node.text !== undefined
        ? escape(node.text)
        : node.children
            .map((c) => {
              const child = render(
                c,
                depth + 1,
                interactive || tag === "a" || tag === "button",
              );
              return ["ul", "ol"].includes(tag) && c.tag !== "li"
                ? `${"  ".repeat(depth + 1)}<li>\n${child}\n${"  ".repeat(depth + 1)}</li>`
                : child;
            })
            .join("\n");
    return `${start}>${node.text !== undefined ? content : `\n${content}\n${indent}`}</${tag}>`;
  }
  return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${escape(page.name)}</title>\n  <link rel="stylesheet" href="${prefix}css/styles.css">\n  <link rel="stylesheet" href="${prefix}css/responsive.css">\n${script ? `  <script src="${prefix}js/script.js" defer></script>\n` : ""}</head>\n<body>\n${render(page.root, 1)}\n</body>\n</html>\n`;
}
